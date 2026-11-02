import { _electron as electron } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';

const dir = mkdtempSync(path.join(os.tmpdir(), 'shiguang-desktop-'));
const artifacts = path.resolve('artifacts'); mkdirSync(artifacts, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({ executablePath: process.env.SHIGUANG_EXECUTABLE || undefined, args: [...(process.env.SHIGUANG_EXECUTABLE ? [] : ['.']), '--smoke', `--data-dir=${dir}`], env, timeout: 30000 });
async function mainPage(app) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const main = app.windows().find(w => w.url().endsWith('/index.html'));
    if (main) return main;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Main workspace did not load');
}
let bridgeCalls = 0, modelCalls = 0, modelDelay = 0;
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.url.startsWith('/messages')) {
    assert.equal(req.headers.authorization, 'Bearer bridge-test-secret'); bridgeCalls++;
    res.end(JSON.stringify({ messages: [{ id: 'test-1', text: '明天下午三点请提交桥接测试材料', sender: '项目组', sentAt: new Date().toISOString() }], nextCursor: 'cursor-1' }));
  } else {
    assert.equal(req.headers.authorization, 'Bearer model-test-secret'); modelCalls++;
    let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
      assert.ok(JSON.parse(body).messages[1].content.includes('提交'));
      const due = new Date(Date.now() + 86400000).toISOString();
      setTimeout(() => res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ shouldRemind: true, title: '提交桥接测试材料', dueAt: due, remindAt: due, priority: 'high', confidence: 0.95, reason: '模拟模型识别到明确行动与截止日期。' }) } }] })), modelDelay);
    });
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
let app;
const errors = [];
try {
  app = await launch();
  const main = await mainPage(app);
  main.on('pageerror', error => errors.push(error.message));
  await main.getByRole('heading', { name: '提醒总览' }).waitFor();
  await main.screenshot({ path: path.join(artifacts, '01-empty.png') });
  await main.locator('.new-button').click();
  const capture = app.windows().find(w => w.url().includes('capture=1'));
  assert.ok(capture, 'quick capture window exists');
  capture.on('pageerror', error => errors.push(error.message));
  await capture.locator('#capture-text').waitFor();
  await capture.waitForFunction(() => document.activeElement?.id === 'capture-text');
  assert.equal(await capture.locator('[data-action="close"]').count(), 0, 'Spotlight panel has no close button');
  await capture.screenshot({ path: path.join(artifacts, '00-quick-capture.png') });
  assert.ok(await capture.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), 'collapsed capture fits without scrolling');
  await capture.locator('#capture-text').fill('未保存的草稿');
  await app.evaluate(({ BrowserWindow }) => { const main = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')); main.show(); main.moveTop(); main.focus(); });
  await main.locator('.page-heading h1').click();
  await main.waitForTimeout(150);
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('capture=1')).isVisible()), false, 'outside click dismisses the panel');
  await main.locator('.new-button').click();
  await capture.waitForFunction(() => document.activeElement?.id === 'capture-text');
  assert.equal(await capture.locator('#capture-text').inputValue(), '未保存的草稿', 'outside click preserves draft');
  await capture.locator('#capture-text').press('Escape');
  await main.locator('.new-button').click();
  assert.equal(await capture.locator('#capture-text').inputValue(), '未保存的草稿', 'Escape preserves draft');
  await capture.locator('#capture-text').fill('明天下午三点提醒我提交项目材料，提前半小时提醒');
  await capture.locator('#capture-text').press('Enter');
  await capture.locator('#capture-save-form').waitFor();
  const reminder = await capture.locator('[name="remindAt"]').inputValue();
  assert.ok(reminder.endsWith('14:30'), `Chinese date/lead parse: ${reminder}`);
  assert.ok(await capture.evaluate(() => { const b = document.querySelector('#capture-save-form button[type="submit"]').getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; }), 'save action fits in the expanded capture');
  await capture.screenshot({ path: path.join(artifacts, '02-capture.png') });
  await capture.locator('#capture-text').press('Control+Enter');
  await main.locator('.task-row').waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('capture=1')).isVisible()), false, 'saving dismisses the capture window');
  await main.keyboard.press('Control+f');
  assert.equal(await main.locator('#search').evaluate(el => el === document.activeElement), true);
  await main.locator('#search').fill('不匹配的搜索词');
  assert.equal(await main.locator('.task-row').count(), 0);
  await main.locator('#search').fill('');
  await main.locator('.task-check').click();
  await main.locator('[data-view="done"]').click();
  await main.locator('.task-row.completed').waitFor();
  await main.locator('.task-title').click();
  await main.locator('#edit-form [name="title"]').fill('已完成任务的标题修正');
  await main.locator('#edit-form button[type="submit"]').click();
  await main.locator('.task-row.completed').waitFor();
  assert.equal((await main.evaluate(() => window.reminder.invoke('snapshot'))).tasks[0].status, 'done');
  await main.locator('.task-check').click();
  await main.locator('[data-view="all"]').click();
  await main.locator('.task-title').click();
  await main.locator('#edit-form [name="title"]').fill('提交项目材料（已核对）');
  await main.locator('#edit-form button[type="submit"]').click();
  await main.getByText('提交项目材料（已核对）', { exact: true }).waitFor();
  await main.locator('[data-view="settings"]').click();
  await main.locator('[name="bridge.enabled"]').check();
  await main.locator('[name="bridge.endpoint"]').fill(`${url}/messages`);
  await main.locator('[name="bridge.token"]').fill('bridge-test-secret');
  await main.locator('[name="model.enabled"]').check();
  await main.locator('[name="model.endpoint"]').fill(`${url}/chat/completions`);
  await main.locator('[name="model.model"]').fill('mock-agent');
  await main.locator('[name="model.apiKey"]').fill('model-test-secret');
  await main.locator('#settings-form button[type="submit"]').click();
  await main.getByText('设置已安全保存', { exact: true }).waitFor();
  await main.locator('.new-button').click();
  await capture.getByText('已启用模型 · 内容将发送到配置的模型服务', { exact: true }).waitFor();
  modelDelay = 250;
  await capture.locator('#capture-text').fill('明天提交旧内容');
  await capture.locator('#analyze-button').click();
  await capture.locator('#capture-text').fill('后天提交新内容');
  await capture.getByText('输入已修改，请重新分析', { exact: true }).waitFor();
  assert.equal(await capture.locator('#capture-save-form').count(), 0, 'stale analysis cannot be saved for edited input');
  assert.equal(await capture.locator('#capture-text').inputValue(), '后天提交新内容');
  modelDelay = 0;
  const modelCallsBeforeBridge = modelCalls;
  assert.ok(!readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('test-secret'), 'secrets must be encrypted');
  await main.locator('[data-view="sources"]').click();
  await main.locator('[data-action="sync"]').click();
  await main.getByText('新增 1 条记录', { exact: true }).waitFor();
  await main.locator('[data-action="sync"]').click();
  await main.getByText('新增 0 条记录', { exact: true }).waitFor();
  assert.equal(bridgeCalls, 2); assert.equal(modelCalls - modelCallsBeforeBridge, 1, 'duplicate sources do not call Agent again');
  await main.screenshot({ path: path.join(artifacts, '03-sources.png') });
  await main.locator('[data-view="all"]').click();
  assert.equal(await main.locator('.task-row').count(), 2);
  assert.equal(await main.locator('nav button.active').count(), 1);
  assert.equal(await main.locator('nav button.active').getAttribute('data-view'), 'all');
  await main.mouse.move(1100, 70);
  await main.locator('#toast').evaluate(el => el.className = '');
  await main.waitForTimeout(180); // Let hover/toast transitions settle before visual QA.
  await main.screenshot({ path: path.join(artifacts, '04-workspace.png') });
  const snapshot = await main.evaluate(() => window.reminder.invoke('snapshot'));
  assert.equal(snapshot.tasks.length, 2); assert.ok(snapshot.tasks.some(t => t.source === 'manual'));
  assert.equal(snapshot.settings.model.apiKey, ''); assert.equal(snapshot.settings.bridge.token, '');
  assert.equal(await main.evaluate(() => typeof window.require), 'undefined');
  // Export using the actual dialog path while replacing only OS file picking.
  const exportFile = path.join(dir, 'export.json');
  await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }); }, exportFile);
  await main.locator('[data-view="sources"]').click();
  await main.locator('[data-action="export"]').click();
  await main.getByText('记录已导出（不包含连接密钥）', { exact: true }).waitFor();
  assert.equal(JSON.parse(readFileSync(exportFile, 'utf8')).records.length, 2);
  for (const key of snapshot.runtime.shortcuts) {
    const registered = await app.evaluate(({ globalShortcut }, accelerator) => globalShortcut.isRegistered(accelerator), key.accelerator);
    assert.equal(key.registered, registered);
  }
  assert.equal(snapshot.runtime.shortcutOK, snapshot.runtime.shortcuts.some(key => key.registered));
  if (!snapshot.runtime.shortcuts[0].registered) assert.ok(snapshot.runtime.shortcutWarning.includes('占用'), 'primary conflict exposes fallback or tray guidance');
  await app.close(); app = undefined;
  assert.ok(existsSync(path.join(dir, 'reminders.sqlite')));
  app = await launch();
  const restarted = await mainPage(app);
  await restarted.locator('.task-row').first().waitFor();
  assert.equal(await restarted.locator('.task-row').count(), 2, 'records survive restart');
  const restored = await restarted.evaluate(() => window.reminder.invoke('snapshot'));
  assert.equal(restored.settings.model.hasApiKey, true, 'OS encrypted credentials decrypt on restart');
  assert.ok(!restored.runtime.startupWarning.includes('设置或系统密钥无法读取'), 'encrypted settings load on restart even when another app owns the shortcut');
  // Stub only OS notification delivery: exercise the real scheduler and SQLite state.
  await app.evaluate(({ Notification }) => {
    globalThis.testNotificationCalls = 0;
    Notification.prototype.show = function () { globalThis.testNotificationCalls++; this.emit('failed', {}, 'test failure'); };
  });
  const failedDelivery = await restarted.evaluate(() => window.reminder.invoke('smoke', 'due'));
  assert.ok(failedDelivery.tasks.some(t => t.status === 'pending' && Date.parse(t.remind_at) < Date.now() && !t.notified_at), 'failed delivery is not marked sent');
  await app.evaluate(({ Notification }) => { Notification.prototype.show = function () { globalThis.testNotificationCalls++; this.emit('show'); this.emit('close'); }; });
  const delivered = await restarted.evaluate(() => window.reminder.invoke('smoke', 'check'));
  assert.ok(delivered.tasks.some(t => t.notified_at), 'successful notification persisted');
  await restarted.evaluate(() => window.reminder.invoke('smoke', 'check'));
  assert.equal(await app.evaluate(() => globalThis.testNotificationCalls), 2, 'failed delivery retries; successful delivery does not repeat');
  // An old visible notification must not suppress a newer schedule or acknowledge it late.
  await app.evaluate(({ Notification }) => { globalThis.oldNotification = null; Notification.prototype.show = function () { globalThis.testNotificationCalls++; globalThis.oldNotification = this; }; });
  await restarted.evaluate(() => window.reminder.invoke('smoke', 'due'));
  const oldTask = (await restarted.evaluate(() => window.reminder.invoke('snapshot'))).tasks.find(t => t.status === 'pending' && Date.parse(t.remind_at) < Date.now() && !t.notified_at);
  await restarted.evaluate(id => window.reminder.invoke('update-task', { id, action: 'snooze' }), oldTask.id);
  await app.evaluate(() => globalThis.oldNotification.emit('show'));
  assert.equal((await restarted.evaluate(() => window.reminder.invoke('snapshot'))).tasks.find(t => t.id === oldTask.id).notified_at, null);
  const countBeforeNewSchedule = await app.evaluate(() => globalThis.testNotificationCalls);
  await restarted.evaluate(() => window.reminder.invoke('smoke', 'due'));
  assert.equal(await app.evaluate(() => globalThis.testNotificationCalls), countBeforeNewSchedule + 1, 'old visible notification does not block a snoozed schedule');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: 'passed', assertions: 'compact/expanded capture layout, keyboard analyze/save, Escape draft retention, Ctrl+F search, completion/restore/edit, encrypted settings, bridge + Agent, deduplication, export, sandbox, shortcut conflict handling, restart, notification failure/retry/deduplication', executable: process.env.SHIGUANG_EXECUTABLE || 'development Electron', dataDir: dir, screenshots: artifacts }, null, 2));
} finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
