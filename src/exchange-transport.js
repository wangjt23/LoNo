import { net, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { requestExchange, testExchange } from './core/exchange.js';
import { pollExchange } from './core/exchange-sync.js';

export async function pollExchangeLocally(mail, state, consume, options) {
  const isolated = session.fromPartition(`exchange-sync-${randomUUID()}`, { cache: false });
  isolated.allowNTLMCredentialsForDomains('');
  try {
    return await pollExchange(mail, state, consume, async (operation, body) => {
      try { return await requestExchange(mail, requestOptions => net.request({ ...requestOptions, session: isolated }), operation, body); }
      catch (error) { if (/认证|AUTH/.test(error.message)) error.code = 'AUTH'; throw error; }
    }, options);
  } finally { await isolated.closeAllConnections(); await isolated.clearAuthCache(); await isolated.clearStorageData(); }
}

export async function testExchangeLocally(input) {
  const isolated = session.fromPartition(`exchange-test-${randomUUID()}`, { cache: false });
  // Do not silently authenticate as the Windows desktop user.
  isolated.allowNTLMCredentialsForDomains('');
  try {
    return await testExchange(input, value => requestExchange(value, options => net.request({ ...options, session: isolated })));
  } finally {
    await Promise.allSettled([isolated.clearAuthCache(), isolated.closeAllConnections(), isolated.clearStorageData()]);
  }
}
