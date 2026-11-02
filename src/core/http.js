export function validateEndpoint(value) {
  const url = new URL(value);
  if (url.username || url.password) throw new Error('地址不能包含用户名或密码');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('请使用 HTTPS；本机服务可使用 HTTP');
  return url;
}

export async function readJson(response, max = 2 * 1024 * 1024) {
  if (!response.ok) throw new Error(`服务返回 HTTP ${response.status}`);
  const reader = response.body.getReader(); let size = 0; const chunks = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > max) throw new Error('服务响应超过大小限制'); chunks.push(Buffer.from(value)); }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

