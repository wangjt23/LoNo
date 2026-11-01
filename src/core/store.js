import initSqlJs from 'sql.js';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

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
    return new Store(db, filename);
  }
  constructor(db, filename) {
    this.db = db; this.filename = filename;
    db.run(`CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, external_key TEXT UNIQUE, source TEXT NOT NULL, sender TEXT, text TEXT NOT NULL, received_at TEXT NOT NULL, analysis TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, record_id TEXT NOT NULL, title TEXT NOT NULL, due_at TEXT, remind_at TEXT, priority TEXT NOT NULL, status TEXT NOT NULL, notified_at TEXT, created_at TEXT NOT NULL, completed_at TEXT);
      CREATE INDEX IF NOT EXISTS task_reminders ON tasks(status, remind_at);
      CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.persist();
  }
  all(sql, params = []) {
    const stmt = this.db.prepare(sql); const rows = [];
    try { stmt.bind(params); while (stmt.step()) rows.push(stmt.getAsObject()); } finally { stmt.free(); }
    return rows;
  }
  persist() {
    if (!this.filename) return;
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    fs.writeFileSync(`${this.filename}.tmp`, this.db.export());
    fs.renameSync(`${this.filename}.tmp`, this.filename);
  }
  transaction(fn) {
    this.db.run('BEGIN');
    try { const result = fn(); this.db.run('COMMIT'); this.persist(); return result; }
    catch (e) { if (this.db.getRowsModified !== undefined) { try { this.db.run('ROLLBACK'); } catch {} } throw e; }
  }
  state(key, fallback = null) { const row = this.all('SELECT value FROM state WHERE key=?', [key])[0]; return row ? JSON.parse(row.value) : fallback; }
  setState(key, value) { this.db.run('INSERT OR REPLACE INTO state VALUES (?,?)', [key, JSON.stringify(value)]); this.persist(); }
  hasRecord(key) { return Boolean(this.all('SELECT id FROM records WHERE external_key=?', [key])[0]); }
  ingest({ key = null, source = 'manual', sender = '', text, receivedAt = new Date().toISOString() }, analysis, override) {
    if (key && this.hasRecord(key)) return { duplicate: true };
    const fields = taskInput.parse(override || analysis);
    if (fields.remindAt && fields.dueAt && Date.parse(fields.remindAt) > Date.parse(fields.dueAt)) throw new Error('提醒时间不能晚于截止时间');
    return this.transaction(() => {
      const recordId = randomUUID(); const id = randomUUID(); const now = new Date().toISOString();
      this.db.run('INSERT INTO records VALUES (?,?,?,?,?,?,?)', [recordId, key, source, sender, text, receivedAt, JSON.stringify(analysis)]);
      if (analysis.shouldRemind) {
        const status = fields.remindAt && analysis.confidence >= 0.7 && (!fields.dueAt || Date.parse(fields.dueAt) > Date.now()) ? 'pending' : 'review';
        this.db.run('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?)', [id, recordId, fields.title, fields.dueAt, fields.remindAt, fields.priority, override && fields.remindAt ? 'pending' : status, null, now, null]);
      }
      return { id: analysis.shouldRemind ? id : null, recordId, duplicate: false };
    });
  }
  tasks() { return this.all(`SELECT t.*, r.source, r.sender, r.text, r.analysis FROM tasks t JOIN records r ON r.id=t.record_id ORDER BY CASE status WHEN 'review' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, COALESCE(remind_at,'9999'), created_at DESC`); }
  records(limit = 500) { return this.all(`SELECT * FROM records ORDER BY received_at DESC${limit ? ' LIMIT ?' : ''}`, limit ? [limit] : []); }
  updateTask(id, action, fields) {
    if (!this.all('SELECT id FROM tasks WHERE id=?', [id]).length) throw new Error('找不到提醒');
    if (action === 'complete') this.db.run("UPDATE tasks SET status='done', completed_at=? WHERE id=?", [new Date().toISOString(), id]);
    else if (action === 'restore') this.db.run("UPDATE tasks SET status=CASE WHEN remind_at IS NULL THEN 'review' ELSE 'pending' END, completed_at=NULL, notified_at=NULL WHERE id=?", [id]);
    else if (action === 'snooze') this.db.run("UPDATE tasks SET remind_at=?, status='pending', notified_at=NULL WHERE id=?", [new Date(Date.now() + 15 * 60000).toISOString(), id]);
    else if (action === 'edit') {
      const f = taskInput.parse(fields);
      if (f.remindAt && f.dueAt && Date.parse(f.remindAt) > Date.parse(f.dueAt)) throw new Error('提醒时间不能晚于截止时间');
      this.db.run("UPDATE tasks SET title=?, due_at=?, remind_at=?, priority=?, status=?, notified_at=NULL, completed_at=NULL WHERE id=?", [f.title, f.dueAt, f.remindAt, f.priority, f.remindAt ? 'pending' : 'review', id]);
    } else throw new Error('不支持的操作');
    this.persist();
  }
  due(now = new Date()) { return this.all("SELECT * FROM tasks WHERE status='pending' AND remind_at<=? AND notified_at IS NULL ORDER BY remind_at LIMIT 20", [now.toISOString()]); }
  notified(id, now = new Date()) { this.db.run('UPDATE tasks SET notified_at=? WHERE id=?', [now.toISOString(), id]); this.persist(); }
  close() { this.persist(); this.db.close(); }
}
