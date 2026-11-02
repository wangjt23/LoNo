import { ImapFlow } from 'imapflow';
import { imapOptions, mailFailure } from './mail-connection.js';
import { simpleParser } from 'mailparser';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { validateEndpoint, readJson } from './http.js';

export function identity(value) { return createHash('sha256').update(value).digest('hex').slice(0, 24); }

export const bridgeSchema = z.object({
  messages: z.array(z.object({
    id: z.string().min(1).max(300), text: z.string().trim().min(1).max(30000),
    sender: z.string().max(300).optional(), sentAt: z.string().datetime({ offset: true }),
  })).max(100),
  nextCursor: z.string().max(2000).optional(),
});

export async function pollBridge(config, cursor, fetchImpl = fetch) {
  const url = validateEndpoint(config.endpoint);
  if (cursor) url.searchParams.set('cursor', cursor);
  url.searchParams.set('limit', '100');
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: config.token ? { Authorization: `Bearer ${config.token}` } : {} });
  const data = bridgeSchema.parse(await readJson(response));
  return { messages: data.messages.map(m => ({ key: `wecom:${identity(config.endpoint)}:${m.id}`, source: 'wecom', sender: m.sender || '', text: m.text, receivedAt: m.sentAt })), cursor: data.nextCursor ?? cursor };
}

export async function pollMail(config, state = {}, consume, Client = ImapFlow) {
  const client = new Client(imapOptions(config));
  let phase='connect';
  // Never log server errors: some providers include account information.
  client.on('error', () => {});
  try {
    await client.connect();
    phase='mailbox';
    const mailbox = await client.mailboxOpen(config.mailbox || 'INBOX', { readOnly: true });
    const validity = String(mailbox.uidValidity);
    const same = state.validity === validity;
    phase='search';
    const uids = await client.search(same ? { uid: `${(state.uid || 0) + 1}:*` } : { since: new Date(Date.now() - 7 * 86400000) }, { uid: true });
    const ids = (uids || []).filter(uid => !same || uid > (state.uid || 0)).sort((a, b) => a - b);
    // First run caps the historical import, later runs drain incrementally.
    const batch = same ? ids.slice(0, 50) : ids.slice(-50);
    let checkpoint = same ? state.uid || 0 : 0;
    if (batch.length) {
      // Fetch one at a time; consume may run an Agent and must not stall a fetch iterator.
      for (const uid of batch) {
        phase='fetch';
        const message = await client.fetchOne(uid, { source: { start: 0, maxLength: 512 * 1024 }, envelope: true, internalDate: true }, { uid: true });
        if (!message) { checkpoint = uid; continue; }
        const parsed = await simpleParser(message.source, { skipHtmlToText: false, skipTextToHtml: true });
        const text = [parsed.subject || message.envelope?.subject || '(无主题)', parsed.text || ''].join('\n').slice(0, 30000);
        phase='process';
        await consume({ key: `mail:${identity(`${config.host}:${config.port}:${config.user}:${config.mailbox}`)}:${validity}:${uid}`, source: 'email', sender: parsed.from?.text || '', text,
          receivedAt: new Date(message.internalDate || parsed.date || Date.now()).toISOString() });
        checkpoint = uid;
      }
    }
    if (!same && !batch.length) checkpoint = Math.max(0, Number(mailbox.uidNext || 1) - 1);
    return { validity, uid: checkpoint, count: batch.length, remaining: Math.max(0, ids.length - batch.length) };
  } catch(error) { const issue=mailFailure(error,phase);throw Object.assign(new Error(issue.message),{code:issue.code}); } finally { try { await client.logout(); } catch { client.close(); } }
}
