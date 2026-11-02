import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/core/store.js';
import { analyze, analyzeLocal } from '../src/core/analyzer.js';
import { extractMemories, extractLocalMemories } from '../src/core/memory.js';

test('durable workflow candidates retain evidence, deduplicate, require approval and survive restart', async () => {
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'shiguang-memory-')), 'test.sqlite');
  let store = await Store.open(file);
  const text = '报销流程通常先整理发票，再提交部门审核。明天提交材料。';
  const { recordId } = store.ingest({ text }, analyzeLocal(text));
  const candidate = store.memories()[0];
  assert.equal(store.memories().length, 1);
  assert.equal(candidate.record_id, recordId);
  assert.ok(text.includes(candidate.evidence));
  assert.deepEqual(store.recall('报销发票如何整理'), []);
  assert.equal(store.addMemoryCandidates(recordId, extractLocalMemories(text)), 0);
  assert.throws(() => store.addMemoryCandidates(recordId, [{ kind: 'fact', content: '虚构的事实', evidence: '不在原文里' }]));
  store.saveMemory({ ...candidate, status: 'approved' });
  assert.equal(store.recall('报销发票如何整理')[0].id, candidate.id);
  assert.deepEqual(store.recall('服务器备份'), []);
  store.close(); store = await Store.open(file);
  assert.equal(store.recall('报销发票')[0].status, 'approved');
  store.saveMemory({ ...candidate, content: '报销流程已更新，先提交电子发票', status: 'dismissed' });
  assert.deepEqual(store.recall('报销流程'), []);
  store.deleteMemory(candidate.id);
  assert.deepEqual(store.memories(), []);
  store.close();
});

test('local extraction avoids one-off tasks and model extraction refuses invented evidence', async () => {
  assert.deepEqual(extractLocalMemories('明天下午三点提交项目材料'), []);
  const text = '我习惯提前半小时提醒会议';
  const model = { enabled: true, endpoint: 'https://model.example/test', model: 'test' };
  const fake = memories => async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ memories }) } }] }));
  const valid = await extractMemories(text, { model, fetchImpl: fake([{ kind: 'preference', content: text, evidence: text }]) });
  assert.equal(valid.engine, 'model');
  const invalid = await extractMemories(text, { model, fetchImpl: fake([{ kind: 'fact', content: '任意结论', evidence: '编造证据' }]) });
  assert.equal(invalid.engine, 'local');
  assert.ok(invalid.warning);
  assert.equal(invalid.memories[0].content, text);
});

test('disabling email memory extraction also suppresses local candidates', async () => {
  const store = await Store.open();
  const text = '报销流程通常先整理发票，再提交部门审核';
  store.ingest({ source: 'email', text }, analyzeLocal(text), undefined, false);
  assert.equal(store.records().length, 1); assert.deepEqual(store.memories(), []);
  store.close();
});

test('model analysis only receives confirmed memories and records the exact supplied context', async () => {
  const memories = [{ id: 'yes', status: 'approved', kind: 'workflow', content: '项目材料先经过部门审核' }, { id: 'no', status: 'candidate', kind: 'fact', content: '不应发送' }];
  const result = await analyze('明天提交项目材料', {
    memories, model: { enabled: true, endpoint: 'https://model.example/test', model: 'test' },
    fetchImpl: async (_url, options) => {
      const input = JSON.parse(JSON.parse(options.body).messages[1].content);
      assert.equal(input.confirmedMemories.length, 1);
      assert.equal(input.confirmedMemories[0].id, 'yes');
      assert.ok(input.memoryPolicy.includes('原文明确日期'));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shouldRemind: true, title: '提交项目材料', dueAt: null, remindAt: null, priority: 'medium', confidence: 0.5, reason: '请确认日期' }) } }] }));
    },
  });
  assert.equal(result.memoryContext[0].id, 'yes');
  assert.equal(result.dueAt, null);
});
