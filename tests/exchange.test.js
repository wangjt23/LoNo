import test from 'node:test';
import assert from 'node:assert/strict';
import { exchangeCurlConfig, parseExchangeFolder, testExchange } from '../src/core/exchange.js';

const input = { endpoint: 'https://mail.example.com/EWS/Exchange.asmx', user: 'user@example.com', password: 'test-only' };
const response = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><s:Body><m:GetFolderResponse><m:ResponseMessages><m:GetFolderResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:Folders><t:Folder><t:DisplayName>Inbox</t:DisplayName><t:TotalCount>42</t:TotalCount><t:UnreadCount>3</t:UnreadCount></t:Folder></m:Folders></m:GetFolderResponseMessage></m:ResponseMessages></m:GetFolderResponse></s:Body></s:Envelope>`;
test('Exchange test only requests GetFolder and never relaxes TLS or follows redirects', () => {
  const config = exchangeCurlConfig(input);
  assert.ok(config.includes('GetFolder'));
  assert.ok(!/GetItem|FindItem|UpdateItem|SendItem|insecure|location\s*=/.test(config));
  assert.ok(config.includes('proto = "=https"'));
});
test('curl stdin config quotes passwords without adding config directives', () => {
  const config = exchangeCurlConfig({ ...input, password: 'test"\nlocation = true\r\\' });
  assert.equal(config.split('\n').filter(line => line.startsWith('user = ')).length, 1);
  assert.ok(!config.split('\n').some(line => line.startsWith('location')));
  assert.ok(config.includes('\\nlocation'));
});
test('credentials never reach transport when endpoint is invalid', async () => {
  let calls = 0;
  await assert.rejects(testExchange({ ...input, endpoint: 'http://localhost/ews' }, async () => { calls++; }), /HTTPS/);
  await assert.rejects(testExchange({ ...input, endpoint: 'https://mail.example.com/ews#fragment' }, async () => { calls++; }), /EWS/);
  assert.equal(calls, 0);
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
