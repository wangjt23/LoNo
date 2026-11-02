import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, analyzeLocal, parseDate, validateEndpoint } from '../src/core/analyzer.js';
import { Store } from '../src/core/store.js';
import { pollBridge, pollMail } from '../src/core/connectors.js';
import { Config } from '../src/core/config.js';

const now = new Date(2026, 10, 2, 10, 0); // Monday, desktop local time
test('Chinese dates, weekdays, AM/PM, lead time, invalid dates', () => {
  assert.equal(parseDate('明天下午三点提交', now).getHours(), 15);
  assert.equal(parseDate('明天下午三点提交', now).getDate(), 3);
  assert.equal(parseDate('下周一上午十点', now).getDate(), 9);
  assert.equal(parseDate('周五下午三点半', now).getMinutes(), 30);
  assert.equal(parseDate('2026年11月5日 14:30', now).getDate(), 5);
  assert.equal(parseDate('30分钟后提醒', now).getTime(), +now + 1800000);
  assert.equal(parseDate('2月30日', now), null);
  assert.equal(parseDate('今天25:00', now), null);
  const lead = analyzeLocal('明天下午三点开会，提前30分钟提醒', now);
  assert.equal(Date.parse(lead.dueAt) - Date.parse(lead.remindAt), 1800000);
});
test('missing date and noise are not scheduled', () => {
  assert.equal(analyzeLocal('请准备材料', now).remindAt, null);
  assert.equal(analyzeLocal('广告促销，请点击链接', now).shouldRemind, false);
  assert.equal(analyzeLocal('仅供参考，无需回复', now).shouldRemind, false);
  assert.equal(analyzeLocal('紧急！今天提交材料', now).priority, 'high');
  assert.equal(analyzeLocal('材料已经提交，无需处理', now).shouldRemind, false);
});
test('timezone offsets are normalized before SQLite comparisons', async () => {
  const store = await Store.open();
  try {
    const a = analyzeLocal('请提交', now, true);
    store.ingest({ text: '请提交' }, a, { ...a, dueAt: '2026-11-02T16:00:00+08:00', remindAt: '2026-11-02T15:00:00+08:00' });
    assert.equal(store.due(new Date('2026-11-02T07:01:00Z')).length, 1);
    assert.equal(store.tasks()[0].remind_at, '2026-11-02T07:00:00.000Z');
  } finally { store.close(); }
});
test('settings retain existing secrets, reject invalid config and fail closed without encryption', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'reminder-config-'));
  const safe = { isAsyncEncryptionAvailable: async () => true, encryptStringAsync: async s => Buffer.from(s.split('').reverse().join('')), decryptStringAsync: async b => ({ result: b.toString().split('').reverse().join('') }) };
  const c = new Config(path.join(dir, 'settings.json'), safe);
  try {
    const input = c.public(); input.model.apiKey = 'secret'; await c.save(input);
    assert.equal(c.public().model.apiKey, ''); assert.equal(c.public().model.hasApiKey, true);
    await c.save(c.public()); assert.equal(c.value.model.apiKey, 'secret');
    const reloaded = new Config(c.filename, safe); await reloaded.load(); assert.equal(reloaded.value.model.apiKey, 'secret');
    const invalid = c.public(); invalid.pollMinutes = 0; await assert.rejects(c.save(invalid)); assert.equal(c.value.pollMinutes, 10);
    safe.isAsyncEncryptionAvailable = async () => false;
    await assert.rejects(c.save(c.public()), /加密不可用/);
    const cleared = c.public(); cleared.model.clearSecret = true; await c.save(cleared); assert.equal(c.value.model.apiKey, '');
  } finally { rmSync(dir, { recursive: true }); }
});
test('model failure and malformed output fall back with a visible warning', async () => {
  const result = await analyze('明天开会', { now, model: { enabled: true, endpoint: 'http://localhost:8080' }, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"shouldRemind":true}' } }] })) });
  assert.equal(result.engine, 'local'); assert.ok(result.warning);
  assert.throws(() => validateEndpoint('http://remote.example.com'));
  assert.throws(() => validateEndpoint('https://user:pass@example.com'));
});
test('model schema validates dates, and captures cannot disappear', async () => {
  const value = { shouldRemind: false, title: '检查', dueAt: null, remindAt: null, priority: 'medium', confidence: 0.9, reason: '无日期' };
  const result = await analyze('检查', { manual: true, model: { enabled: true, endpoint: 'https://example.com' }, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] })) });
  assert.equal(result.shouldRemind, true); assert.equal(result.engine, 'model');
});
test('SQLite persists records, deduplicates and tracks notification/completion', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'reminder-test-'));
  const filename = path.join(dir, 'reminders.sqlite');
  let store = await Store.open(filename);
  try {
    const a = analyzeLocal('1小时后提醒提交材料', new Date(), true);
    const result = store.ingest({ key: 'a', text: 'test' }, a, { ...a, remindAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal(store.ingest({ key: 'a', text: 'test' }, a).duplicate, true);
    assert.equal(store.due().length, 1);
    store.notified(result.id); assert.equal(store.due().length, 0);
    store.updateTask(result.id, 'complete'); assert.equal(store.tasks()[0].status, 'done');
    store.close(); store = await Store.open(filename);
    assert.equal(store.tasks().length, 1); assert.equal(store.tasks()[0].status, 'done');
    store.updateTask(result.id, 'restore'); assert.equal(store.due().length, 1);
    store.updateTask(result.id, 'snooze'); assert.equal(store.due().length, 0);
    store.ingest({ key: 'b', text: '仅供参考' }, analyzeLocal('仅供参考', now));
    assert.equal(store.records().length, 2); assert.equal(store.tasks().length, 1);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
test('bridge validates data, uses token/cursor, stable deduplication key', async () => {
  const data = { messages: [{ id: '1', text: '明天开会', sentAt: now.toISOString(), sender: '张老师' }], nextCursor: 'next' };
  const result = await pollBridge({ endpoint: 'http://localhost:8080/messages', token: 'secret' }, 'old', async (url, opts) => {
    assert.equal(url.searchParams.get('cursor'), 'old'); assert.equal(opts.headers.Authorization, 'Bearer secret');
    return new Response(JSON.stringify(data));
  });
  assert.equal(result.cursor, 'next'); assert.equal(result.messages[0].source, 'wecom');
  await assert.rejects(pollBridge({ endpoint: 'http://localhost' }, '', async () => new Response(JSON.stringify({ messages: [{ id: 'x' }] }))));
});
test('IMAP checkpoints only consumed UIDs and reads the mailbox without marking read', async () => {
  class MockClient {
    on() {} async connect() {} async logout() {}
    async mailboxOpen(_name, options) { assert.equal(options.readOnly, true); return { uidValidity: 12n }; }
    async search() { return [3, 4, 5]; }
    async fetchOne(uid) { return { source: Buffer.from(`Subject: task ${uid}\r\nFrom: sender@example.com\r\n\r\nPlease submit tomorrow`), internalDate: now }; }
  }
  const items = [];
  const state = await pollMail({ host: 'host', port: 993, user: 'user', password: 'pass', mailbox: 'INBOX' }, { validity: '12', uid: 3 }, async m => items.push(m), MockClient);
  assert.equal(items.length, 2); assert.equal(state.uid, 5); assert.equal(state.validity, '12');
  assert.ok(items[0].text.includes('task 4'));
});
