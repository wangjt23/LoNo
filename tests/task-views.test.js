import test from 'node:test';
import assert from 'node:assert/strict';
import { isToday, isOverdue, isReview } from '../src/ui/task-views.js';

test('today excludes overdue deadlines, older missed reminders and completed tasks', () => {
  const now = new Date(2026, 10, 2, 14);
  const task = { status: 'pending', remind_at: new Date(2026, 10, 2, 15).toISOString(), due_at: new Date(2026, 10, 2, 16).toISOString() };
  assert.equal(isToday(task, now), true);
  const expired = { ...task, due_at: new Date(2026, 10, 2, 13).toISOString() };
  assert.equal(isOverdue(expired, now), true); assert.equal(isToday(expired, now), false);
  assert.equal(isToday({ ...task, remind_at: new Date(2026, 10, 1, 15).toISOString() }, now), false);
  assert.equal(isToday({ ...task, status: 'done' }, now), false);
  assert.equal(isToday({ ...task, due_at: null }, now), true);
});

test('review means no valid time; legacy review statuses with dates belong to scheduled views', () => {
  const now = new Date('2026-11-02T06:00:00Z');
  const unscheduled = { status: 'review', due_at: null, remind_at: null };
  assert.equal(isReview(unscheduled), true);
  assert.equal(isOverdue(unscheduled, now), false);
  assert.equal(isToday(unscheduled, now), false);
  for (const dates of [
    { due_at: '2026-11-01T06:00:00Z' },
    { remind_at: '2026-11-01T06:00:00Z' },
    { due_at: '2026-11-01T06:00:00Z', remind_at: '2026-11-02T07:00:00Z' },
  ]) {
    const task = { ...unscheduled, ...dates };
    assert.equal(isReview(task), false);
    assert.equal(isOverdue(task, now), true);
    assert.equal(isToday(task, now), false);
  }
  const future = { ...unscheduled, due_at: '2026-11-03T06:00:00Z', remind_at: '2026-11-02T07:00:00Z' };
  assert.equal(isReview(future), false);
  assert.equal(isToday(future, now), true);
  assert.equal(isOverdue(future, now), false);
  assert.equal(isReview({ ...unscheduled, status: 'pending' }), true);
  assert.equal(isReview({ ...unscheduled, status: 'done' }), false);
  assert.equal(isReview({ ...unscheduled, due_at: 'invalid' }), true);
});
