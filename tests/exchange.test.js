import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { exchangeRequestOptions, requestExchange, parseExchangeFolder, testExchange } from '../src/core/exchange.js';

const input = { endpoint: 'https://mail.example.com/EWS/Exchange.asmx', user: 'user@example.com', password: 'test-only' };
const response = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><s:Body><m:GetFolderResponse><m:ResponseMessages><m:GetFolderResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:Folders><t:Folder><t:DisplayName>Inbox</t:DisplayName><t:TotalCount>42</t:TotalCount><t:UnreadCount>3</t:UnreadCount></t:Folder></m:Folders></m:GetFolderResponseMessage></m:ResponseMessages></m:GetFolderResponse></s:Body></s:Envelope>`;
test('Exchange test only requests GetFolder and never relaxes TLS or follows redirects', () => {
  const options = exchangeRequestOptions(input);
  assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
  assert.equal(options.url, input.endpoint); assert.equal(options.cache, 'no-store');
  assert.ok(!JSON.stringify(options).includes(input.password));
});
test('credentials never reach transport when endpoint is invalid', async () => {
  let calls = 0;
  await assert.rejects(testExchange({ ...input, endpoint: 'http://localhost/ews' }, async () => { calls++; }), /HTTPS/);
  await assert.rejects(testExchange({ ...input, endpoint: 'https://mail.example.com/ews#fragment' }, async () => { calls++; }), /EWS/);
  assert.equal(calls, 0);
});

function fixture(auth = { isProxy: false, host: 'mail.example.com', port: 443, scheme: 'ntlm' }, repeat = false) {
  const seen = { authCalls: [], body: '', headers: {} };
  const createRequest = options => {
    seen.options = options;
    const req = new EventEmitter();
    req.abort = () => { seen.aborted = true; };
    req.setHeader = (key, value) => { seen.headers[key] = value; };
    req.end = body => {
      seen.body = body;
      queueMicrotask(() => {
        req.emit('login', auth, (...args) => seen.authCalls.push(args));
        if (repeat && !seen.aborted) req.emit('login', auth, (...args) => seen.authCalls.push(args));
        if (seen.aborted) return;
        const res = new EventEmitter(); res.statusCode = 200; req.emit('response', res);
        res.emit('data', Buffer.from(response)); res.emit('end');
      });
    };
    return req;
  };
  return { seen, createRequest };
}

test('native transport supplies credentials only in the matching server auth callback', async () => {
  const f = fixture(); const password = 'test"\nheader: value\\';
  const result = await requestExchange({ ...input, user: 'test', domain: 'LAB', password }, f.createRequest);
  assert.equal(result.status, 200);
  assert.deepEqual(f.seen.authCalls, [['LAB\\test', password]]);
  assert.ok(f.seen.body.includes('GetFolder')); assert.ok(!/GetItem|FindItem|UpdateItem|SendItem/.test(f.seen.body));
  assert.ok(!f.seen.body.includes(password)); assert.ok(!JSON.stringify(f.seen.headers).includes(password));
  assert.ok(!JSON.stringify(f.seen.options).includes(password));
});
test('native transport refuses proxy, wrong host, wrong port and unsupported auth without leaking credentials', async () => {
  for (const change of [{ isProxy: true }, { host: 'other.example.com' }, { port: 444 }, { scheme: 'basic' }]) {
    const f = fixture({ isProxy: false, host: 'mail.example.com', port: 443, scheme: 'ntlm', ...change });
    await assert.rejects(requestExchange(input, f.createRequest), /不匹配/);
    assert.deepEqual(f.seen.authCalls, [[]]); assert.equal(f.seen.aborted, true);
  }
});
test('native transport stops after the first supplied credential attempt', async () => {
  const f = fixture(undefined, true);
  await assert.rejects(requestExchange(input, f.createRequest), /停止重复尝试/);
  assert.deepEqual(f.seen.authCalls[1], []); assert.equal(f.seen.aborted, true);
});
test('EWS authenticated folder result returns counts only', async () => {
  const result = await testExchange(input, async () => ({ status: 200, body: response }));
  assert.deepEqual(result, { connected: true, total: 42, unread: 3 });
  assert.deepEqual(parseExchangeFolder({ status: 200, body: response.replace('<t:TotalCount>42', '<t:TotalCount>0').replace('<t:UnreadCount>3', '<t:UnreadCount>0') }), { connected: true, total: 0, unread: 0 });
});
test('EWS authentication errors, redirects, faults and hostile XML do not appear as connected', () => {
  for (const status of [401, 403, 302, 500]) assert.throws(() => parseExchangeFolder({ status, body: response }));
  assert.throws(() => parseExchangeFolder({ status: 200, body: '<!DOCTYPE x [<!ENTITY x "x">]>' + response }), /XML/);
  assert.throws(() => parseExchangeFolder({ status: 200, body: response.replace('ResponseClass="Success"', 'ResponseClass="Error"').replace('NoError', 'ErrorAccessDenied') }), /ErrorAccessDenied/);
  assert.throws(() => parseExchangeFolder({ status: 200, body: '<html>Sign in</html>' }), /InvalidResponse/);
});
