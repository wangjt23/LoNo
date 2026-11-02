import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import initSqlJs from 'sql.js';
import { Config } from '../../src/core/config.js';
import { analyze, analyzeLocal } from '../../src/core/analyzer.js';
import { Store } from '../../src/core/store.js';
import { TaskReviewService } from '../../src/core/task-review-service.js';
import { extractMemories } from '../../src/core/memory.js';
import { summarizeSource } from '../../src/core/summary.js';
const profile = process.argv.find(a => a.startsWith('--profile='))?.slice(10);
if (!profile) throw new Error('需要 profile；不接收密钥参数');
app.setPath('userData', path.resolve(profile));
app.whenReady().then(async () => {
  try {
    const config = new Config(path.join(profile, 'settings.json'), safeStorage); await config.load();
    const sample = 'FW: 关于相关事项的说明\n请于2026年11月3日下午三点前提交项目验收材料，提前一小时提醒。';
    if (process.argv.includes('--task-review-only')) {
      const store = await Store.open();
      const text = '电子发票已开具\n发票已发送到附件，仅供留存，无需回复或办理。开票日期为2026年10月28日。';
      const { id } = store.ingest({ source: 'email', text, receivedAt: '2026-10-28T08:00:00Z' }, analyzeLocal(text, new Date('2026-10-28T08:00:00Z'), true));
      const before = JSON.stringify(store.task(id));
      const review = await new TaskReviewService(store, () => config.value.model).preview(id);
      const unchanged = JSON.stringify(store.task(id)) === before;
      console.log(JSON.stringify({ connected: true, model: review.analysis.engine, noActionSuggested: !review.analysis.shouldRemind, previewUnchanged: unchanged, syntheticInputOnly: true }));
      store.close(); app.quit(); return;
    }
    if (process.argv.includes('--summary-only')) {
      const summary = await summarizeSource(sample, { model: config.value.model, receivedAt: new Date().toISOString() });
      console.log(JSON.stringify({ connected: true, summaryEngine: summary.engine, summaryPointCount: summary.keyPoints.length, syntheticInputOnly: true }));
      app.quit(); return;
    }
    const result = await analyze(sample, { source: 'email', model: config.value.model });
    if (result.engine !== 'model') throw new Error('模型分析未通过');
    const memory = await extractMemories('报销流程通常先整理发票，再提交部门审核。', { model: config.value.model });
    if (memory.engine !== 'model' || !memory.memories.length) throw new Error('模型记忆提取未通过');
    const SQL = await initSqlJs(); const db = new SQL.Database(fs.readFileSync(path.join(profile, 'reminders.sqlite')));
    const stmt = db.prepare("SELECT text,received_at,sender FROM records WHERE source='email' ORDER BY received_at DESC LIMIT 1");
    const row = stmt.step() ? stmt.getAsObject() : null; stmt.free(); db.close();
    const real = row ? await analyze(row.text, { source: 'email', sender: row.sender, now: new Date(row.received_at), model: config.value.model }) : null;
    console.log(JSON.stringify({ connected: true, model: config.value.model.model, synthetic: { engine: result.engine, titleSummarized: result.title !== sample.split('\n')[0], title: result.title, dueAt: result.dueAt, remindAt: result.remindAt, priority: result.priority }, memoryExtraction: memory.engine, candidateCount: memory.memories.length, realEmail: real ? { engine: real.engine, validStructuredResult: !real.warning, shouldRemind: real.shouldRemind } : null }));
    app.quit();
  } catch { console.log(JSON.stringify({ connected: false, message: '模型验证未完成；未输出密钥或邮件正文' })); app.exit(1); }
});
