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
