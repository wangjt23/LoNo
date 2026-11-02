import { _electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { validateEndpoint } from '../src/core/analyzer.js';

if (process.argv.slice(2).some(arg => !arg.startsWith('--endpoint='))) throw new Error('此探测只接受 --endpoint，不接收账号或密码');
const url = validateEndpoint(process.argv.find(arg => arg.startsWith('--endpoint='))?.slice(11));
if (url.protocol !== 'https:') throw new Error('仅允许 HTTPS');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ args: ['.', '--smoke', `--data-dir=${mkdtempSync(path.join(os.tmpdir(), 'ews-auth-probe-'))}`], env });
try {
  const result = await app.evaluate(async ({ net, session }, endpoint) => {
    const isolated = session.fromPartition('no-credentials-probe', { cache: false });
    isolated.allowNTLMCredentialsForDomains('');
    try {
      return await new Promise(resolve => {
        const challenges = [];
        const request = net.request({ url: endpoint, session: isolated, credentials: 'include', redirect: 'error', cache: 'no-store' });
        const timer = setTimeout(() => { request.abort(); resolve({ challenges, timeout: true }); }, 12000);
        request.on('login', (auth, callback) => {
          challenges.push({ scheme: auth.scheme, isProxy: auth.isProxy });
          callback(); // Explicitly decline: never supply any username or password.
        });
        request.on('error', () => { clearTimeout(timer); resolve({ challenges, error: true }); });
        request.on('response', response => {
          response.on('data', () => {});
          response.on('end', () => { clearTimeout(timer); resolve({ challenges, status: response.statusCode }); });
        });
        request.end();
      });
    } finally { await Promise.allSettled([isolated.clearAuthCache(), isolated.closeAllConnections()]); }
  }, url.href);
  console.log(JSON.stringify(result));
  assert.equal(result.status, 401, 'unauthenticated EWS endpoint returns an auth challenge');
  assert.ok(result.challenges.some(c => !c.isProxy && ['ntlm', 'negotiate'].includes(c.scheme)), 'native engine exposes the server NTLM/Negotiate challenge');
} finally { await app.close(); }
