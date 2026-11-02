import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { TaskReviewService } from '../src/core/task-review-service.js';
import { analyzeLocal } from '../src/core/analyzer.js';

const proposal = { shouldRemind: true, title: '提交项目阶段报告', dueAt: '2099-11-03T15:00:00+08:00', remindAt: '2099-11-03T14:00:00+08:00', priority: 'high', confidence: .95, reason: '按原文重新识别行动和截止时间。', engine: 'model', warning: null, summary: { overview: '提交项目阶段报告。', keyPoints: ['明天下午三点前提交。'], engine: 'model', model: 'fixture', generatedAt: '2026-11-02T08:00:00Z' } };
async function setup(analyzeImpl = async () => proposal) {
  const store = await Store.open();
  const source = { source: 'email', text: '项目通知\n明天下午三点前提交项目阶段报告', receivedAt: '2026-11-02T08:00:00Z' };
  const { id, recordId } = store.ingest(source, analyzeLocal(source.text, new Date(source.receivedAt), true));
  const service = new TaskReviewService(store, () => ({ enabled: true }), { analyzeImpl });
  return { store, service, id, recordId };
}
const fields = a => ({ title: a.title, dueAt: a.dueAt, remindAt: a.remindAt, priority: a.priority });

test('review re-reads original data at source time; preview makes no changes and confirmed apply persists AI provenance', async () => {
  const { store, service, id, recordId } = await setup(async (text, options) => {
    assert.ok(text.includes('明天下午')); assert.equal(options.now.toISOString(), '2026-11-02T08:00:00.000Z');
    assert.equal(options.manual, undefined); assert.equal(options.source, 'email'); return proposal;
  });
  const before = store.task(id); const preview = await service.preview(id);
  assert.deepEqual(store.task(id), before);
  service.apply({ token: preview.token, fields: fields(proposal) });
  assert.equal(store.task(id).title, proposal.title); assert.equal(store.task(id).priority, 'high');
  assert.equal(store.task(id).revision, before.revision + 1);
  assert.equal(JSON.parse(store.record(recordId).analysis).engine, 'model');
  assert.deepEqual(JSON.parse(store.record(recordId).analysis).summary, proposal.summary);
  assert.throws(() => service.apply({ token: preview.token, fields: fields(proposal) }), /过期/);
  store.close();
});

test('incomplete AI review cannot replace dates while leaving an old summary behind', async () => {
  for (const summary of [undefined, { overview: '缺少重点' }]) {
    const { store, service, id } = await setup(async () => ({ ...proposal, summary }));
    const before = store.task(id);
    await assert.rejects(service.preview(id), /未返回完整摘要/);
    assert.deepEqual(store.task(id), before);
    assert.equal(service.previews.size, 0);
    store.close();
  }
});

test('a stale preview cannot overwrite a task edited or completed in the meantime', async () => {
  const { store, service, id } = await setup();
  const preview = await service.preview(id); store.updateTask(id, 'complete');
  const before = store.task(id);
  assert.throws(() => service.apply({ token: preview.token, fields: fields(proposal) }), /已被修改/);
  assert.deepEqual(store.task(id), before); store.close();
});

test('no-action classification is informational until the user explicitly confirms no action', async () => {
  const { store, service, id } = await setup(async () => ({ ...proposal, shouldRemind: false, title: '电子发票已开具', dueAt: null, remindAt: null }));
  const before = store.task(id); const preview = await service.preview(id);
  assert.equal(store.task(id).status, before.status);
  service.apply({ token: preview.token, decision: 'complete' });
  const after = store.task(id); assert.equal(after.status, 'done'); assert.ok(after.completed_at);
  assert.equal(after.title, before.title); assert.equal(after.due_at, before.due_at); assert.equal(after.text, before.text);
  assert.equal(JSON.parse(after.analysis).reviewDecision, 'no-action-confirmed'); store.close();
});

test('reorganizing a completed task preserves completion and historical schedules remain reviewable rather than firing overdue alarms', async () => {
  const { store, service, id } = await setup(async () => ({ ...proposal, dueAt: '2020-11-03T15:00:00Z', remindAt: '2020-11-03T14:00:00Z' }));
  let preview = await service.preview(id); service.apply({ token: preview.token, fields: fields(preview.analysis) });
  assert.equal(store.task(id).status, 'review'); assert.equal(store.due().length, 0);
  store.updateTask(id, 'complete'); const completedAt = store.task(id).completed_at;
  preview = await service.preview(id); service.apply({ token: preview.token, fields: fields(preview.analysis) });
  assert.equal(store.task(id).status, 'done'); assert.equal(store.task(id).completed_at, completedAt); store.close();
});

test('model failure never applies local fallback and preview expiration is enforced', async () => {
  const { store, id } = await setup();
  const failed = new TaskReviewService(store, () => ({ enabled: true }), { analyzeImpl: async () => ({ ...proposal, engine: 'local' }) });
  const before = store.task(id); await assert.rejects(failed.preview(id), /AI 整理失败/); assert.deepEqual(store.task(id), before);
  let now = 1000;
  const service = new TaskReviewService(store, () => ({ enabled: true }), { analyzeImpl: async () => proposal, now: () => now });
  const preview = await service.preview(id); now += 16 * 60000;
  assert.throws(() => service.apply({ token: preview.token, fields: fields(proposal) }), /过期/); store.close();
});
