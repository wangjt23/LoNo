import { analyze } from './analyzer.js';
import { extractMemories } from './memory.js';

// All connector messages enter through one domain service. No Electron dependency.
export class MessageService {
  constructor(store, getSettings, { analyzeImpl = analyze, extractImpl = extractMemories } = {}) {
    this.store = store; this.getSettings = getSettings;
    this.analyze = analyzeImpl; this.extract = extractImpl; this.jobs = new Map();
  }
  consume(message) {
    if (message.key && this.store.hasRecord(message.key)) return Promise.resolve({ duplicate: true });
    if (message.key && this.jobs.has(message.key)) return this.jobs.get(message.key);
    const job = this.process(message).finally(() => { if (message.key) this.jobs.delete(message.key); });
    if (message.key) this.jobs.set(message.key, job);
    return job;
  }
  async process(message) {
    const received = new Date(message.receivedAt);
    if (!Number.isFinite(+received)) throw new Error('来源时间无效，记录未保存');
    const settings = this.getSettings();
    const analysis = await this.analyze(message.text, { now: received, source: message.source, sender: message.sender, model: settings.model, memories: this.store.recall(message.text) });
    let extraction;
    if (message.source === 'email' && settings.mail.extractMemory) extraction = await this.extract(message.text, { model: settings.model });
    // Store commits original data, reminder and evidence-backed memories atomically.
    return this.store.ingest(message, { ...analysis, ...(extraction?.warning ? { memoryWarning: extraction.warning } : {}) }, undefined, message.source === 'email' && !settings.mail.extractMemory ? false : extraction?.memories);
  }
}
