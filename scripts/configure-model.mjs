// Reads one secret without terminal echo, relays over a one-use loopback channel.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.some(a => !/^--(?:profile|endpoint|model)=/.test(a))) throw new Error('只接受 profile、endpoint、model；密钥使用隐藏输入');
if (!process.stdin.isTTY) throw new Error('请在终端隐藏输入模式运行');
process.stdin.setRawMode(true); process.stdin.resume();
console.log('等待密钥（隐藏输入；不会输出内容）');
let secret = '';
process.stdin.on('data', async data => {
  const text = data.toString();
  if (text.includes('\u0003')) { process.stdin.setRawMode(false); process.exit(1); }
  secret += text;
  if (!/[\r\n]/.test(secret)) return;
  process.stdin.pause(); secret = secret.trim();
  const nonce = randomUUID(); let served = false;
  const server = http.createServer((req, res) => {
    if (served || req.url !== `/${nonce}`) { res.writeHead(404); res.end(); return; }
    served = true; res.setHeader('Cache-Control', 'no-store'); res.end(secret); secret = '';
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(createRequire(import.meta.url)('electron'), [path.resolve('scripts/model-config-app'), ...args, `--secret-url=http://127.0.0.1:${server.address().port}/${nonce}`], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => { if (data.toString().includes('模型配置已加密保存')) console.log('加密写入完成'); });
  const timer = setTimeout(() => { child.kill(); }, 30000);
  child.on('exit', code => { clearTimeout(timer); secret = ''; server.close(); process.stdin.setRawMode(false); console.log(code === 0 ? '模型配置已加密保存' : '配置未完成，没有输出凭据'); process.exit(code || 0); });
  child.on('error', () => { secret = ''; server.close(); process.stdin.setRawMode(false); console.log('本机配置程序启动失败'); process.exit(1); });
});
