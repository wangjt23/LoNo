import test from 'node:test';
import assert from 'node:assert/strict';
import { isToday, isOverdue } from '../src/ui/task-views.js';

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
