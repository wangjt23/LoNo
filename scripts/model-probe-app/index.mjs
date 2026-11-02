import { analyzeCapture } from '../../src/core/capture-service.js';
import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import initSqlJs from 'sql.js';
import { Config } from '../../src/core/config.js';
import { analyze, analyzeLocal } from '../../src/core/analyzer.js';
import { Store } from '../../src/core/store.js';
import { TaskReviewService } from '../../src/core/task-review-service.js';
import { ChatStore } from '../../src/core/chat-store.js';
import { ChatService } from '../../src/core/chat-service.js';
import { extractMemories } from '../../src/core/memory.js';
import { summarizeSource } from '../../src/core/summary.js';
const profile = process.argv.find(a => a.startsWith('--profile='))?.slice(10);
if (!profile) throw new Error('需要 profile；不接收密钥参数');
const probeProfile = fs.mkdtempSync(path.join(app.getPath('temp'), 'lono-model-probe-'));
// Async safeStorage needs the profile's DPAPI-protected os_crypt key. Reuse
// only that encrypted context locally, while keeping cache/locks independent.
const stateFile = path.join(profile, 'Local State');
if (fs.existsSync(stateFile)) {
  const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  if (state.os_crypt) fs.writeFileSync(path.join(probeProfile, 'Local State'), JSON.stringify({ os_crypt: state.os_crypt }));
}
app.setPath('userData', probeProfile);
app.whenReady().then(async () => {
  let stage = 'config';
  try {
    const config = new Config(path.join(profile, 'settings.json'), safeStorage); await config.load();
    if(process.argv.includes('--batch-actions-only')) {
      const sample='课程安排（2026年）：10月28日14:30-15:30 昇腾AI基础软硬件平台；11月4日14:30-17:30 模型自动训练与推理；11月5日14:30-17:30 算子自动开发与优化；11月11日14:30-17:30 模型自动适配与调优；11月12日14:30-17:30 多卡并行的模型训推。地点：深圳河套学院B401。自备笔记本电脑。请给每节未来课程建一条提醒，上课时提醒。';
      stage='capture-series';const capture=await analyzeCapture(sample,{model:config.value.model,now:new Date('2026-11-03T10:00:00+08:00')});
      if(capture.tasks.length!==4||capture.tasks.some(t=>t.engine!=='model'))throw new Error('课表未拆分为4条模型提醒');
      const expectedDates=['2026-11-04','2026-11-05','2026-11-11','2026-11-12'];
      if(JSON.stringify(capture.tasks.map(t=>new Date(t.dueAt).toISOString().slice(0,10)).sort())!==JSON.stringify(expectedDates)||capture.tasks.some(t=>Date.parse(t.remindAt)!==Date.parse(t.dueAt)))throw new Error('课程日期或上课时提醒未准确保留');
      const store=await Store.open(),chat=new ChatStore(store),agent=new ChatService(store,chat,()=>config.value.model,{now:()=>new Date('2026-11-03T10:00:00+08:00')});
      stage='agent-create';await agent.send(sample);let message=chat.messages().at(-1);
      if(message.actions.length!==4||message.actions.some(a=>a.action!=='create')||store.tasks().length!==0)throw new Error('未正确生成4条待确认创建建议');
      if(JSON.stringify(message.actions.map(a=>new Date(a.fields.dueAt).toISOString().slice(0,10)).sort())!==JSON.stringify(expectedDates)||message.actions.some(a=>Date.parse(a.fields.remindAt)!==Date.parse(a.fields.dueAt)))throw new Error('Agent课程日期或上课时提醒未准确保留');
      chat.resolveMessage(message.id,'apply');if(store.tasks().length!==4)throw new Error('创建确认失败');
      stage='agent-edit';await agent.send('把11月4日那节课的标题末尾加上（测试），其余不变。');message=chat.messages().at(-1);
      if(message.actions.length!==1||message.actions[0].action!=='edit')throw new Error('未生成编辑建议');chat.resolveMessage(message.id,'apply');
      stage='agent-delete';await agent.send('删除11月12日那节课的事项，其余保留。');message=chat.messages().at(-1);
      if(message.actions.length!==1||message.actions[0].action!=='delete')throw new Error('未生成删除建议');chat.resolveMessage(message.id,'apply');
      if(store.tasks().length!==3||store.records().length!==4)throw new Error('删除后来源保留验证失败');
      console.log(JSON.stringify({connected:true,syntheticInputOnly:true,captureReminders:4,agentConfirmedCreates:4,agentConfirmedEdits:1,agentConfirmedDeletes:1,sourceRecordsRetained:true}));store.close();app.quit();return;
    }
    if (process.argv.includes('--chat-only') || process.argv.includes('--chat-followup-only')) {
      const store = await Store.open(), chat = new ChatStore(store);
      const {id} = store.ingest({text:'请提交合成测试项目报告'},analyzeLocal('请提交合成测试项目报告',new Date(),true));
      const service = new ChatService(store,chat,()=>config.value.model);
      if (process.argv.includes('--chat-followup-only')) {
        stage='first-analysis';
        await service.send('先找到合成测试项目报告，建议将重要程度提高为high，但这轮只给文字建议，不要生成修改操作。');
        if (chat.messages().at(-1).actions.length) throw new Error('应先只分析');
        stage='followup'; await service.send('可以，按你的建议来吧。');
        const action=chat.messages().at(-1).actions[0];
        if (!action || action.taskId!==id || action.fields?.priority!=='high' || store.task(id).priority==='high') throw new Error('未正确接续历史建议');
        chat.resolve(action.id,'apply');
        console.log(JSON.stringify({connected:true,analysisThenApproval:true,confirmedChange:store.task(id).priority==='high',syntheticInputOnly:true}));
        store.close();app.quit();return;
      }
      await service.send('帮我找到合成测试项目报告，把重要程度改为high，只生成建议，不要猜测时间。');
      const proposal = chat.messages().at(-1).actions[0];
      if (!proposal || store.task(id).priority === 'high') throw new Error('未生成独立修改建议');
      chat.resolve(proposal.id,'apply');
      await service.send('我习惯重要会议提前一天提醒，请把这个长期偏好提炼为候选记忆。');
      if (!store.memories().some(m=>m.status==='candidate')) throw new Error('未返回候选记忆');
      console.log(JSON.stringify({connected:true,chatSearchAndProposal:true,confirmedChange:store.task(id).priority==='high',candidateMemory:true,syntheticInputOnly:true}));
      store.close();app.quit();return;
    }
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
  } catch (error) { console.log(JSON.stringify({ connected: false, stage, errorType:error.name, detail:process.argv.includes('--batch-actions-only')||stage==='config'||/^(未正确|应先|Agent|模型未|模型请求|查询轮数)/.test(error.message)?error.message:undefined, message: '模型验证未完成；未输出密钥或邮件正文' })); app.exit(1); }
});
