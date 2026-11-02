import { XMLParser } from 'fast-xml-parser';
import { identity } from './connectors.js';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];
export const mailStateKey = mail => mail.protocol === 'exchange' ? `ews:${identity(`${mail.endpoint}:${mail.user}:${mail.domain}:inbox`)}` : `imap:${identity(`${mail.host}:${mail.port}:${mail.user}:${mail.mailbox}`)}`;
export const soapEnvelope = body => `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><s:Header><t:RequestServerVersion Version="Exchange2013"/></s:Header><s:Body>${body}</s:Body></s:Envelope>`;
function failure(code, message) { const error = new Error(message); error.code = code; return error; }
export function parseEwsResponse({ status, body }, operation) {
  if (status === 401 || status === 403) throw failure('AUTH', 'Exchange 认证或权限失败，自动同步已暂停；请核对凭据后恢复同步');
  if (status === 429 || status === 503) throw failure('THROTTLED', 'Exchange 暂时限流，将在后续轮询重试');
  if (status !== 200) throw failure('HTTP', `Exchange 返回 HTTP ${status}，本页游标未推进`);
  if (typeof body !== 'string' || Buffer.byteLength(body) > 2 * 1024 * 1024 || /<!\s*(DOCTYPE|ENTITY)\b/i.test(body)) throw failure('XML', 'Exchange XML 响应无效');
  let parsed;
  try { parsed = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, parseTagValue: false, processEntities: true }).parse(body, true); }
  catch { throw failure('XML', 'Exchange XML 响应无效'); }
  const messages = list(parsed.Envelope?.Body?.[`${operation}Response`]?.ResponseMessages?.[`${operation}ResponseMessage`]);
  if (!messages.length) throw failure('XML', 'Exchange 响应结构无效');
  return messages.map(m => {
    if (m['@_ResponseClass'] !== 'Success' || m.ResponseCode !== 'NoError') {
      const code = /^[A-Za-z0-9]{1,100}$/.test(m.ResponseCode || '') ? m.ResponseCode : 'InvalidResponse';
      throw failure(['ErrorAccessDenied', 'ErrorInvalidUserInfo', 'ErrorInvalidCredentials'].includes(code) ? 'AUTH' : code, `Exchange 操作失败（${code}）`);
    }
    return m;
  });
}
export function syncRequest(cursor) {
  return soapEnvelope(`<m:SyncFolderItems><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:DateTimeReceived"/></t:AdditionalProperties></m:ItemShape><m:SyncFolderId><t:DistinguishedFolderId Id="inbox"/></m:SyncFolderId>${cursor ? `<m:SyncState>${escape(cursor)}</m:SyncState>` : ''}<m:MaxChangesReturned>50</m:MaxChangesReturned><m:SyncScope>NormalItems</m:SyncScope></m:SyncFolderItems>`);
}
export function itemRequest(id) {
  return soapEnvelope(`<m:GetItem><m:ItemShape><t:BaseShape>IdOnly</t:BaseShape><t:BodyType>Text</t:BodyType><t:AdditionalProperties>${['item:Subject', 'item:Body', 'item:DateTimeReceived', 'message:From'].map(f => `<t:FieldURI FieldURI="${f}"/>`).join('')}</t:AdditionalProperties></m:ItemShape><m:ItemIds><t:ItemId Id="${escape(id)}"/></m:ItemIds></m:GetItem>`);
}

// One bounded page per poll. Persist returned state only after every consumed item
// is durable; a failed page replays safely through the store's external-key dedup.
export async function pollExchange(mail, state = {}, consume, transport, { now = new Date(), hasRecord = () => false } = {}) {
  const cutoff = state.cutoff || new Date(+now - 7 * 86400000).toISOString();
  const bootstrap = state.bootstrap !== false;
  const [page] = parseEwsResponse(await transport('SyncFolderItems', syncRequest(state.cursor)), 'SyncFolderItems');
  if (typeof page.SyncState !== 'string' || !page.SyncState || page.SyncState.length > 100000 || !['true', 'false'].includes(page.IncludesLastItemInRange)) throw failure('XML', 'Exchange 同步游标不完整');
  let count = 0, skipped = 0;
  const changes = [...list(page.Changes?.Create), ...list(page.Changes?.Update)];
  if (changes.length > 50) throw failure('XML', 'Exchange 同步页超过大小限制');
  for (const change of changes) {
    const item = change.Message; // Ignore calendar/tasks and read-flag/delete events.
    if (!item) continue;
    const id = item.ItemId?.['@_Id'];
    if (typeof id !== 'string' || !id || id.length > 4096) throw failure('XML', 'Exchange 邮件标识无效');
    const key = `${mailStateKey({ ...mail, protocol: 'exchange' })}:${identity(id)}`;
    if (hasRecord(key)) { skipped++; continue; }
    if (bootstrap && item.DateTimeReceived && Date.parse(item.DateTimeReceived) < Date.parse(cutoff)) { skipped++; continue; }
    let detail;
    try { [detail] = parseEwsResponse(await transport('GetItem', itemRequest(id)), 'GetItem'); }
    catch (error) { if (error.code === 'ErrorItemNotFound') { skipped++; continue; } throw error; }
    const message = detail.Items?.Message;
    const received = message?.DateTimeReceived;
    if (!message || !received || !Number.isFinite(Date.parse(received))) throw failure('XML', 'Exchange 邮件内容不完整');
    if (bootstrap && Date.parse(received) < Date.parse(cutoff)) { skipped++; continue; }
    const body = typeof message.Body === 'string' ? message.Body : message.Body?.['#text'] || '';
    const from = message.From?.Mailbox;
    const result = await consume({ key, source: 'email', sender: [from?.Name, from?.EmailAddress].filter(Boolean).join(' / ').slice(0, 300), text: `${message.Subject || '(无主题)'}\n${body}`.slice(0, 30000), receivedAt: new Date(received).toISOString() });
    if (!result?.duplicate) count++;
  }
  return { cursor: page.SyncState, cutoff, bootstrap: bootstrap && page.IncludesLastItemInRange !== 'true', remaining: page.IncludesLastItemInRange === 'true' ? 0 : 1, count, skipped };
}
