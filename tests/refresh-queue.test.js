import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshQueue } from '../src/ui/refresh-queue.js';

test('UI refresh serializes snapshots and applies changes queued while a stale snapshot is pending', async () => {
  let release, started, count = 0, concurrent = 0, maximum = 0, state = 'old';
  const entered = new Promise(r => started = r), gate = new Promise(r => release = r), rendered = [];
  const refresh = createRefreshQueue(async () => {
    count++; concurrent++; maximum = Math.max(maximum, concurrent);
    const snapshot = state;
    if (count === 1) { started(); await gate; }
    rendered.push(snapshot); concurrent--;
  });
  const first = refresh(); await entered;
  state = 'new'; const second = refresh(); refresh(); release();
  await Promise.all([first, second]);
  assert.equal(maximum, 1); assert.deepEqual(rendered, ['old', 'new']);
});
