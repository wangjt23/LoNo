import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { analyze, analyzeLocal } from '../src/core/analyzer.js';
import { summarizeSource } from '../src/core/summary.js';
import { readableSource } from '../src/core/source-text.js';

const summary = { overview: '提交项目材料，并按要求核对附件。', keyPoints: ['行动：提交阶段材料。', '时间：明天下午三点前。', '要求：核对附件清单。'] };
const model = { enabled: true, endpoint: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash', apiKey: 'test-only' };
const reply = value => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }));

test('AI summaries normalize legacy text, validate JSON and send only the source context', async () => {
  const result = await summarizeSource('提交材料&#xD;核对附件', { model, receivedAt: '2026-11-02T08:00:00Z', fetchImpl: async (_url, options) => {
    const payload = JSON.parse(options.body), input = JSON.parse(payload.messages[1].content);
    assert.equal(input.text, '提交材料\n核对附件');
    assert.equal(input.receivedAt, '2026-11-02T08:00:00Z');
    assert.equal(input.remindAt, undefined); assert.equal(input.memories, undefined);
    assert.deepEqual(payload.thinking, { type: 'disabled' });
    assert.equal(options.redirect, 'error');
    return reply(summary);
  } });
  assert.equal(result.engine, 'model'); assert.equal(result.model, 'deepseek-flash'); assert.equal(result.keyPoints.length, 3);
});

test('standalone summary generation never fabricates a local fallback on model failure', async () => {
  await assert.rejects(summarizeSource('提交材料', { model: { enabled: false } }), /启用模型/);
  for (const value of [{ overview: '概述', keyPoints: [] }, { overview: '概述', keyPoints: ['x'.repeat(241)] }, { summary: 'wrong shape' }]) {
    await assert.rejects(summarizeSource('提交材料', { model, fetchImpl: async () => reply(value) }), /未生成/);
  }
});

test('saving a summary preserves every task field and the original source, including completed reminders', async () => {
  const store = await Store.open();
  const text = '明天下午三点提交材料&#xD;核对附件';
  const { recordId, id } = store.ingest({ text }, analyzeLocal(text, new Date(), true));
  store.updateTask(id, 'complete');
  const before = store.tasks()[0]; const record = store.record(recordId);
  const result = { ...summary, engine: 'model', model: model.model, generatedAt: new Date().toISOString() };
  store.setRecordSummary(recordId, result);
  const after = store.tasks()[0];
  const { analysis: oldAnalysis, ...oldFields } = before, { analysis: newAnalysis, ...newFields } = after;
  assert.deepEqual(newFields, oldFields);
  assert.equal(store.record(recordId).text, record.text);
  assert.deepEqual(JSON.parse(newAnalysis).summary, result);
  assert.throws(() => store.setRecordSummary(recordId, { ...result, keyPoints: [] }));
  assert.deepEqual(JSON.parse(store.record(recordId).analysis).summary, result);
  store.close();
});

test('new task analysis accepts AI summary while an invalid optional summary cannot spoil a valid reminder', async () => {
  const base = { shouldRemind: true, title: '提交项目材料', dueAt: null, remindAt: null, priority: 'medium', confidence: .5, reason: '等待确认日期' };
  const result = await analyze('提交项目材料', { model, fetchImpl: async () => reply({ ...base, summary }) });
  assert.equal(result.summary.engine, 'model'); assert.equal(result.summary.keyPoints.length, 3);
  const invalid = await analyze('提交项目材料', { model, fetchImpl: async () => reply({ ...base, summary: { keyPoints: 'invalid' } }) });
  assert.equal(invalid.engine, 'model'); assert.equal(invalid.title, base.title); assert.equal(invalid.summary, undefined);
});

test('source character references remain plain text and invalid Unicode cannot crash rendering', () => {
  assert.equal(readableSource('A&amp;B&#xD;&#10;C&nbsp;D'), 'A&B\nC D');
  assert.equal(readableSource('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>');
  assert.equal(readableSource('&#x110000; &#xD800;'), '&#x110000; &#xD800;');
});
