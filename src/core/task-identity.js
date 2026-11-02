import { taskInput } from './schemas.js';

// Priority changes do not make an otherwise identical reminder a new event.
export function taskIdentity(fields) {
  const task = taskInput.parse(fields);
  return JSON.stringify([task.title.normalize('NFC').replace(/\s+/g, '').toLocaleLowerCase(), task.dueAt, task.remindAt]);
}
