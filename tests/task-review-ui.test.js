import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTaskReview } from '../src/ui/components/task-review.js';
import { renderAiSummary } from '../src/ui/components/ai-summary.js';

test('review shows changed values and treats equivalent timezone representations as unchanged', () => {
  const current = { title: '<旧标题>', dueAt: '2099-11-03T07:00:00Z', remindAt: null, priority: 'medium' };
  const analysis = { ...current, title: '提交材料', dueAt: '2099-11-03T15:00:00+08:00', remindAt: '2099-11-03T06:00:00Z', shouldRemind: true, reason: '发现提醒时间' };
  const html = renderTaskReview({ analysis }, current);
  assert.equal((html.match(/review-change-label/g) || []).length, 2);
  assert.ok(html.includes('&lt;旧标题&gt;'));
  assert.ok(!html.includes('<旧标题>'));
  assert.ok(html.includes('建议修改 2 项'));
});

test('saved summary is read-only; absent summary renders no duplicate empty action', () => {
  assert.equal(renderAiSummary('record', {}), '');
  const html = renderAiSummary('record', { summary: { engine: 'model', overview: '事项重点', keyPoints: ['提交材料'] } });
  assert.ok(html.includes('事项重点'));
  assert.ok(!html.includes('<button'));
  assert.ok(!html.includes('summarize-record'));
});
