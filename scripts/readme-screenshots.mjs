// Product screenshots from the real renderer, with an isolated synthetic profile.
import { _electron } from 'playwright';
import { Store } from '../src/core/store.js';
import { ChatStore } from '../src/core/chat-store.js';
import { defaults } from '../src/core/config.js';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const profile = mkdtempSync(path.join(os.tmpdir(), 'lono-readme-'));
const output = path.resolve('docs/images');
mkdirSync(output, { recursive: true });
const date = (days, hours, minutes = 0) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hours, minutes, 0, 0); return d.toISOString(); };
const store = await Store.open(path.join(profile, 'reminders.sqlite'));
const entries = [
  ['email', '提交项目阶段报告', '项目办公室', date(1, 15), 'high'],
  ['wecom', '确认周例会参会名单', '项目协调组', date(1, 17), 'medium'],
  ['manual', '整理本周阅读笔记', '', date(2, 20), 'low'],
  ['email', '核对合作项目联系人', '合作团队', null, 'medium'],
  ['manual', '补充报销材料附件', '', date(-1, 17), 'medium'],
];
for (const [source, title, sender, dueAt, priority] of entries) {
  store.ingest({ source, text: `${title}。${dueAt ? '请按约定时间完成，提交前核对材料是否齐全。' : '具体时间另行确认。'}`, sender }, {
    shouldRemind: true, title, dueAt, remindAt: dueAt ? new Date(Date.parse(dueAt) - 3600000).toISOString() : null,
    priority, confidence: .96, reason: '根据示例通知整理行动和时间，保存前可核对修改。', engine: source === 'manual' ? 'local' : 'model',
    summary: { overview: `${title}，并核对相关信息。`, keyPoints: ['确认材料完整后再提交。', '如有变更，及时联系项目协调组。'] },
  });
}
for (const [kind, content] of [
  ['preference', '重要会议习惯提前一天提醒，方便预留准备时间。'],
  ['workflow', '阶段报告先汇总项目进度，再由负责人审核后提交。'],
  ['fact', '项目协调组负责收集周例会参会名单。'],
]) store.saveMemory({ kind, content });
const task = store.tasks().find(t => t.title === entries[0][1]);
const chat = new ChatStore(store);
chat.append('user', '帮我梳理接下来的安排，项目阶段报告优先处理。');
chat.finish('建议先准备项目阶段报告，明天下午三点前提交；随后确认周例会参会名单。阅读笔记安排在后天，联系人核对还需要补充时间。\n\n报销材料已经过期，可以先补齐附件，再与对方确认是否需要重新约定提交时间。', {
  actions: [], memories: [], references: [{ scope: 'tasks', id: task.id, title: task.title }],
}, '帮我梳理接下来的安排，项目阶段报告优先处理。');
store.close();

const server = http.createServer((req, res) => {
  req.resume(); req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
      shouldRemind: true, title: '提交项目阶段报告', dueAt: date(1, 15), remindAt: date(1, 14, 30),
      priority: 'high', confidence: .97, reason: '明天下午三点截止，提前半小时提醒。',
      summary: { overview: '明天下午三点前提交项目阶段报告，预留半小时做最后检查。', keyPoints: ['汇总项目进度，核对材料是否齐全。', '确认提交版本，并按时发送给项目办公室。'] },
    }) } }] }));
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const settings = structuredClone(defaults);
settings.model = { enabled: true, endpoint: `http://127.0.0.1:${server.address().port}/chat/completions`, model: 'demo', apiKey: '' };
writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ version: 1, settings, secrets: null }));
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await _electron.launch({ args: ['.', '--smoke', `--data-dir=${profile}`], env });
  let main;
  for (let i = 0; i < 200 && !main; i++) { main = app.windows().find(w => w.url().endsWith('/index.html')); if (!main) await new Promise(r => setTimeout(r, 50)); }
  if (!main) throw new Error('Workspace did not load');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html')).setContentSize(1260, 1000));
  await main.locator('.task-row').first().waitFor();
  await main.locator('button:focus').evaluateAll(buttons => buttons.forEach(button => button.blur()));
  // Flatten compositor transparency for reproducible renderer captures.
  await main.evaluate(() => { document.documentElement.style.backgroundColor = '#f5edf2'; });
  await main.screenshot({ path: path.join(output, 'overview.png') });
  await main.locator(`[data-action="edit"][data-id="${task.id}"]`).first().click();
  await main.locator('[data-action="review-task"]').click();
  await main.locator('.ai-review').waitFor();
  await main.screenshot({ path: path.join(output, 'ai-review.png') });
  await main.locator('#editor [data-action="close"]').click();
  await main.locator('[data-view="chat"]').click();
  await main.locator('.chat-message.assistant').waitFor();
  await main.locator('button:focus').evaluateAll(buttons => buttons.forEach(button => button.blur()));
  await main.screenshot({ path: path.join(output, 'agent.png') });
  await main.locator('[data-view="memories"]').click();
  await main.locator('.memory-row').first().waitFor();
  await main.locator('button:focus').evaluateAll(buttons => buttons.forEach(button => button.blur()));
  await main.screenshot({ path: path.join(output, 'memory.png') });
  await main.locator('.new-button').click();
  const capture = app.windows().find(w => w.url().includes('capture=1'));
  await capture.locator('#capture-text').waitFor();
  await capture.evaluate(() => { document.documentElement.style.backgroundColor = '#f2e4ec'; });
  await capture.locator('#capture-text').fill('明天下午三点提醒我提交项目阶段报告，提前半小时提醒');
  await capture.locator('#capture-text').press('Enter');
  await capture.locator('#capture-save-form').waitFor();
  await capture.screenshot({ path: path.join(output, 'quick-capture.png') });
  console.log(JSON.stringify({ output, data: 'synthetic only', runtime: (await main.evaluate(() => window.reminder.invoke('snapshot'))).runtime.shortcutWarning }));
} finally {
  if (app) await app.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
