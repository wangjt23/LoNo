import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { validateEndpoint } from './analyzer.js';

export const exchangeInput = z.object({
  endpoint: z.string().max(2000), user: z.string().trim().min(1).max(300),
  password: z.string().min(1).max(4000), domain: z.string().trim().max(200).default(''),
});
const envelope = '<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><s:Header><t:RequestServerVersion Version="Exchange2013"/></s:Header><s:Body><m:GetFolder><m:FolderShape><t:BaseShape>Default</t:BaseShape></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id="inbox"/></m:FolderIds></m:GetFolder></s:Body></s:Envelope>';

export function exchangeRequestOptions(input) {
  const v = exchangeInput.parse(input); const url = validateEndpoint(v.endpoint);
  if (url.protocol !== 'https:') throw new Error('Exchange 凭据测试仅允许 HTTPS');
  if (url.hash) throw new Error('请填写 EWS 地址，不是网页登录链接');
  if (v.user.includes(':')) throw new Error('账号中不能含冒号');
  return { url: url.href, method: 'POST', redirect: 'error', credentials: 'include', cache: 'no-store' };
}

// The factory is Electron net.request in production; credentials are supplied only
// to a matching server's auth challenge, never placed in URL/headers/files/logs.
export function requestExchange(input, createRequest, operation = 'GetFolder', body = envelope) {
  if (!['GetFolder', 'SyncFolderItems', 'GetItem'].includes(operation)) throw new Error('不支持的只读 EWS 操作');
  const value = exchangeInput.parse(input);
  const options = exchangeRequestOptions(value); const url = new URL(options.url);
  const user = value.domain && !value.user.includes('\\') ? `${value.domain}\\${value.user}` : value.user;
  return new Promise((resolve, reject) => {
    let request, settled = false, authAttempts = 0;
    const fail = message => { if (!settled) { settled = true; clearTimeout(timer); request?.abort(); reject(new Error(message)); } };
    const timer = setTimeout(() => fail('Exchange 测试超时，请检查网络或服务器地址'), 30000);
    try {
      request = createRequest(options);
      request.setHeader('Content-Type', 'text/xml; charset=utf-8');
      request.setHeader('SOAPAction', `http://schemas.microsoft.com/exchange/services/2006/messages/${operation}`);
      request.on('login', (auth, callback) => {
        if (settled || auth.isProxy || auth.host.toLowerCase() !== url.hostname.toLowerCase() || Number(auth.port) !== Number(url.port || 443) || !['ntlm', 'negotiate'].includes(auth.scheme?.toLowerCase())) {
          callback(); fail('Exchange 返回了不匹配的认证请求，已停止传递凭据'); return;
        }
        if (authAttempts++ > 0) { callback(); fail('Exchange 认证未通过，已停止重复尝试；请核对账号、域、密码及服务器认证策略'); return; }
        callback(user, value.password);
      });
      request.on('error', error => {
        const code = /net::(ERR_[A-Z_]+)/.exec(error.message || '')?.[1];
        fail(code?.startsWith('ERR_CERT') ? `Exchange 证书验证失败（${code}），未放宽 TLS 校验` : code?.includes('AUTH') ? `Exchange 认证未完成（${code}），未自动重试` : `Exchange 网络连接失败${code ? `（${code}）` : ''}`);
      });
      request.on('redirect', () => fail('EWS 地址发生重定向，已停止请求，请确认实际接口地址'));
      request.on('response', response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => { size += chunk.length; if (size > 2 * 1024 * 1024) fail('Exchange 响应超过大小限制'); else chunks.push(Buffer.from(chunk)); });
        response.on('error', () => fail('Exchange 响应读取失败'));
        response.on('aborted', () => fail('Exchange 响应中断'));
        response.on('end', () => {
          if (settled) return; settled = true; clearTimeout(timer);
          resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') });
        });
      });
      request.end(body);
    } catch { fail('无法创建 Exchange 网络请求'); }
  });
}

export function parseExchangeFolder({ status, body }) {
  if (status === 401) throw new Error('Exchange 认证失败，请核对账号、域和密码；请勿连续重试以免账号锁定');
  if (status === 403) throw new Error('服务器拒绝 EWS 访问，需要确认此账号的 EWS 权限');
  if (status >= 300 && status < 400) throw new Error('EWS 地址返回重定向；测试不会转发凭据，请确认实际 EWS 地址');
  if (status !== 200) throw new Error(`Exchange 服务返回 HTTP ${status}`);
  if (typeof body !== 'string' || Buffer.byteLength(body) > 2 * 1024 * 1024 || /<!\s*(DOCTYPE|ENTITY)\b/i.test(body)) throw new Error('Exchange XML 响应无效');
  const parsed = new XMLParser({ removeNSPrefix: true, ignoreAttributes: false, parseTagValue: false, processEntities: false }).parse(body, true);
  const message = parsed.Envelope?.Body?.GetFolderResponse?.ResponseMessages?.GetFolderResponseMessage;
  if (message?.ResponseCode !== 'NoError' || message?.['@_ResponseClass'] !== 'Success') {
    const code = /^[a-zA-Z0-9]{1,100}$/.test(message?.ResponseCode || '') ? message.ResponseCode : 'InvalidResponse';
    throw new Error(`Exchange 读取收件箱失败（${code}）`);
  }
  const folder = message.Folders?.Folder;
  const total = Number(folder?.TotalCount), unread = Number(folder?.UnreadCount);
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(unread) || unread < 0) throw new Error('Exchange 收件箱信息不完整');
  return { connected: true, total, unread };
}

export async function testExchange(input, transport) {
  exchangeInput.parse(input); exchangeRequestOptions(input); // Validate before credentials reach any transport.
  return parseExchangeFolder(await transport(input));
}
