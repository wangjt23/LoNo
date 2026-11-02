import { app, BrowserWindow, dialog } from 'electron';
import fs from 'node:fs';
const value = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const scenario = value('race-case'), report = value('race-report');
const log = event => fs.appendFileSync(report, JSON.stringify({ event }) + '\n');
dialog.showErrorBox = () => log('error-dialog'); // Never show a real modal in regression tests.
app.on('will-quit', () => log('quit'));
const original = BrowserWindow.prototype.loadFile;
let attempt = 0;
BrowserWindow.prototype.loadFile = function (file, options) {
  if (options?.query?.capture !== '1') return original.call(this, file, options);
  attempt++; log(`capture-load-${attempt}`);
  if (scenario === 'retry') {
    if (attempt === 1) return Promise.reject(new Error('ERR_FAILED (-2) simulated capture load failure'));
    return original.call(this, file, options);
  }
  return new Promise((_resolve, reject) => {
    this.once('closed', () => reject(new Error('ERR_FAILED (-2) capture load canceled by exit')));
    setTimeout(() => {
      if (scenario === 'close') BrowserWindow.getAllWindows().find(w => w !== this)?.close();
      else app.quit();
    }, 30);
  });
};
await import('../../../src/main.js');
