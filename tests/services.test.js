import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { MessageService } from '../src/core/message-service.js';
import { SummaryService } from '../src/core/summary-service.js';
import { analyzeLocal } from '../src/core/analyzer.js';
import { requestModelJson } from '../src/core/model-client.js';

test('concurrent connector deliveries share one analysis and retry a failed job without advancing data', async () => {
  const store = await Store.open(); let calls = 0;
  const service = new MessageService(store, () => ({ model: { enabled: false }, mail: { extractMemory: false } }), { analyzeImpl: async text => { calls++; await new Promise(r => setTimeout(r, 10)); return analyzeLocal(text); } });
  const message = { key: 'ews:test:1', source: 'email', sender: '项目组', receivedAt: new Date().toISOString(), text: '明天提交材料' };
  await Promise.all([service.consume(message), service.consume(message)]);
  assert.equal(calls, 1); assert.equal(store.records().length, 1);
  await service.consume(message); assert.equal(calls, 1);
  await assert.rejects(service.consume({ ...message, key: 'bad', receivedAt: 'invalid' }), /来源时间/);
  assert.equal(store.hasRecord('bad'), false); assert.equal(service.jobs.size, 0);
  await service.consume({ ...message, key: 'bad' }); assert.equal(calls, 2); assert.equal(store.hasRecord('bad'), true);
  store.close();
});

test('summary jobs deduplicate, retain an existing summary on failure and allow retry', async () => {
  const store = await Store.open(); const { recordId } = store.ingest({ text: '明天提交材料' }, analyzeLocal('明天提交材料'));
  let calls = 0, fail = false;
  const service = new SummaryService(store, () => ({ enabled: true }), async () => {
    calls++; await new Promise(r => setTimeout(r, 10)); if (fail) throw new Error('network failed');
    return { overview: '请提交材料。', keyPoints: ['明天提交。'], engine: 'model', model: 'fixture', generatedAt: new Date().toISOString() };
  });
  await Promise.all([service.generate(recordId), service.generate(recordId)]); assert.equal(calls, 1);
  const saved = store.record(recordId).analysis; fail = true;
  await assert.rejects(service.generate(recordId)); assert.equal(store.record(recordId).analysis, saved);
  assert.equal(service.jobs.size, 0); fail = false; await service.generate(recordId); assert.equal(calls, 3);
  store.close();
});

test('shared model transport rejects unsafe endpoints before credentials leave and isolates provider options', async () => {
  let calls = 0;
  await assert.rejects(requestModelJson({ enabled: true, endpoint: 'http://remote.example/test', apiKey: 'never-send' }, [], { fetchImpl: async () => { calls++; } }));
  assert.equal(calls, 0);
  await requestModelJson({ enabled: true, endpoint: 'https://model.example/test', model: 'fixture' }, [], { fetchImpl: async (_url, options) => {
    assert.equal(JSON.parse(options.body).thinking, undefined); assert.equal(options.redirect, 'error');
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }));
  } });
});
