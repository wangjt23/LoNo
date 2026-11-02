import { randomUUID } from 'node:crypto';

export class ChatStore {
  constructor(store) {
    this.store = store;
    store.transaction(() => store.db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY, role TEXT NOT NULL, text TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chat_actions (id TEXT PRIMARY KEY, message_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL);`));
  }
  messages(limit = 100) {
    return this.store.all(`SELECT * FROM (SELECT rowid AS sequence,* FROM chat_messages ORDER BY rowid DESC${limit ? ' LIMIT ?' : ''}) ORDER BY sequence`, limit ? [limit] : []).map(row => ({ ...row, detail: JSON.parse(row.detail), actions: this.store.all('SELECT * FROM chat_actions WHERE message_id=?', [row.id]).map(a => ({ ...JSON.parse(a.payload), id: a.id, status: a.status })) }));
  }
  append(role, text, detail = {}) {
    const id = randomUUID();
    this.store.transaction(() => this.insert(id, role, text, detail));
    return id;
  }
  insert(id, role, text, detail) { this.store.db.run('INSERT INTO chat_messages VALUES (?,?,?,?,?)', [id, role, text, JSON.stringify(detail), new Date().toISOString()]); }
  finish(text, { actions, memories, references }, userText) {
    return this.store.transaction(() => {
      const id = randomUUID(); let memoryCount = 0, memoryIds = [];
      if (memories.length) {
        const recordId = randomUUID();
        this.store.db.run('INSERT INTO records (id,external_key,source,sender,text,received_at,analysis) VALUES (?,?,?,?,?,?,?)', [recordId, null, 'chat', 'LoNo Chat', userText, new Date().toISOString(), JSON.stringify({ engine: 'model', shouldRemind: false, reason: '聊天中提炼的候选记忆，需用户确认。' })]);
        memoryCount = this.store.insertMemoryCandidates(recordId, memories);
        memoryIds = this.store.all('SELECT id FROM memories WHERE record_id=?', [recordId]).map(m => m.id);
      }
      this.insert(id, 'assistant', text, { references, memoryCount, memoryIds });
      for (const action of actions) this.store.db.run('INSERT INTO chat_actions VALUES (?,?,?,?)', [randomUUID(), id, JSON.stringify(action), 'pending']);
      return id;
    });
  }
  resolve(id, decision) {
    return this.resolveRows('id', id, decision);
  }
  resolveMessage(messageId, decision) {
    return this.resolveRows('message_id', messageId, decision);
  }
  resolveRows(column, id, decision) {
    if (!['apply', 'dismiss'].includes(decision)) throw new Error('无效的处理方式');
    if (typeof id !== 'string' || id.length > 100) throw new Error('建议标识无效');
    return this.store.transaction(() => {
      const rows = this.store.all('SELECT * FROM chat_actions WHERE '+column+"=? AND status='pending' ORDER BY rowid", [id]);
      if (!rows.length) throw new Error('建议已处理或不存在');
      for (const row of rows) {
        const action = JSON.parse(row.payload);
        if (decision === 'apply') {
          if (action.action === 'create') {
            if (this.store.duplicateTask(action.fields)) throw new Error('已存在相同标题和时间的提醒，请忽略重复建议后再确认');
            const result = this.store.mutateIngest({key:'chat-create:'+action.taskId,source:'chat',sender:'LoNo Agent',text:action.sourceText}, {...action.fields,shouldRemind:true,confidence:1,reason:'聊天中提出，经用户确认创建。',engine:'model'}, action.fields, false);
            if (result.duplicate) throw new Error('这条创建建议已经保存');
            action.taskId=result.id;
            this.store.db.run('UPDATE chat_actions SET payload=? WHERE id=?',[JSON.stringify(action),row.id]);
          } else this.store.mutateTask(action.taskId, action.action, action.fields, action.revision);
        }
        this.store.db.run('UPDATE chat_actions SET status=? WHERE id=?', [decision === 'apply' ? 'applied' : 'dismissed', row.id]);
      }
      return {count:rows.length};
    });
  }
}
