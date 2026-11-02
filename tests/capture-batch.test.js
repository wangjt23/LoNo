import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptureService, analyzeCapture } from '../src/core/capture-service.js';
import { Store } from '../src/core/store.js';

const now = new Date('2026-11-03T10:00:00+08:00');
const course = day => ({shouldRemind:true,title:`参加微课程 ${day} · B401，带电脑`,dueAt:`2026-11-${day}T14:30:00+08:00`,remindAt:`2026-11-${day}T14:00:00+08:00`,priority:'medium',confidence:.95,reason:'课程开始前30分钟提醒。'});
const text = '微课程：10月28日14:30；11月04日14:30；11月05日14:30；11月11日14:30；11月12日14:30。深圳河套学院 B401，自备电脑。';
const model = {enabled:true};

test('capture splits a course series, normalizes timezone and omits past sessions without a hidden single-item truncation', async()=>{
  const result = await analyzeCapture(text,{now,model,request:async(_model,messages,options)=>{
    assert.ok(messages[0].content.includes('每节课程'));assert.equal(options.maxTokens,8192);
    return {tasks:[{...course('04'),title:'过去的课程',dueAt:'2026-10-28T14:30:00+08:00',remindAt:'2026-10-28T14:00:00+08:00'},...['04','05','11','12'].map(course)]};
  }});
  assert.equal(result.tasks.length,4);assert.equal(result.skippedPast,1);
  assert.equal(result.tasks[0].dueAt,'2026-11-04T06:30:00.000Z');
  assert.ok(result.tasks.every(t=>t.engine==='model'&&t.title.includes('电脑')));
});

test('capture saves only selected edited items atomically; token cannot be replayed and sources keep the entire input',async()=>{
  const store=await Store.open();
  try{
    const service=new CaptureService(store,()=>({model}),{now:()=>now,analyze:async()=>({tasks:['04','05','11','12'].map(course)})});
    const preview=await service.preview(text);assert.equal(store.tasks().length,0);
    const result=service.save({token:preview.token,items:[{index:0,fields:course('04')},{index:2,fields:{...course('11'),title:'自定义课程标题'}}]});
    assert.equal(result.count,2);assert.equal(store.tasks().length,2);assert.ok(store.tasks().some(t=>t.title==='自定义课程标题'));
    assert.ok(store.records().every(r=>r.text===text));
    assert.throws(()=>service.save({token:preview.token,items:[]}),/已保存/);
  }finally{store.close();}
});

test('capture rejects duplicates/invalid selections and retains a failed transaction preview for a safe retry',async()=>{
  const store=await Store.open();
  try{
    const service=new CaptureService(store,()=>({model}),{now:()=>now,analyze:async()=>({tasks:['04','05'].map(course)})});
    const p=await service.preview(text),items=[{index:0,fields:course('04')},{index:1,fields:course('05')}];
    assert.throws(()=>service.save({token:p.token,items:[items[0],items[0]]}),/重复/);
    assert.throws(()=>service.save({token:p.token,items:[]}),/./);
    assert.throws(()=>service.save({token:p.token,items:[{index:19,fields:course('04')}]}),/无效/);
    const persist=store.persist;store.persist=()=>{throw new Error('disk full');};
    assert.throws(()=>service.save({token:p.token,items}),/disk full/);assert.equal(store.tasks().length,0);assert.equal(store.records().length,0);
    store.persist=persist;service.save({token:p.token,items});assert.equal(store.tasks().length,2);
    const again=await service.preview(text);assert.throws(()=>service.save({token:again.token,items}),/已存在/);
  }finally{store.close();}
});

test('capture expires previews and makes model failure or disabled-model single-item fallback explicit',async()=>{
  const failed=await analyzeCapture(text,{now,model,request:async()=>({tasks:[course('04'),{bad:true}]})});
  assert.equal(failed.tasks.length,1);assert.ok(failed.warning);assert.ok(failed.tasks[0].warning);
  const offline=await analyzeCapture(text,{now});assert.equal(offline.tasks.length,1);assert.ok(offline.warning.includes('一条'));
  const store=await Store.open();let clock=+now;
  try{
    const service=new CaptureService(store,()=>({model:{}}),{now:()=>new Date(clock)}),p=await service.preview('明天提交');
    clock+=31*60000;assert.throws(()=>service.save({token:p.token,fields:course('04')}),/过期/);
  }finally{store.close();}
});
