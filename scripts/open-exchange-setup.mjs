import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateEndpoint } from '../src/core/analyzer.js';

const args = process.argv.slice(2);
if (args.some(a => !a.startsWith('--endpoint=') && !a.startsWith('--account='))) throw new Error('只接受 endpoint 和 account；密码必须在本机 App 输入');
const endpoint = validateEndpoint(args.find(a => a.startsWith('--endpoint='))?.slice(11));
const account = args.find(a => a.startsWith('--account='))?.slice(10) || '';
if (endpoint.protocol !== 'https:' || !account || account.length > 300) throw new Error('请提供 HTTPS EWS 地址和账号');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(createRequire(import.meta.url)('electron'), [root, '--exchange-setup', `--endpoint=${endpoint.href}`, `--account=${account}`], { cwd: root, env, detached: true, stdio: 'ignore', windowsHide: false });
child.on('error', () => { console.error('应用启动失败'); process.exitCode = 1; }); child.unref();
console.log('已打开日常数据目录的 Exchange 设置窗口。已有旧进程时，请先从托盘退出后重开。');
