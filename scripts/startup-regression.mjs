import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron } from 'playwright';
const runtime = createRequire(import.meta.url)('electron');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const fixture = path.resolve('scripts/fixtures/startup-race');
for (const scenario of ['quit', 'close']) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lono-startup-'));
  const report = path.join(dir, 'events.jsonl');
  const child = spawn(runtime, [fixture, '--smoke', `--data-dir=${dir}`, `--race-case=${scenario}`, `--race-report=${report}`], { env, windowsHide: true, stdio: 'ignore' });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${scenario}: startup exit hung`)); }, 10000);
    child.on('exit', code => { clearTimeout(timer); resolve(code); }); child.on('error', reject);
  });
  const events = readFileSync(report, 'utf8');
  assert.equal(code, 0); assert.ok(events.includes('capture-load-1')); assert.ok(events.includes('quit')); assert.ok(!events.includes('error-dialog'));
  console.log(`${scenario}: clean exit while capture page is loading`);
}
const dir = mkdtempSync(path.join(os.tmpdir(), 'lono-capture-retry-'));
const report = path.join(dir, 'events.jsonl');
const app = await _electron.launch({ args: [fixture, '--smoke', `--data-dir=${dir}`, '--race-case=retry', `--race-report=${report}`], env });
try {
  let main;
  for (let i = 0; i < 150 && !main; i++) { main = app.windows().find(w => w.url().endsWith('/index.html')); if (!main) await new Promise(r => setTimeout(r, 50)); }
  await main.getByRole('heading', { name: '提醒总览' }).waitFor();
  await main.locator('.runtime-notice p').filter({ hasText: '快捷输入暂时无法加载' }).waitFor({ state: 'attached' });
  assert.ok((await main.evaluate(() => window.reminder.invoke('snapshot'))).runtime.captureWarning);
  await main.locator('[data-action="capture"]').first().click();
  let capture;
  for (let i = 0; i < 150 && !capture; i++) { capture = app.windows().find(w => w.url().includes('capture=1')); if (!capture) await new Promise(r => setTimeout(r, 20)); }
  await capture.locator('#capture-text').waitFor();
  assert.equal((await main.evaluate(() => window.reminder.invoke('snapshot'))).runtime.captureWarning, '');
  assert.ok(!readFileSync(report, 'utf8').includes('error-dialog'));
  console.log('retry: main window survives a capture load failure; quick capture successfully retries');
} finally { await app.close(); }
