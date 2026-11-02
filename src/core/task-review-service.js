import { randomUUID } from 'node:crypto';
import { analyze } from './analyzer.js';

export class TaskReviewService {
  constructor(store, getModel, { analyzeImpl = analyze, now = () => Date.now() } = {}) {
    this.store = store; this.getModel = getModel; this.analyze = analyzeImpl; this.now = now;
    this.previews = new Map(); this.jobs = new Map();
  }
  preview(id) {
    if (typeof id !== 'string' || id.length > 100) return Promise.reject(new Error('提醒标识无效'));
    if (this.jobs.has(id)) return this.jobs.get(id);
    const task = this.store.task(id), model = this.getModel();
    if (!task) return Promise.reject(new Error('找不到提醒'));
    if (!model.enabled) return Promise.reject(new Error('请先在偏好设置中启用模型，AI 整理不会使用本地规则代替'));
    const job = this.analyze(task.text, { now: new Date(task.received_at), source: task.source, sender: task.sender, model, memories: this.store.recall(task.text) })
      .then(analysis => {
        if (analysis.engine !== 'model') throw new Error('AI 整理失败，原提醒未修改；请检查模型连接后重试');
        for (const [key, value] of this.previews) if (value.expires <= this.now()) this.previews.delete(key);
        if (this.previews.size >= 100) this.previews.delete(this.previews.keys().next().value);
        const token = randomUUID();
        this.previews.set(token, { taskId: id, revision: task.revision, analysis, expires: this.now() + 15 * 60000 });
        return { token, taskId: id, analysis };
      }).finally(() => this.jobs.delete(id));
    this.jobs.set(id, job); return job;
  }
  apply({ token, fields, decision = 'keep' }) {
    const preview = this.previews.get(token);
    if (!preview || preview.expires <= this.now()) throw new Error('AI 整理预览已过期，请重新整理');
    if (!['keep', 'complete'].includes(decision)) throw new Error('无效的处理方式');
    if (decision === 'complete' && preview.analysis.shouldRemind) throw new Error('本次 AI 仍建议提醒；如已处理，请使用原有的完成操作');
    this.store.applyTaskReview(preview.taskId, preview.revision, preview.analysis, fields, decision);
    this.previews.delete(token);
  }
}
