import { brandIconSet } from '../src/core/brand.js';
// Distribute the builder's branded EXE and its exact matching application files.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('版本格式无效');
const release = path.resolve('release');
const target = path.join(release, `LoNo-${pkg.version}`);
const runtime = path.resolve('.runtime/college-build/win-unpacked');
if (!target.startsWith(release + path.sep) || fs.existsSync(target)) throw new Error('目标目录已存在，拒绝覆盖；请确认版本和路径');
fs.cpSync(runtime, target, { recursive: true, errorOnExist: true, force: false });
const executable = path.join(target, 'LoNo.exe');
fs.writeFileSync(path.join(target, 'LoNo.ico'), brandIconSet());
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originalHash = hash(path.join(runtime, 'LoNo.exe'));
if (hash(executable) !== originalHash) throw new Error('运行时校验不一致');
fs.writeFileSync(path.join(target, '使用说明.txt'), `双击“LoNo.exe”启动。请保留整个目录，不能只复制EXE。\n本版EXE已嵌入LoNo图标和产品信息，目前没有可信代码签名。\n部分SmartScreen信誉提示可能提供“更多信息→仍要运行”；智能应用控制或企业策略拦截没有相同放行入口。\n沿用原有本地数据目录，保留邮箱、模型和提醒。\nEXE SHA256：${originalHash}\n`);
console.log(JSON.stringify({ target, executable, branded: true, executableSha256: originalHash }));
