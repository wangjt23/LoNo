// Maintenance helper: run with Electron; secret arrives over stdin, never argv.
import { app, safeStorage } from 'electron';
import path from 'node:path';
import { Config } from '../src/core/config.js';
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const profile = arg('profile'); const endpoint = arg('endpoint'); const model = arg('model');
const secretUrl = arg('secret-url');
if (!profile || !endpoint || !model || process.argv.some(a => /^--(?:key|password|secret)=/i.test(a))) throw new Error('需要 profile、endpoint、model；密钥只接受标准输入');
app.setPath('userData', path.resolve(profile));
let secret = '';
const input = secretUrl ? null : new Promise((resolve, reject) => {
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { secret += chunk; if (secret.length > 4000) reject(new Error('密钥过长')); });
  process.stdin.on('end', resolve); process.stdin.on('error', reject);
});
void (async () => { try {
  await app.whenReady();
  if (secretUrl) {
    const url = new URL(secretUrl);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('仅允许本机一次性密钥通道');
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('密钥通道不可用'); secret = await response.text();
  } else await input;
  const config = new Config(path.join(profile, 'settings.json'), safeStorage); await config.load();
  await config.save({ ...config.value, model: { enabled: true, endpoint, model, apiKey: secret.trim() } });
  secret = ''; console.log('模型配置已加密保存'); app.quit();
} catch { secret = ''; console.error('模型配置未完成；没有输出密钥'); app.exit(1); } })();
