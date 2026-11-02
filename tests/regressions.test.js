import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import { analyzeLocal, parseDate } from '../src/core/analyzer.js';
import { pollMail } from '../src/core/connectors.js';

const now = new Date(2026, 10, 2, 10);
const analysis = () => analyzeLocal('一小时后提醒我提交材料', new Date(), true);

test('quarter hours, half-hour offsets and malformed durations do not produce wrong dates or crash', () => {
  assert.equal(parseDate('明天下午三点一刻开会', now).getMinutes(), 15);
  assert.equal(parseDate('明天下午三点三刻开会', now).getMinutes(), 45);
  assert.equal(+parseDate('半小时后提醒', now), +now + 1800000);
  assert.equal(parseDate('999999999999999天后提醒', now), null);
  assert.doesNotThrow(() => analyzeLocal('明天提交，提前半半小时提醒', now));
  assert.equal(analyzeLocal('明天提交，提前半半小时提醒', now).remindAt, null);
});

test('mixed completed and actionable clauses are not silently discarded', () => {
  assert.equal(analyzeLocal('材料已经提交，请明天下午三点审核', now).shouldRemind, true);
  assert.equal(analyzeLocal('资料仅供参考；请明天确认参会人数', now).shouldRemind, true);
  assert.equal(analyzeLocal('材料已经提交，无需处理', now).shouldRemind, false);
  assert.equal(new Date(analyzeLocal('今天已经提交，请明天下午三点审核', now).dueAt).getDate(), 3);
});

test('editing the title after snoozing past the deadline preserves the follow-up time', async () => {
  const store = await Store.open();
  try {
    const a = analysis(); const time = new Date(Date.now() - 1000).toISOString();
    const { id } = store.ingest({ text: '提交材料' }, a, { ...a, dueAt: time, remindAt: time });
    store.updateTask(id, 'snooze'); const task = store.tasks()[0];
    store.updateTask(id, 'edit', { title: '提交材料（跟进）', priority: 'high', dueAt: task.due_at, remindAt: task.remind_at });
    assert.equal(store.tasks()[0].remind_at, task.remind_at);
  } finally { store.close(); }
});

test('editing a completed task preserves completion, timestamp and notification state', async () => {
  const store = await Store.open();
  try {
    const a = analysis(); const { id } = store.ingest({ text: '提交材料' }, a, a);
    store.notified(id); store.updateTask(id, 'complete'); const before = store.tasks()[0];
    store.updateTask(id, 'edit', { ...a, title: '修正标题' }); const after = store.tasks()[0];
    assert.equal(after.status, 'done'); assert.equal(after.completed_at, before.completed_at);
    assert.equal(after.notified_at, before.notified_at); assert.equal(store.due(new Date(Date.now() + 86400000)).length, 0);
  } finally { store.close(); }
});

test('late notification callback cannot mark an edited or snoozed schedule as delivered', async () => {
  const store = await Store.open();
  try {
    const a = analysis(); const { id } = store.ingest({ text: '提交材料' }, a, a);
    const original = store.tasks()[0]; store.updateTask(id, 'snooze');
    store.notified(id, new Date(), original.revision);
    assert.equal(store.tasks()[0].notified_at, null);
    const current = store.tasks()[0]; store.notified(id, new Date(), current.revision);
    assert.ok(store.tasks()[0].notified_at);
  } finally { store.close(); }
});

test('failed disk writes roll back inserts, edits and cursors in memory and on disk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-io-'));
  const filename = path.join(dir, 'records.sqlite'); const store = await Store.open(filename);
  const originalRename = fs.renameSync;
  try {
    const a = analysis(); const { id } = store.ingest({ key: 'existing', text: '提交材料' }, a, a);
    fs.renameSync = () => { throw new Error('simulated disk error'); };
    assert.throws(() => store.ingest({ key: 'new', text: '新任务' }, a, a), /disk error/);
    assert.equal(store.hasRecord('new'), false); assert.equal(store.tasks().length, 1);
    assert.throws(() => store.updateTask(id, 'complete'), /disk error/);
    assert.equal(store.tasks()[0].status, 'pending');
    assert.throws(() => store.setState('cursor', 'advanced'), /disk error/);
    assert.equal(store.state('cursor'), null);
    fs.renameSync = originalRename;
    const reopened = await Store.open(filename);
    try { assert.equal(reopened.tasks().length, 1); assert.equal(reopened.tasks()[0].status, 'pending'); } finally { reopened.close(); }
    store.ingest({ key: 'new', text: '新任务' }, a, a); assert.equal(store.tasks().length, 2);
  } finally { fs.renameSync = originalRename; store.close(); fs.rmSync(dir, { recursive: true }); }
});

test('existing SQLite databases migrate without losing tasks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shiguang-migrate-'));
  const filename = path.join(dir, 'records.sqlite'); let store = await Store.open(filename);
  try {
    const a = analysis(); store.ingest({ key: 'existing', text: '提交材料' }, a, a);
    if (store.all('PRAGMA table_info(tasks)').some(c => c.name === 'revision')) store.db.run('ALTER TABLE tasks DROP COLUMN revision');
    store.persist(); store.close(); store = await Store.open(filename);
    assert.equal(store.tasks().length, 1); assert.equal(store.tasks()[0].revision, 0);
  } finally { store.close(); fs.rmSync(dir, { recursive: true }); }
});

test('empty first IMAP poll records a UID boundary so later backlog is not truncated to 50', async () => {
  let initial = true;
  class Client {
    on() {} async connect() {} async logout() {}
    async mailboxOpen() { return { uidValidity: 12n, uidNext: initial ? 101 : 161 }; }
    async search(query) { if (initial) return []; assert.equal(query.uid, '101:*'); return Array.from({ length: 60 }, (_, n) => n + 101); }
    async fetchOne(uid) { return { source: Buffer.from(`Subject: task ${uid}\r\n\r\nPlease submit`), internalDate: now }; }
  }
  const config = { host: 'host', port: 993, user: 'user', password: 'pass' };
  const first = await pollMail(config, {}, async () => {}, Client); assert.equal(first.uid, 100);
  initial = false; const items = [];
  const second = await pollMail(config, first, async m => items.push(m), Client);
  assert.equal(items.length, 50); assert.equal(second.uid, 150); assert.equal(second.remaining, 10);
  assert.ok(items[0].text.includes('task 101'));
});


test('IMAP bootstrap searches fourteen days and fetches only the newest fifty; next poll is incremental', async()=>{
  let searchCount=0,fetchCount=0;
  class Client {
    on(){} async connect(){} async logout(){}
    async mailboxOpen(){return {uidValidity:42n,uidNext:61};}
    async search(query){if(++searchCount===1){const age=Date.now()-query.since.getTime();assert.ok(age>=14*86400000&&age<14*86400000+2000);return Array.from({length:60},(_,i)=>i+1);}assert.equal(query.uid,'61:*');return [60];}
    async fetchOne(uid){fetchCount++;return {source:Buffer.from('Subject: task '+uid+'\r\n\r\nPlease submit'),internalDate:new Date()};}
  }
  const mail={host:'example.test',port:993,user:'fixture',password:'fixture'},ids=[];
  const state=await pollMail(mail,{},async m=>ids.push(m.key),Client);
  assert.equal(state.count,50);assert.equal(fetchCount,50);assert.equal(state.uid,60);assert.ok(ids[0].endsWith(':11'));
  const next=await pollMail(mail,state,async()=>assert.fail('no new mail'),Client);assert.equal(next.count,0);assert.equal(fetchCount,50);
});
