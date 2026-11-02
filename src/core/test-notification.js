import { EventEmitter } from 'node:events';

// Desktop tests must not initialize Electron's native presenter: it registers
// shortcuts and COM identity in the user's real Windows profile.
export class TestNotification extends EventEmitter {
  static isSupported() { return true; }
  constructor(options) { super(); this.options = options; }
  show() { queueMicrotask(() => { this.emit('show'); this.emit('close'); }); }
  close() { this.emit('close'); }
}
