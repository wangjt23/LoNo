import { _electron } from 'playwright';
import { Store } from '../src/core/store.js';
import { mkdtempSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const profile = mkdtempSync(path.join(os.tmpdir(), 'college-ui-'));
const output = path.resolve('artifacts/college'); mkdirSync(output, { recursive: true });
const store = await Store.open(path.join(profile, 'reminders.sqlite'));
const now = new Date();
for (const [source, title, sender, hour, priority] of [
  ['email', '提交项目阶段报告', '科研办公室', 17, 'high'],
  ['wecom', '确认周例会参会名单', '项目协调组', 15, 'medium'],
  ['manual', '整理实验记录与复盘', '', 20, 'low'],
]) {
  const due = new Date(now); due.setDate(due.getDate() + 1); due.setHours(hour, 0, 0, 0);
  store.ingest({ source, text: `请于明天${hour}点前${title}。`, sender }, { shouldRemind: true, title, dueAt: due.toISOString(), remindAt: new Date(+due - 3600000).toISOString(), priority, confidence: .95, reason: '演示数据：根据正文概括行动，识别截止时间并提前一小时提醒。', engine: source === 'manual' ? 'local' : 'model' });
}
store.saveMemory({ kind: 'workflow', content: '阶段报告通常先整理实验结果，再由项目负责人审核。' }); store.close();
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ args: ['.', '--smoke', `--data-dir=${profile}`], env });
try {
  let main;
  for (let i = 0; i < 150 && !main; i++) { main = app.windows().find(w => w.url().endsWith('/index.html')); if (!main) await new Promise(r => setTimeout(r, 50)); }
  await main.locator('.task-row').first().waitFor();
  // A fixed pale canvas makes renderer screenshots deterministic. Native Acrylic
  // is checked separately on the guarded compositor fixture, never a work desktop.
  await main.evaluate(() => { document.documentElement.style.backgroundColor = '#f5edf2'; });
  await main.screenshot({ path: path.join(output, 'workspace.png') });
  await main.locator('[data-view="memories"]').click();
  await main.locator('.memory-row').waitFor();
  await main.screenshot({ path: path.join(output, 'memories.png') });
  await main.evaluate(() => window.reminder.invoke('capture'));
  const capture = app.windows().find(w => w.url().includes('capture=1'));
  await capture.locator('#capture-text').waitFor();
  await capture.evaluate(() => { document.documentElement.style.backgroundColor = '#f2e4ec'; });
  await capture.locator('#capture-text').fill('明天下午三点提醒我提交项目阶段报告');
  await capture.screenshot({ path: path.join(output, 'spotlight.png') });
  console.log(JSON.stringify({ screenshots: output, palette: ['#881E55', '#D14AA4', '#E27DBE', '#262626'], data: 'synthetic only' }));
} finally { await app.close(); }
