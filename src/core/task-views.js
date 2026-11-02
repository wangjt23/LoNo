const validTime = value => Boolean(value) && Number.isFinite(Date.parse(value));
export function isReview(task) {
  return task.status !== 'done' && !validTime(task.due_at) && !validTime(task.remind_at);
}
export function isOverdue(task, now = new Date()) {
  const time = validTime(task.due_at) ? task.due_at : task.remind_at;
  return task.status !== 'done' && validTime(time) && Date.parse(time) < +now;
}
export function isToday(task, now = new Date()) {
  return task.status !== 'done' && !isOverdue(task, now) && Boolean(task.remind_at) && new Date(task.remind_at).toDateString() === now.toDateString();
}
