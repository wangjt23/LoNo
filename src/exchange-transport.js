import { net, session } from 'electron';
import { randomUUID } from 'node:crypto';
import { requestExchange, testExchange } from './core/exchange.js';

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
