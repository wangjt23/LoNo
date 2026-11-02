import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import { ChatStore } from '../src/core/chat-store.js';
import { ChatService } from '../src/core/chat-service.js';
import { analyzeLocal } from '../src/core/analyzer.js';

async function setup(request, filename) {
  const store = await Store.open(filename), chat = new ChatStore(store);
  const {id} = store.ingest({text:'明天下午三点提交项目报告'},analyzeLocal('明天下午三点提交项目报告',new Date(),true));
  return {store,chat,id,service:new ChatService(store,chat,()=>({enabled:true}),{request})};
}
test('agent searches and reads original data; task edits require confirmation and persist atomically with action status',async()=>{
  let id, round=0;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lono-chat-')),filename=path.join(dir,'test.sqlite');
  const fixture=await setup(async(_model,messages)=>{
    round++;
    if(round===1) return {calls:[{type:'search',scope:'tasks',query:'项目'}]};
    const tool=JSON.parse(messages.at(-1).content).LOCAL_QUERY_RESULT[0];
    if(round===2){assert.equal(tool.total,1);id=tool.items[0].id;return {calls:[{type:'read',scope:'tasks',id}]};}
    assert.ok(tool.record.text.includes('提交项目报告'));
    return {reply:'已找到记录，建议改为高优先级，等待你确认。',changes:[{taskId:id,action:'edit',fields:{title:'提交项目报告',dueAt:tool.record.dueAt,remindAt:tool.record.remindAt,priority:'high'}}]};
  },filename);
  const before=fixture.store.task(fixture.id);
  await fixture.service.send('把项目报告改成重要');
  assert.deepEqual(fixture.store.task(id),before);
  const action=fixture.chat.messages().at(-1).actions[0];
  fixture.chat.resolve(action.id,'apply');
  assert.equal(fixture.store.task(id).priority,'high');
  assert.equal(fixture.chat.messages().at(-1).actions[0].status,'applied');
  assert.throws(()=>fixture.chat.resolve(action.id,'apply'),/已处理/);
  fixture.store.close();
  const reopened=await Store.open(filename),chat=new ChatStore(reopened);
  assert.equal(chat.messages().length,2);assert.equal(chat.messages().at(-1).actions[0].status,'applied');reopened.close();
});
test('chat suggestions cannot overwrite concurrent edits and dismiss never changes task',async()=>{
  let round=0,id;
  const f=await setup(async()=>++round%2 ? {calls:[{type:'read',id}]} : {reply:'建议完成',changes:[{taskId:id,action:'complete'}]});id=f.id;
  await f.service.send('标记完成');let action=f.chat.messages().at(-1).actions[0];
  f.store.updateTask(id,'snooze');const before=f.store.task(id);
  assert.throws(()=>f.chat.resolve(action.id,'apply'),/已被修改/);assert.deepEqual(f.store.task(id),before);
  f.chat.resolve(action.id,'dismiss');assert.deepEqual(f.store.task(id),before);f.store.close();
});
test('failed durable confirmation rolls back both the task and the chat action',async()=>{
  let id,round=0;
  const f=await setup(async()=>++round===1 ? {calls:[{type:'read',id}]} : {reply:'建议完成',changes:[{taskId:id,action:'complete'}]});id=f.id;
  await f.service.send('把这条记录标记完成');
  const action=f.chat.messages().at(-1).actions[0],before=f.store.task(id);
  const persist=f.store.persist;f.store.persist=()=>{throw new Error('disk full')};
  assert.throws(()=>f.chat.resolve(action.id,'apply'),/disk full/);
  assert.deepEqual(f.store.task(id),before);
  assert.equal(f.chat.messages().at(-1).actions[0].status,'pending');
  f.store.persist=persist;f.chat.resolve(action.id,'apply');assert.equal(f.store.task(id).status,'done');f.store.close();
});
test('chat memory keeps exact user evidence, requires approval and survives restart',async()=>{
  const text='我习惯重要会议提前一天提醒';
  const f=await setup(async()=>({reply:'已提炼为候选记忆，请确认。',memories:[{kind:'preference',content:text,evidence:text}]}));
  await f.service.send(text);
  const memory=f.store.memories().find(m=>m.content===text);
  assert.equal(memory.status,'candidate');assert.equal(f.store.record(memory.record_id).source,'chat');
  assert.equal(f.store.recall('重要会议').length,0);
  f.store.saveMemory({...memory,status:'approved'});assert.equal(f.store.recall('重要会议')[0].id,memory.id);
  assert.equal(f.chat.messages().at(-1).detail.memoryIds[0],memory.id);f.store.close();
});
test('invalid memory evidence, secret memories and unobserved task IDs cannot be written',async()=>{
  for(const result of [
    {reply:'猜测记忆',memories:[{kind:'fact',content:'未声明的事实',evidence:'伪造原话'}]},
    {reply:'敏感记忆',memories:[{kind:'fact',content:'密码12345',evidence:'密码12345'}]},
    {reply:'伪造修改',changes:[{taskId:'unknown',action:'complete'}]},
  ]){
    const f=await setup(async()=>result);const before=f.store.tasks();
    await assert.rejects(f.service.send('不要记住密码12345'));
    assert.deepEqual(f.store.tasks(),before);assert.equal(f.store.memories().length,0);assert.equal(f.chat.messages().at(-1).detail.error,true);f.store.close();
  }
});
test('agent searches use UI time classifications and approved memories only; query exhaustion and concurrent sends are bounded',async()=>{
  let resolve;
  const f=await setup(()=>new Promise(r=>resolve=r));
  const running=f.service.send('查询');await assert.rejects(f.service.send('重复查询'),/上一条/);resolve({reply:'回答'});await running;
  const readOnly=new ChatService(f.store,f.chat,()=>({enabled:true}),{request:async()=>({calls:[{type:'search',status:'review'}]})});
  await assert.rejects(readOnly.send('反复查询'),/轮数/);assert.equal(readOnly.busy,false);
  const opened=new Map(),refs=new Map();
  const review=readOnly.query({type:'search',scope:'tasks',query:'',status:'review'},opened,refs);
  assert.equal(review.total,0);
  f.store.updateTask(f.id,'edit',{title:'无时间',dueAt:null,remindAt:null,priority:'low'});
  assert.equal(readOnly.query({type:'search',scope:'tasks',query:'',status:'review'},opened,refs).total,1);
  assert.equal(readOnly.query({type:'search',scope:'tasks',query:'',status:'overdue'},opened,refs).total,0);f.store.close();
});

test('follow-up approval keeps complete references across restart and repairs shortened duplicate targets by re-reading current records',async()=>{
  let round=0,id;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lono-chat-followup-')),filename=path.join(dir,'test.sqlite');
  let f=await setup(async()=>++round===1?{calls:[{type:'search',scope:'tasks',query:'项目'}]}:{reply:'建议完成这条项目记录，等待你同意。'},filename);id=f.id;
  await f.service.send('先检查项目记录，给出建议');
  f.store.close();
  const store=await Store.open(filename),chat=new ChatStore(store);
  store.updateTask(id,'edit',{title:'新的项目报告标题',dueAt:null,remindAt:null,priority:'low'});
  let calls=0;
  const service=new ChatService(store,chat,()=>({enabled:true}),{request:async(_model,messages)=>{
    if(++calls===1){
      const history=messages.find(m=>m.role==='assistant');
      assert.equal(JSON.parse(history.content).references[0].id,id);
      return {reply:'按上次建议处理',changes:[{taskId:id.slice(0,8)+'...',action:'complete'},{taskId:id.slice(0,8)+'...',action:'complete'}]};
    }
    const feedback=JSON.parse(messages.at(-1).content);
    assert.ok(feedback.VALIDATION_ISSUES.some(i=>i.code==='DUPLICATE_TARGET'));
    assert.equal(feedback.LOCAL_QUERY_RESULT[0].record.title,'新的项目报告标题');
    return {reply:'已重读最新记录，请确认标记完成。',changes:[{taskId:id,action:'complete'}]};
  }});
  await service.send('可以，按你的建议来吧');
  const action=chat.messages().at(-1).actions[0];
  assert.equal(action.title,'新的项目报告标题');assert.notEqual(store.task(id).status,'done');
  chat.resolve(action.id,'apply');assert.equal(store.task(id).status,'done');store.close();
});

test('search pagination covers later records and date filtering happens before pagination',async()=>{
  const f=await setup(async()=>({reply:'ok'}));
  for(let i=0;i<25;i++)f.store.ingest({text:'分页项目'+i},analyzeLocal('提醒提交分页项目',new Date(),true),{title:'分页项目'+i,dueAt:i===24?'2026-11-03T08:00:00Z':'2026-10-01T08:00:00Z',remindAt:null,priority:'medium'});
  const call={type:'search',scope:'tasks',status:'all',query:'分页项目'},opened=new Map(),refs=new Map();
  let result=f.service.query(call,opened,refs),ids=new Set();
  while(true){result.items.forEach(i=>ids.add(i.id));if(!result.hasMore)break;result=f.service.query({...call,offset:result.nextOffset},opened,refs);}
  assert.equal(ids.size,25);
  const tomorrow=f.service.query({...call,from:'2026-11-03T00:00:00+08:00',before:'2026-11-04T00:00:00+08:00'},opened,refs);
  assert.equal(tomorrow.total,1);assert.equal(tomorrow.items[0].title,'分页项目24');
  assert.equal(tomorrow.items[0].analysis.engine,'local');
  const original=f.service.query({type:'read',scope:'tasks',id:tomorrow.items[0].id},opened,refs);
  assert.equal(original.record.analysis.engine,'local');f.store.close();
});

test('invalid structured suggestions receive bounded correction feedback instead of immediate failure',async()=>{
  let calls=0;
  const f=await setup(async(_model,messages)=>{
    if(++calls===1)return {reply:'需要删除',changes:[{taskId:'bad',action:'delete'}]};
    assert.ok(JSON.parse(messages.at(-1).content).VALIDATION_ISSUES.length);
    return {reply:'当前不支持删除，可以先核对后标记完成。'};
  });
  const before=f.store.tasks();await f.service.send('按建议整理');
  assert.equal(calls,2);assert.deepEqual(f.store.tasks(),before);assert.equal(f.chat.messages().at(-1).detail.error,undefined);f.store.close();
});

test('agent future search shares the UI schedule boundary and excludes undated and completed tasks', async()=>{
  const now=new Date(2026,10,3,14),store=await Store.open(),chat=new ChatStore(store);
  const create=(title,time,status)=>{const a={shouldRemind:true,title,dueAt:time,remindAt:time,priority:'medium',confidence:1,reason:'fixture'};const r=store.ingest({text:title},a,a);if(status==='done')store.updateTask(r.id,'complete');return r.id;};
  const future=create('未来提交',new Date(2026,10,4,0).toISOString());
  create('今日提交',new Date(2026,10,3,16).toISOString());create('过期提交',new Date(2026,10,2,16).toISOString());create('无日期',null);create('已完成',new Date(2026,10,5,0).toISOString(),'done');
  let calls=0;
  const service=new ChatService(store,chat,()=>({enabled:true}),{now:()=>now,request:async(_model,messages)=>{
    if(++calls===1)return {calls:[{type:'search',scope:'tasks',query:'',status:'future'}]};
    const result=JSON.parse(messages.at(-1).content).LOCAL_QUERY_RESULT[0];assert.equal(result.total,1);assert.equal(result.items[0].id,future);return {reply:'明天有一条安排。'};
  }});
  try{await service.send('查看未来安排');assert.equal(calls,2);assert.equal(chat.messages().at(-1).detail.error,undefined);}finally{store.close();}
});
