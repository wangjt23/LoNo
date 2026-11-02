const validTime = value => Boolean(value) && Number.isFinite(Date.parse(value));
export function isReview(task) {
  return task.status !== 'done' && !validTime(task.due_at) && !validTime(task.remind_at);
}
export function isOverdue(task, now = new Date()) {
  const time = validTime(task.due_at) ? task.due_at : task.remind_at;
  return task.status !== 'done' && validTime(time) && Date.parse(time) < +now;
}
function scheduleTime(task) { return validTime(task.remind_at) ? task.remind_at : task.due_at; }
export function isToday(task, now = new Date()) {
  const time = scheduleTime(task);
  return task.status !== 'done' && !isOverdue(task, now) && validTime(time) && new Date(time).toDateString() === now.toDateString();
}

// Schedule views use reminder time, falling back to the deadline for imported records.
export function isFuture(task, now = new Date()) {
  if (task.status === 'done' || isOverdue(task, now)) return false;
  const time = scheduleTime(task);
  const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0);
  return validTime(time) && Date.parse(time) >= +tomorrow;
}
export function matchesTaskView(task, view, now = new Date()) {
  if (view === 'done') return task.status === 'done';
  if (view === 'today') return isToday(task, now);
  if (view === 'future') return isFuture(task, now);
  if (view === 'overdue') return isOverdue(task, now);
  if (view === 'review') return isReview(task);
  return task.status !== 'done';
}
