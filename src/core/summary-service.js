import { summarizeSource } from './summary.js';

export class SummaryService {
  constructor(store, getModel, summarize = summarizeSource) {
    this.store = store; this.getModel = getModel; this.summarize = summarize; this.jobs = new Map();
  }
  generate(id) {
    if (typeof id !== 'string' || id.length > 100) return Promise.reject(new Error('来源标识无效'));
    if (this.jobs.has(id)) return this.jobs.get(id);
    const record = this.store.record(id);
    if (!record) return Promise.reject(new Error('找不到来源记录'));
    const job = this.summarize(record.text, { model: this.getModel(), receivedAt: record.received_at })
      .then(summary => { this.store.setRecordSummary(id, summary); return summary; })
      .finally(() => this.jobs.delete(id));
    this.jobs.set(id, job); return job;
  }
}
