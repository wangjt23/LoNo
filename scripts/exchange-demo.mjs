import { _electron } from 'playwright';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { analyzeLocal } from '../src/core/analyzer.js';
import { demoMessages, installDemoExchange } from './fixtures/exchange-demo.mjs';

const video = process.argv.includes('--video');
const timed = process.argv.includes('--timer');
const cleanVideo = process.argv.includes('--clean-video');
const timeline = []; let recordingStart = 0;
const dir = mkdtempSync(path.join(os.tmpdir(), 'shiguang-ews-demo-'));
const output = path.resolve('artifacts/demo'); mkdirSync(output, { recursive: true });
async function workspace(app) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const page = app.windows().find(p => p.url().endsWith('/index.html'));
    if (page) return page;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('工作区窗口未加载');
}
const messages = demoMessages(); const modelInputs = []; let app, main;
const server = http.createServer((req, res) => {
  let body = ''; req.on('data', chunk => body += chunk); req.on('end', () => {
    const input = JSON.parse(body); const user = JSON.parse(input.messages[1].content); modelInputs.push(user);
    const extraction = input.messages[0].content.includes('提取可长期');
    const evidence = '报销流程通常先整理发票，再提交部门审核';
    const answer = extraction ? { memories: user.text.includes(evidence) ? [{ kind: 'workflow', content: evidence, evidence }] : [] } : { ...analyzeLocal(user.text, new Date(), user.manualCapture), title: user.text.includes('补充报销材料') ? '提交补充报销材料' : user.text.includes('联系人名单') ? '核对项目联系人名单' : user.text.includes('报销材料') ? '提交报销材料' : '阅读园区资讯', reason: user.confirmedMemories?.length ? '已参考确认的报销流程：先整理发票，再提交部门审核。本次截止时间按邮件原文确定。' : '识别邮件中的行动与日期；没有明确日期时交由你确认。' };
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) } }] }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const appArgs = process.env.SHIGUANG_EXECUTABLE ? [] : [process.env.SHIGUANG_APP || '.'];
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const cue = async (title, subtitle, hold = 2000) => {
  console.log(title);
  if (video) timeline.push({ title, subtitle, start: (Date.now() - recordingStart) / 1000, hold: hold / 1000 });
  if (video) {
    if (!cleanVideo) await main.evaluate(({ title, subtitle }) => {
      let el = document.querySelector('#demo-caption');
      if (!el) { el = document.createElement('div'); el.id = 'demo-caption'; el.style.cssText = 'position:fixed;bottom:22px;left:245px;right:24px;z-index:2147483647;padding:18px 24px;border:1px solid #ffffff90;border-radius:18px;background:#132135eb;color:white;box-shadow:0 10px 40px #0002;pointer-events:none;font-family:Segoe UI,Microsoft YaHei,sans-serif;'; document.body.append(el); }
      el.replaceChildren();
      const label = document.createElement('div'); label.textContent = 'LoNo · 产品演示 / 模拟邮箱与模型'; label.style.cssText = 'font-size:11px;color:#a8c5e6;letter-spacing:1px;margin-bottom:6px';
      const h = document.createElement('div'); h.textContent = title; h.style.cssText = 'font-size:20px;font-weight:600;margin-bottom:5px';
      const p = document.createElement('div'); p.textContent = subtitle; p.style.cssText = 'font-size:13px;color:#ced9e7;line-height:1.6';
      el.append(label, h, p);
    }, { title, subtitle });
    await main.waitForTimeout(hold);
  }
};
try {
  app = await _electron.launch({ executablePath: process.env.SHIGUANG_EXECUTABLE || undefined, args: [...appArgs, '--smoke', `--data-dir=${dir}`], env, ...(video ? { recordVideo: { dir: path.join(output, 'raw'), size: { width: 1260, height: 850 } } } : {}) });
  recordingStart = Date.now();
  main = await workspace(app);
  await main.locator('[data-view="settings"]').waitFor();
  if (video) await main.evaluate(() => { document.documentElement.style.setProperty('background', '#f5f5f7', 'important'); document.body.style.setProperty('background', '#f5f5f7', 'important'); });
  const errors = []; main.on('pageerror', e => errors.push(e.message));
  const sync = async () => { await main.evaluate(() => window.reminder.invoke('sync')); await main.waitForTimeout(100); };
  await installDemoExchange(app, messages);
  await cue('散落在邮件里的工作，自动变成提醒', 'Exchange 只读采集 · 日期和重要程度分析 · 本地记忆', 3500);
  await main.locator('[data-view="settings"]').click();
  await main.locator('[name="mail.protocol"]').selectOption('exchange');
  await main.locator('[name="mail.endpoint"]').fill('https://mail.demo.invalid/EWS/Exchange.asmx');
  await main.locator('[name="mail.user"]').fill('demo@example.com');
  await main.locator('[name="mail.password"]').fill('demo-only-not-a-real-password');
  await main.locator('[name="mail.enabled"]').check();
  await main.locator('[name="model.enabled"]').check();
  await main.locator('[name="model.endpoint"]').fill('http://127.0.0.1:' + server.address().port + '/chat/completions');
  await main.locator('[name="model.model"]').fill('demo-model');
  await main.locator('[name="pollMinutes"]').fill(timed ? '1' : '10');
  await cue('01 / 连接单位自建 Exchange', '选择 EWS、填写账号；密码使用系统密钥加密保存。演示账号为虚构数据。', 3000);
  await main.locator('#settings-form [type="submit"]').click();
  await main.getByText('设置已安全保存', { exact: true }).waitFor();
  const began = Date.now();
  await main.locator('[data-view="sources"]').click();
  await sync();
  await main.getByText('已处理 3 封邮件', { exact: true }).waitFor();
  let snapshot = await main.evaluate(() => window.reminder.invoke('snapshot'));
  assert.equal(snapshot.records.length, 3); assert.equal(snapshot.tasks.length, 2);
  assert.equal(snapshot.memories.length, 1); assert.equal(snapshot.memories[0].status, 'candidate');
  assert.ok(snapshot.tasks.some(t => t.status === 'review'));
  assert.ok(!readFileSync(path.join(dir, 'settings.json'), 'utf8').includes('demo-only-not-a-real-password'));
  await cue('02 / 三封邮件，两件需要行动的事', '资讯只留记录；明确日期的待办自动设置提醒；没有时间的事项进入待确认。', 5000);
  await main.locator('[data-view="all"]').click();
  await main.locator('.task-row').filter({ hasText: '提交报销材料' }).locator('[data-action="edit"]').first().click();
  await cue('看得见原文，也能核对提醒时间', '截止时间、提前提醒和分析依据均可修改；采集不修改邮箱已读状态。', 5000);
  await main.locator('#editor [data-action="close"]').click();
  await main.locator('[data-view="memories"]').click();
  await main.locator('[data-action="memory-source"]').click();
  await cue('03 / 从一次通知，沉淀可复用的流程', '候选记忆附带原文证据；只有你确认过的记忆才参与后续分析。', 5000);
  await main.locator('#editor [data-action="close"]').click();
  await main.locator('[data-action="memory-approve"]').click();
  await main.locator('.memory-row').getByText('已确认', { exact: true }).waitFor();
  await app.evaluate(() => { globalThis.ewsDemo.phase = 1; });
  await main.locator('[data-view="sources"]').click();
  if (timed) {
    await cue('04 / 一分钟后，自动发现新增邮件', '这里等待真实轮询计时器；无需手动刷新，助理会继续采集。', 3000);
    console.log('Waiting for the real one-minute polling interval…');
    const deadline = Date.now() + 75000;
    while ((await main.evaluate(() => window.reminder.invoke('snapshot'))).records.length !== 4 && Date.now() < deadline) await main.waitForTimeout(250);
    assert.ok(Date.now() - began >= 55000, 'actual scheduler interval elapsed');
  } else await sync();
  snapshot = await main.evaluate(() => window.reminder.invoke('snapshot'));
  assert.equal(snapshot.records.length, 4); assert.equal(snapshot.tasks.length, 3);
  assert.ok(modelInputs.some(i => i.text.includes('新增报销任务') && i.confirmedMemories?.length === 1));
  await main.locator('[data-view="all"]').click();
  await main.locator('.task-row').filter({ hasText: '提交补充报销材料' }).locator('[data-action="edit"]').first().click();
  await main.getByText('本次提供给模型的记忆（1）', { exact: true }).click();
  await cue('熟悉你的流程，理解下一次任务', '新邮件检索到已确认的报销流程，并保留本次分析使用的背景。截止时间仍以本次邮件为准。', 6000);
  await main.locator('#editor [data-action="close"]').click();
  await main.locator('[data-view="sources"]').click();
  await sync();
  await main.getByText('已处理 0 封邮件', { exact: true }).waitFor();
  assert.equal((await main.evaluate(() => window.reminder.invoke('snapshot'))).records.length, 4);
  await cue('增量同步，不重复创建提醒', '记录、游标、提醒和记忆保存在本地。相同邮件重复同步会自动去重。', 4000);
  if (!video) {
    // Authentication failure pauses subsequent scheduled/manual retries until explicitly resumed.
    await app.evaluate(() => { globalThis.ewsDemo.status = 401; });
    await sync();
    const before = await app.evaluate(() => globalThis.ewsDemo.calls.length);
    await sync();
    assert.equal(await app.evaluate(() => globalThis.ewsDemo.calls.length), before);
    await main.evaluate(() => window.reminder.invoke('resume-mail'));
    await app.evaluate(() => { globalThis.ewsDemo.status = 200; });
    await sync();
  }
  const calls = await app.evaluate(() => globalThis.ewsDemo.calls);
  assert.ok(calls.every(c => ['GetItem', 'SyncFolderItems'].includes(c.operation)));
  assert.deepEqual(errors, []);
  await main.screenshot({ path: path.join(output, 'exchange-workflow.png') });
  const recording = main.video();
  await app.close(); app = undefined;
  if (recording) { await recording.saveAs(path.join(output, 'shiguang-exchange-demo.webm')); writeFileSync(path.join(output, 'timeline.json'), JSON.stringify(timeline, null, 2)); }
  // Verify a new process restores both cursor and approved memory from SQLite.
  app = await _electron.launch({ executablePath: process.env.SHIGUANG_EXECUTABLE || undefined, args: [...appArgs, '--smoke', `--data-dir=${dir}`], env });
  const restarted = await workspace(app); await restarted.locator('[data-view="memories"]').waitFor();
  const restored = await restarted.evaluate(() => window.reminder.invoke('snapshot'));
  assert.equal(restored.records.length, 4); assert.equal(restored.memories[0].status, 'approved');
  assert.equal(restored.settings.mail.hasPassword, true);
  const report = { passed: true, realTimer: timed, simulatedMailboxAndModel: true, records: 4, tasks: 3, memory: 1, operations: calls.length, video: video ? 'shiguang-exchange-demo.webm' : null };
  writeFileSync(path.join(output, video ? 'video-report.json' : 'test-report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report));
} finally { if (app) await app.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
