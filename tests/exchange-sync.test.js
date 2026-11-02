import test from 'node:test';
import assert from 'node:assert/strict';
import { pollExchange, parseEwsResponse, syncRequest, itemRequest, soapEnvelope } from '../src/core/exchange-sync.js';
import { Store } from '../src/core/store.js';
import { analyzeLocal } from '../src/core/analyzer.js';
import { Config } from '../src/core/config.js';

const mail = { protocol: 'exchange', endpoint: 'https://mail.example.com/EWS/Exchange.asmx', user: 'demo@example.com', domain: '', password: 'fixture-only' };
const now = new Date('2026-11-02T10:00:00+08:00');
const response = (operation, content, code = 'NoError') => ({ status: 200, body: soapEnvelope(`<m:${operation}Response><m:ResponseMessages><m:${operation}ResponseMessage ResponseClass="${code === 'NoError' ? 'Success' : 'Error'}"><m:ResponseCode>${code}</m:ResponseCode>${content}</m:${operation}ResponseMessage></m:ResponseMessages></m:${operation}Response>`) });
const page = (changes, last = 'true', cursor = 'cursor-1') => response('SyncFolderItems', `<m:SyncState>${cursor}</m:SyncState><m:IncludesLastItemInRange>${last}</m:IncludesLastItemInRange><m:Changes>${changes}</m:Changes>`);
const change = (id, date = now.toISOString(), type = 'Create') => `<t:${type}><t:Message><t:ItemId Id="${id}"/><t:DateTimeReceived>${date}</t:DateTimeReceived></t:Message></t:${type}>`;
const item = (text = '明天下午三点前提交项目材料') => response('GetItem', `<m:Items><t:Message><t:Subject>材料通知 &amp; 审核</t:Subject><t:Body BodyType="Text">${text}</t:Body><t:DateTimeReceived>${now.toISOString()}</t:DateTimeReceived><t:From><t:Mailbox><t:Name>项目办公室</t:Name><t:EmailAddress>team@example.com</t:EmailAddress></t:Mailbox></t:From></t:Message></m:Items>`);

test('EWS sync filters historical bootstrap, reads text only, returns a durable incremental cursor and deduplicates updates', async () => {
  const store = await Store.open(); const operations = [];
  const transport = async (op, xml) => {
    operations.push({ op, xml });
    return op === 'SyncFolderItems' ? page(change('old', '2025-01-01T00:00:00Z') + change('new')) : item('报销流程通常先整理发票，再提交审核。明天下午三点前提交材料');
  };
  const consume = message => store.ingest(message, analyzeLocal(message.text, new Date(message.receivedAt)));
  const state = await pollExchange(mail, {}, consume, transport, { now, hasRecord: key => store.hasRecord(key) });
  assert.equal(state.count, 1); assert.equal(state.skipped, 1); assert.equal(state.bootstrap, false);
  assert.equal(store.tasks().length, 1); assert.equal(store.memories()[0].status, 'candidate');
  assert.ok(store.records()[0].text.includes('材料通知 & 审核'));
  assert.equal(store.records()[0].received_at, now.toISOString());
  assert.ok(operations[1].xml.includes('<t:BodyType>Text</t:BodyType>'));
  const repeated = await pollExchange(mail, state, consume, transport, { now, hasRecord: key => store.hasRecord(key) });
  // The simulated old mail is now a new create event after bootstrap, so it is imported.
  assert.equal(repeated.count, 1); assert.equal(store.records().length, 2);
  const duplicate = await pollExchange(mail, state, consume, transport, { now, hasRecord: key => store.hasRecord(key) });
  assert.equal(duplicate.count, 0);
  assert.ok(operations.every(o => !/UpdateItem|SendItem|GetAttachment/.test(o.xml)));
  assert.ok(operations.some(o => o.xml.includes('<m:SyncState>cursor-1</m:SyncState>')));
  store.close();
});

test('failed consume never returns an advanced cursor and retry deduplicates already saved items', async () => {
  const saved = new Set(); let calls = 0;
  const transport = async op => op === 'SyncFolderItems' ? page(change('a') + change('b'), 'false', 'next') : item();
  const consume = async message => { calls++; if (calls === 2) throw new Error('disk failed'); saved.add(message.key); };
  await assert.rejects(pollExchange(mail, { cursor: 'before', bootstrap: false }, consume, transport, { now, hasRecord: key => saved.has(key) }), /disk failed/);
  const result = await pollExchange(mail, { cursor: 'before', bootstrap: false }, consume, transport, { now, hasRecord: key => saved.has(key) });
  assert.equal(result.cursor, 'next'); assert.equal(result.remaining, 1); assert.equal(calls, 3); assert.equal(saved.size, 2);
});

test('invalid state, permission, throttle and hostile XML errors are classified without advancing', () => {
  for (const [code, expected] of [['ErrorInvalidSyncStateData', 'ErrorInvalidSyncStateData'], ['ErrorAccessDenied', 'AUTH'], ['ErrorServerBusy', 'ErrorServerBusy']]) {
    assert.throws(() => parseEwsResponse(response('SyncFolderItems', '', code), 'SyncFolderItems'), e => e.code === expected);
  }
  for (const status of [401, 403]) assert.throws(() => parseEwsResponse({ status, body: '' }, 'GetItem'), e => e.code === 'AUTH');
  assert.throws(() => parseEwsResponse({ status: 503, body: '' }, 'GetItem'), e => e.code === 'THROTTLED');
  assert.throws(() => parseEwsResponse({ status: 200, body: '<!DOCTYPE x [<!ENTITY a "x">]><x>&a;</x>' }, 'GetItem'), /XML/);
});

test('deleted/read-flag events do not delete local records; a concurrently removed item is skipped', async () => {
  const transport = async op => op === 'SyncFolderItems' ? page('<t:Delete><t:ItemId Id="x"/></t:Delete><t:ReadFlagChange><t:ItemId Id="y"/><t:IsRead>true</t:IsRead></t:ReadFlagChange>' + change('gone')) : response('GetItem', '', 'ErrorItemNotFound');
  let calls = 0; const result = await pollExchange(mail, {}, () => calls++, transport, { now });
  assert.equal(calls, 0); assert.equal(result.skipped, 1);
});

test('opaque cursor and item IDs are XML escaped, malformed response cannot skip a page', async () => {
  assert.ok(syncRequest('<&"').includes('&lt;&amp;&quot;'));
  assert.ok(itemRequest('a"b<&').includes('a&quot;b&lt;&amp;'));
  await assert.rejects(pollExchange(mail, {}, () => {}, async () => response('SyncFolderItems', '<m:IncludesLastItemInRange>true</m:IncludesLastItemInRange>'), { now }), /游标/);
});

test('invalid model memory evidence rolls back the source and task atomically', async () => {
  const store = await Store.open();
  assert.throws(() => store.ingest({ key: 'one', text: '明天提交材料' }, analyzeLocal('明天提交材料', now), undefined, [{ kind: 'fact', content: '虚构事实', evidence: '不是原文' }]));
  assert.equal(store.records().length, 0); assert.equal(store.tasks().length, 0); assert.equal(store.hasRecord('one'), false);
  store.close();
});

test('enabled Exchange rejects non-HTTPS endpoints and missing passwords', async () => {
  const c = new Config('unused', {}); const v = c.public(); v.mail.protocol = 'exchange'; v.mail.enabled = true; v.mail.user = mail.user; v.mail.password = mail.password; v.mail.endpoint = 'http://localhost/ews';
  await assert.rejects(c.save(v), /HTTPS/);
  v.mail.endpoint = mail.endpoint; v.mail.password = '';
  await assert.rejects(c.save(v), /密码/);
});
