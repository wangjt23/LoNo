export function isOverdue(task, now = new Date()) {
  return task.status !== 'done' && Boolean(task.due_at) && Date.parse(task.due_at) < +now;
}
export function isToday(task, now = new Date()) {
  return task.status !== 'done' && !isOverdue(task, now) && Boolean(task.remind_at) && new Date(task.remind_at).toDateString() === now.toDateString();
}
