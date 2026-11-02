import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { memoryInput, memoryKey, extractLocalMemories, retrieveMemories } from './memory.js';

export const taskInput = z.object({
  title: z.string().trim().min(1).max(160),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  remindAt: z.string().datetime({ offset: true }).nullable(),
  priority: z.enum(['high', 'medium', 'low']),
}).transform(f => ({ ...f, dueAt: f.dueAt ? new Date(f.dueAt).toISOString() : null, remindAt: f.remindAt ? new Date(f.remindAt).toISOString() : null }));

export class Store {
  static async open(filename) {
    const SQL = await initSqlJs();
    const db = new SQL.Database(filename && fs.existsSync(filename) ? fs.readFileSync(filename) : undefined);
    return new Store(db, filename, SQL.Database);
  }
  constructor(db, filename, Database) {
    this.db = db; this.filename = filename; this.Database = Database;
    db.run(`CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, external_key TEXT UNIQUE, source TEXT NOT NULL, sender TEXT, text TEXT NOT NULL, received_at TEXT NOT NULL, analysis TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, record_id TEXT NOT NULL, title TEXT NOT NULL, due_at TEXT, remind_at TEXT, priority TEXT NOT NULL, status TEXT NOT NULL, notified_at TEXT, created_at TEXT NOT NULL, completed_at TEXT);
      CREATE INDEX IF NOT EXISTS task_reminders ON tasks(status, remind_at);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    if (!this.all('PRAGMA table_info(tasks)').some(column => column.name === 'revision')) db.run('ALTER TABLE tasks ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
    db.run(`CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, record_id TEXT, kind TEXT NOT NULL, content TEXT NOT NULL, evidence TEXT NOT NULL, status TEXT NOT NULL, content_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    this.persist();
  }
  all(sql, params = []) {
    const stmt = this.db.prepare(sql); const rows = [];
    try { stmt.bind(params); while (stmt.step()) rows.push(stmt.getAsObject()); } finally { stmt.free(); }
    return rows;
  }
  persist() {
    const bytes = this.db.export();
    if (this.filename) {
      fs.mkdirSync(path.dirname(this.filename), { recursive: true });
      fs.writeFileSync(`${this.filename}.tmp`, bytes);
      fs.renameSync(`${this.filename}.tmp`, this.filename);
    }
    this.savedBytes = bytes;
  }
  transaction(fn) {
    this.db.run('BEGIN');
    try { const result = fn(); this.db.run('COMMIT'); this.persist(); return result; }
    catch (e) {
      // COMMIT may already have succeeded when the filesystem failed. Restore the
      // last durable image so retry/deduplication cannot hide an unsaved record.
      this.db.close(); this.db = new this.Database(this.savedBytes);
      throw e;
    }
  }
  state(key, fallback = null) { const row = this.all('SELECT value FROM state WHERE key=?', [key])[0]; return row ? JSON.parse(row.value) : fallback; }
  setState(key, value) { return this.transaction(() => this.db.run('INSERT OR REPLACE INTO state VALUES (?,?)', [key, JSON.stringify(value)])); }
  hasRecord(key) { return Boolean(this.all('SELECT id FROM records WHERE external_key=?', [key])[0]); }
  ingest({ key = null, source = 'manual', sender = '', text, receivedAt = new Date().toISOString() }, analysis, override, memoryCandidates) {
    if (key && this.hasRecord(key)) return { duplicate: true };
    const fields = taskInput.parse(override || analysis);
    if (fields.remindAt && fields.dueAt && Date.parse(fields.remindAt) > Date.parse(fields.dueAt)) throw new Error('提醒时间不能晚于截止时间');
    return this.transaction(() => {
      const recordId = randomUUID(); const id = randomUUID(); const now = new Date().toISOString();
      this.db.run('INSERT INTO records VALUES (?,?,?,?,?,?,?)', [recordId, key, source, sender, text, receivedAt, JSON.stringify(analysis)]);
      if (memoryCandidates !== false) {
        this.insertMemoryCandidates(recordId, extractLocalMemories(text));
        if (memoryCandidates) this.insertMemoryCandidates(recordId, memoryCandidates);
      }
      if (analysis.shouldRemind) {
        const status = fields.remindAt && analysis.confidence >= 0.7 && (!fields.dueAt || Date.parse(fields.dueAt) > Date.now()) ? 'pending' : 'review';
        this.db.run('INSERT INTO tasks (id,record_id,title,due_at,remind_at,priority,status,notified_at,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, recordId, fields.title, fields.dueAt, fields.remindAt, fields.priority, override && fields.remindAt ? 'pending' : status, null, now, null]);
      }
      return { id: analysis.shouldRemind ? id : null, recordId, duplicate: false };
    });
  }
  tasks() { return this.all(`SELECT t.*, r.source, r.sender, r.text, r.analysis FROM tasks t JOIN records r ON r.id=t.record_id ORDER BY CASE status WHEN 'review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, COALESCE(remind_at,'9999'), created_at DESC`); }
  records(limit = 500) { return this.all(`SELECT * FROM records ORDER BY received_at DESC${limit ? ' LIMIT ?' : ''}`, limit ? [limit] : []); }
  record(id) { return this.all('SELECT * FROM records WHERE id=?', [id])[0]; }
  memories() { return this.all('SELECT * FROM memories ORDER BY updated_at DESC, id'); }
  recall(text) { return retrieveMemories(this.memories(), text); }
  insertMemoryCandidates(recordId, candidates) {
    const record = this.record(recordId);
    if (!record) throw new Error('找不到记忆来源');
    let count = 0;
    for (const candidate of candidates.slice(0, 8)) {
      const m = memoryInput.parse(candidate);
      if (typeof candidate.evidence !== 'string' || !candidate.evidence || !record.text.includes(candidate.evidence)) throw new Error('记忆证据必须来自原文');
      const now = new Date().toISOString();
      this.db.run('INSERT OR IGNORE INTO memories VALUES (?,?,?,?,?,?,?,?,?)', [randomUUID(), recordId, m.kind, m.content, candidate.evidence, 'candidate', memoryKey(m.content), now, now]);
      count += this.db.getRowsModified();
    }
    return count;
  }
  addMemoryCandidates(recordId, candidates) { return this.transaction(() => this.insertMemoryCandidates(recordId, candidates)); }
  saveMemory({ id, kind, content, status = 'approved' }) {
    const m = memoryInput.parse({ kind, content });
    z.enum(['candidate', 'approved', 'dismissed']).parse(status);
    return this.transaction(() => {
      const now = new Date().toISOString();
      const duplicate = this.all('SELECT id FROM memories WHERE content_key=?', [memoryKey(m.content)])[0];
      if (duplicate && duplicate.id !== id) throw new Error('这条记忆已经存在，请编辑已有记忆');
      if (id) {
        if (!this.all('SELECT id FROM memories WHERE id=?', [id]).length) throw new Error('找不到记忆');
        this.db.run('UPDATE memories SET kind=?,content=?,status=?,content_key=?,updated_at=? WHERE id=?', [m.kind, m.content, status, memoryKey(m.content), now, id]);
      } else {
        id = randomUUID();
        this.db.run('INSERT INTO memories VALUES (?,?,?,?,?,?,?,?,?)', [id, null, m.kind, m.content, '', status, memoryKey(m.content), now, now]);
      }
      return id;
    });
  }
  deleteMemory(id) { return this.transaction(() => this.db.run('DELETE FROM memories WHERE id=?', [id])); }
  updateTask(id, action, fields) {
    return this.transaction(() => {
    const current = this.all('SELECT * FROM tasks WHERE id=?', [id])[0];
    if (!current) throw new Error('找不到提醒');
    if (action === 'complete') this.db.run("UPDATE tasks SET status='done', completed_at=? WHERE id=?", [new Date().toISOString(), id]);
    else if (action === 'restore') this.db.run("UPDATE tasks SET status=CASE WHEN remind_at IS NULL THEN 'review' ELSE 'pending' END, completed_at=NULL, notified_at=NULL WHERE id=?", [id]);
    else if (action === 'snooze') this.db.run("UPDATE tasks SET remind_at=?, status='pending', notified_at=NULL WHERE id=?", [new Date(Date.now() + 15 * 60000).toISOString(), id]);
    else if (action === 'edit') {
      const f = taskInput.parse(fields);
      const unchangedSchedule = f.remindAt === current.remind_at && f.dueAt === current.due_at;
      if (!unchangedSchedule && f.remindAt && f.dueAt && Date.parse(f.remindAt) > Date.parse(f.dueAt)) throw new Error('提醒时间不能晚于截止时间');
      this.db.run("UPDATE tasks SET title=?, due_at=?, remind_at=?, priority=?, status=CASE WHEN status='done' THEN 'done' ELSE ? END, notified_at=CASE WHEN status='done' THEN notified_at ELSE NULL END WHERE id=?", [f.title, f.dueAt, f.remindAt, f.priority, f.remindAt ? 'pending' : 'review', id]);
    } else throw new Error('不支持的操作');
    this.db.run('UPDATE tasks SET revision=revision+1 WHERE id=?', [id]);
    });
  }
  due(now = new Date()) { return this.all("SELECT * FROM tasks WHERE status='pending' AND remind_at<=? AND notified_at IS NULL ORDER BY remind_at LIMIT 20", [now.toISOString()]); }
  notified(id, now = new Date(), revision) {
    return this.transaction(() => this.db.run(`UPDATE tasks SET notified_at=? WHERE id=? AND status='pending'${revision === undefined ? '' : ' AND revision=?'}`, [now.toISOString(), id, ...(revision === undefined ? [] : [revision])]));
  }
  close() { this.db.close(); }
}
