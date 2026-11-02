import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { validateEndpoint } from './http.js';

export const mailDefaults = { enabled: false, protocol: 'imap', endpoint: '', domain: '', host: '', port: 993, user: '', password: '', mailbox: 'INBOX', extractMemory: true };
export const defaults = { pollMinutes: 10, launchAtLogin: false, model: { enabled: false, endpoint: '', model: '', apiKey: '' }, mail: { ...mailDefaults }, mailAccounts: [], bridge: { enabled: false, endpoint: '', token: '' } };
export const mailSchema = z.object({ id: z.string().min(1).max(100), alias: z.string().trim().max(80).default(''), enabled: z.boolean(), protocol: z.enum(['imap', 'exchange']), endpoint: z.string().max(2000), domain: z.string().max(200), extractMemory: z.boolean(), host: z.string().max(300), port: z.number().int().min(1).max(65535), user: z.string().max(300), password: z.string().max(4000), mailbox: z.string().min(1).max(300) });
const schema = z.object({ pollMinutes: z.number().int().min(1).max(1440), launchAtLogin: z.boolean(), model: z.object({ enabled: z.boolean(), endpoint: z.string().max(2000), model: z.string().max(200), apiKey: z.string().max(4000) }), mailAccounts: z.array(mailSchema).max(20), bridge: z.object({ enabled: z.boolean(), endpoint: z.string().max(2000), token: z.string().max(4000) }) });
function aliases(accounts) {
  const ids = new Set(), used = new Set();
  for (const a of accounts) { if (ids.has(a.id)) throw new Error('邮箱标识重复'); ids.add(a.id); if (a.alias) { const name=a.alias.toLowerCase(); if(used.has(name)) throw new Error('邮箱别名不能重复'); used.add(name); } }
  for (const a of accounts) if (!a.alias) { let n=1; while(used.has('mail'+n))n++; a.alias='mail'+n; used.add(a.alias); }
  return accounts;
}
export class Config {
  constructor(filename, safeStorage) { this.filename=filename; this.safe=safeStorage; this.value=structuredClone(defaults); }
  async load() {
    if(!fs.existsSync(this.filename))return;
    const file=JSON.parse(fs.readFileSync(this.filename,'utf8')); let secrets={};
    if(file.secrets)secrets=JSON.parse((await this.safe.decryptStringAsync(Buffer.from(file.secrets,'base64'))).result);
    const saved=file.settings;
    const accounts=Array.isArray(saved.mailAccounts)&&(saved.mailAccounts.length||file.version>=2)?saved.mailAccounts.map(a=>({...mailDefaults,...a,password:secrets.mailPasswords?.[a.id]||''})):(saved.mail?.user||saved.mail?.enabled||secrets.password?[{...mailDefaults,...saved.mail,id:'legacy-mail',alias:'mail1',password:secrets.password||''}]:[]);
    const v=schema.parse({...defaults,...saved,mailAccounts:accounts,model:{...saved.model,apiKey:secrets.apiKey||''},bridge:{...saved.bridge,token:secrets.token||''}});
    v.mailAccounts=aliases(v.mailAccounts); this.value={...v,mail:{...(v.mailAccounts[0]||mailDefaults)}};
  }
  public() {
    const v=structuredClone(this.value);v.model.hasApiKey=Boolean(v.model.apiKey);v.model.apiKey='';v.bridge.hasToken=Boolean(v.bridge.token);v.bridge.token='';
    v.mailAccounts=(v.mailAccounts||[]).map(a=>({...a,hasPassword:Boolean(a.password),password:''}));
    v.mail={...(v.mailAccounts[0]||mailDefaults),hasPassword:Boolean(this.value.mailAccounts?.[0]?.password),password:''};return v;
  }
  async save(input,{retainBlankSecrets=true}={}) {
    let accounts=input.mailAccounts??this.public().mailAccounts;
    // Retain compatibility with older clients while migrating the first mailbox once.
    if(input.mail && (input.mailAccounts===undefined||JSON.stringify(input.mail)!==JSON.stringify(this.public().mail))) {
      accounts=[{...mailDefaults,...input.mail,id:accounts[0]?.id||'legacy-mail',alias:accounts[0]?.alias||'mail1'},...accounts.slice(1)];
    }
    const v=schema.parse({...input,mailAccounts:accounts.map(a=>({...mailDefaults,...a}))});v.mailAccounts=aliases(v.mailAccounts);
    for(const [group,field] of [['model','apiKey'],['bridge','token']])if(retainBlankSecrets&&!v[group][field]&&!input[group].clearSecret)v[group][field]=this.value[group][field];
    for(const a of v.mailAccounts)if(retainBlankSecrets&&!a.password&&!accounts.find(x=>x.id===a.id)?.clearSecret)a.password=this.value.mailAccounts?.find(x=>x.id===a.id)?.password||'';
    if(v.model.enabled){validateEndpoint(v.model.endpoint);if(!v.model.model.trim())throw new Error('请填写模型名称');}
    if(v.bridge.enabled)validateEndpoint(v.bridge.endpoint);
    for(const a of v.mailAccounts)if(a.enabled){
      if(!a.user.trim()||!a.password)throw new Error(a.alias+'：请填写邮箱账号和密码 / 授权码');
      if(a.protocol==='exchange'){const u=validateEndpoint(a.endpoint);if(u.protocol!=='https:'||u.hash)throw new Error('请填写 HTTPS EWS 接口地址');}
      else if(!a.host.trim())throw new Error(a.alias+'：请填写 IMAP 服务器');
    }
    const secrets={apiKey:v.model.apiKey,token:v.bridge.token,mailPasswords:Object.fromEntries(v.mailAccounts.map(a=>[a.id,a.password]))};
    const needs=Boolean(secrets.apiKey||secrets.token||v.mailAccounts.some(a=>a.password));
    if(needs&&!await this.safe.isAsyncEncryptionAvailable())throw new Error('系统凭据加密不可用，无法保存密钥');
    if(needs&&process.platform==='linux'&&this.safe.getSelectedStorageBackend()==='basic_text')throw new Error('未检测到系统密钥环，无法安全保存密钥');
    const encrypted=needs?(await this.safe.encryptStringAsync(JSON.stringify(secrets))).toString('base64'):null;
    const settings=structuredClone(v);settings.model.apiKey='';settings.bridge.token='';settings.mailAccounts.forEach(a=>a.password='');
    fs.mkdirSync(path.dirname(this.filename),{recursive:true});fs.writeFileSync(this.filename+'.tmp',JSON.stringify({version:2,settings,secrets:encrypted},null,2));fs.renameSync(this.filename+'.tmp',this.filename);
    this.value={...v,mail:{...(v.mailAccounts[0]||mailDefaults)}};return this.public();
  }
  async clearSecret({kind,accountId}) {
    const v=structuredClone(this.value);delete v.mail;
    if(kind==='model'){v.model.apiKey='';v.model.enabled=false;}
    else if(kind==='bridge'){v.bridge.token='';v.bridge.enabled=false;}
    else if(kind==='mail'){const a=v.mailAccounts.find(a=>a.id===accountId);if(!a)throw new Error('邮箱不存在');a.password='';a.enabled=false;}
    else throw new Error('无效的凭据类型');
    return this.save(v,{retainBlankSecrets:false});
  }
}
