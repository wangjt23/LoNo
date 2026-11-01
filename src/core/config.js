import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { validateEndpoint } from './analyzer.js';

export const defaults = {
  pollMinutes: 5, launchAtLogin: false,
  model: { enabled: false, endpoint: '', model: '', apiKey: '' },
  mail: { enabled: false, host: '', port: 993, user: '', password: '', mailbox: 'INBOX' },
  bridge: { enabled: false, endpoint: '', token: '' },
};
const schema = z.object({
  pollMinutes: z.number().int().min(1).max(1440), launchAtLogin: z.boolean(),
  model: z.object({ enabled: z.boolean(), endpoint: z.string().max(2000), model: z.string().max(200), apiKey: z.string().max(4000) }),
  mail: z.object({ enabled: z.boolean(), host: z.string().max(300), port: z.number().int().min(1).max(65535), user: z.string().max(300), password: z.string().max(4000), mailbox: z.string().min(1).max(300) }),
  bridge: z.object({ enabled: z.boolean(), endpoint: z.string().max(2000), token: z.string().max(4000) }),
});

export class Config {
  constructor(filename, safeStorage) { this.filename = filename; this.safe = safeStorage; this.value = structuredClone(defaults); }
  async load() {
    if (!fs.existsSync(this.filename)) return;
    const file = JSON.parse(fs.readFileSync(this.filename, 'utf8'));
    let secrets = {};
    if (file.secrets) {
      const result = await this.safe.decryptStringAsync(Buffer.from(file.secrets, 'base64'));
      secrets = JSON.parse(result.result);
    }
    this.value = schema.parse({ ...file.settings,
      model: { ...file.settings.model, apiKey: secrets.apiKey || '' },
      mail: { ...file.settings.mail, password: secrets.password || '' },
      bridge: { ...file.settings.bridge, token: secrets.token || '' },
    });
  }
  public() {
    const v = structuredClone(this.value);
    v.model.hasApiKey = Boolean(v.model.apiKey); v.model.apiKey = '';
    v.mail.hasPassword = Boolean(v.mail.password); v.mail.password = '';
    v.bridge.hasToken = Boolean(v.bridge.token); v.bridge.token = '';
    return v;
  }
  async save(input) {
    const v = schema.parse(input);
    // Blank retains an existing secret; explicit clear is a separate UI flag.
    for (const [group, field] of [['model', 'apiKey'], ['mail', 'password'], ['bridge', 'token']]) {
      if (!v[group][field] && !input[group].clearSecret) v[group][field] = this.value[group][field];
    }
    if (v.model.enabled) { validateEndpoint(v.model.endpoint); if (!v.model.model.trim()) throw new Error('请填写模型名称'); }
    if (v.bridge.enabled) validateEndpoint(v.bridge.endpoint);
    if (v.mail.enabled && (!v.mail.host.trim() || !v.mail.user.trim() || !v.mail.password)) throw new Error('请完整填写邮件服务器、账号和授权码');
    const secrets = { apiKey: v.model.apiKey, password: v.mail.password, token: v.bridge.token };
    const needsEncryption = Object.values(secrets).some(Boolean);
    if (needsEncryption && !await this.safe.isAsyncEncryptionAvailable()) throw new Error('系统凭据加密不可用，无法保存密钥');
    if (needsEncryption && process.platform === 'linux' && this.safe.getSelectedStorageBackend() === 'basic_text') throw new Error('未检测到系统密钥环，无法安全保存密钥');
    const encrypted = needsEncryption ? (await this.safe.encryptStringAsync(JSON.stringify(secrets))).toString('base64') : null;
    const settings = structuredClone(v); settings.model.apiKey = ''; settings.mail.password = ''; settings.bridge.token = '';
    fs.mkdirSync(path.dirname(this.filename), { recursive: true });
    fs.writeFileSync(`${this.filename}.tmp`, JSON.stringify({ version: 1, settings, secrets: encrypted }, null, 2));
    fs.renameSync(`${this.filename}.tmp`, this.filename);
    this.value = v;
    return this.public();
  }
}
