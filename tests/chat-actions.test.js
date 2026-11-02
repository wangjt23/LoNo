import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import { ChatStore } from '../src/core/chat-store.js';
import { ChatService } from '../src/core/chat-service.js';

const fields = n => ({title:`参加第${n}讲 B401 带电脑`,dueAt:`2026-11-${n}T14:30:00+08:00`,remindAt:`2026-11-${n}T14:30:00+08:00`,priority:'medium'});
const create = n => ({action:'create',fields:fields(n),evidence:`11月${n}日`});
const schedule='请每节课建提醒：11月04日、11月05日、11月11日、11月12日，14:30，B401，带电脑。';

test('Agent creates four independently scheduled reminders only after batch confirmation, and persists audit across restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'lono-create-')),file=path.join(dir,'store.sqlite');
  let store=await Store.open(file),chat=new ChatStore(store);
  try{
    const agent=new ChatService(store,chat,()=>({enabled:true}),{request:async()=>({reply:'四节未来课程已列出，请确认。',changes:['04','05','11','12'].map(create)})});
    await agent.send(schedule);const message=chat.messages().at(-1);assert.equal(store.tasks().length,0);assert.equal(message.actions.length,4);
    store.close();store=await Store.open(file);chat=new ChatStore(store);
    chat.resolveMessage(message.id,'apply');assert.equal(store.tasks().length,4);assert.ok(store.tasks().every(t=>t.source==='chat'&&t.text===schedule));
    assert.ok(chat.messages().at(-1).actions.every(a=>a.status==='applied'&&store.task(a.taskId)));
    assert.throws(()=>chat.resolveMessage(message.id,'apply'),/已处理/);
  }finally{store.close();fs.rmSync(dir,{recursive:true});}
});

test('Agent uses a prior user course table for follow-up creation, but cannot invent source evidence',async()=>{
  const store=await Store.open(),chat=new ChatStore(store);let bad=false;
  try{
    chat.append('user',schedule);chat.append('assistant','你要上课时间提醒吗？');
    const agent=new ChatService(store,chat,()=>({enabled:true}),{request:async()=>({reply:'请确认',changes:[bad?{...create('05'),evidence:'我编造的课程'}:create('04')]})});
    await agent.send('上课时间，每节课一个提醒');assert.equal(chat.messages().at(-1).actions.length,1);
    chat.resolveMessage(chat.messages().at(-1).id,'dismiss');assert.equal(store.tasks().length,0);
    bad=true;await assert.rejects(agent.send('再加一条'),/原文依据/);assert.equal(store.tasks().length,0);
  }finally{store.close();}
});

test('mixed creation, edit and delete commit together; deletion keeps original source and failed/stale batch leaves everything untouched',async()=>{
  const store=await Store.open(),chat=new ChatStore(store);let rounds=0;
  try{
    const seed=f=>store.ingest({source:'email',text:'已读取课程原文'}, {...f,shouldRemind:true,confidence:1},f);
    const first=seed(fields('04')),second=seed(fields('05'));
    const agent=new ChatService(store,chat,()=>({enabled:true}),{request:async()=>++rounds%2?{calls:[{type:'read',scope:'tasks',id:first.id},{type:'read',scope:'tasks',id:second.id}]}:{reply:'请核对新建、修改和删除。',changes:[create('11'),{taskId:first.id,action:'edit',fields:{...fields('04'),priority:'high'}},{taskId:second.id,action:'delete'}]}});
    await agent.send(schedule+'删除第5日的提醒，并把第4日改为重要');const message=chat.messages().at(-1);
    const persist=store.persist;store.persist=()=>{throw new Error('disk full');};
    assert.throws(()=>chat.resolveMessage(message.id,'apply'),/disk full/);assert.equal(store.tasks().length,2);assert.equal(store.task(first.id).priority,'medium');assert.ok(store.task(second.id));
    store.persist=persist;
    store.updateTask(second.id,'snooze');assert.throws(()=>chat.resolveMessage(message.id,'apply'),/已被修改/);assert.equal(store.tasks().length,2);assert.equal(store.task(first.id).priority,'medium');
    chat.resolveMessage(message.id,'dismiss');
    await agent.send(schedule+'按刚才建议重新生成');const fresh=chat.messages().at(-1);chat.resolveMessage(fresh.id,'apply');
    assert.equal(store.tasks().length,2);assert.equal(store.task(first.id).priority,'high');assert.equal(store.task(second.id),undefined);assert.ok(store.record(second.recordId));
  }finally{store.close();}
});

test('creating an already-existing reminder is rejected both when proposing and when confirming after concurrent insertion',async()=>{
  const store=await Store.open(),chat=new ChatStore(store);
  try{
    const agent=new ChatService(store,chat,()=>({enabled:true}),{request:async()=>({reply:'请确认',changes:[create('04')]})});
    await agent.send(schedule);const pending=chat.messages().at(-1);
    store.ingest({text:schedule},{...fields('04'),shouldRemind:true,confidence:1},fields('04'));
    assert.throws(()=>chat.resolveMessage(pending.id,'apply'),/已存在/);assert.equal(store.tasks().length,1);
    await assert.rejects(agent.send(schedule),/相同标题/);assert.equal(store.tasks().length,1);
  }finally{store.close();}
});


test('Agent automatically repairs paraphrased creation evidence before offering a confirmable action',async()=>{
  const store=await Store.open(),chat=new ChatStore(store);let calls=0;
  try{
    const agent=new ChatService(store,chat,()=>({enabled:true}),{request:async(_model,messages)=>{
      if(++calls===1)return {reply:'请确认',changes:[create('04')]};
      assert.equal(JSON.parse(messages.at(-1).content).VALIDATION_ISSUES[0].code,'CREATE_EVIDENCE');
      return {reply:'请确认',changes:[{...create('04'),evidence:'11月4日'}]};
    }});
    await agent.send('11月4日14:30在B401上课，请建提醒');assert.equal(calls,2);assert.equal(store.tasks().length,0);
    chat.resolveMessage(chat.messages().at(-1).id,'apply');assert.equal(store.tasks().length,1);
  }finally{store.close();}
});


test('an incorrect actions key cannot silently turn model operations into a text-only reply',async()=>{
  const store=await Store.open(),chat=new ChatStore(store);let calls=0;
  try{
    const agent=new ChatService(store,chat,()=>({enabled:true}),{request:async(_model,messages)=>{
      if(++calls===1)return {reply:'请确认创建',actions:[create('04')]};
      assert.ok(JSON.parse(messages.at(-1).content).VALIDATION_ISSUES.length);
      return {reply:'请确认创建',changes:[create('04')]};
    }});
    await agent.send(schedule);assert.equal(calls,2);assert.equal(chat.messages().at(-1).actions.length,1);assert.equal(store.tasks().length,0);
  }finally{store.close();}
});
