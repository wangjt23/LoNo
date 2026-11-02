import { ImapFlow } from 'imapflow';
import { mailSchema, mailDefaults } from './config.js';
export function connectionInput(input,saved) {
  const value=mailSchema.parse({...mailDefaults,...input,password:input.password||saved?.password||''});
  value.user=value.user.trim();value.host=value.host.trim();
  if(!value.user||!value.password)throw new Error('请填写邮箱账号和密码 / 授权码');
  if(value.protocol==='imap'&&(!value.host||/[\s/:]/.test(value.host)))throw new Error('IMAP服务器只填写主机名，例如 mails.jlu.edu.cn，不带 https:// 或端口');
  return value;
}
// Return only controlled messages; never echo server replies, credentials or message text.
export function mailFailure(error,phase='connect') {
  const code=String(error.code||error.serverResponseCode||'');
  if(code==='AUTH_LIMIT'||/too.*login.*fail|too many.*(?:login|auth|attempt)/i.test(String(error.responseText||error.response||error.message||'')))return {code:'AUTH_LIMIT',message:'服务器因多次登录失败暂时限制访问。请稍后核对客户端收信权限或授权码，再重试同步。',paused:true};
  if(error.serverResponseCode==='UNAVAILABLE')return {code:'UNAVAILABLE',message:'服务器暂时不可用，请稍后重试。',paused:false};
  if(error.authenticationFailed||['AUTH','AUTHENTICATIONFAILED'].includes(code))return {code:'AUTH',message:'服务器拒绝登录。请核对账号、密码/客户端授权码，并确认已开启客户端收信权限。',paused:true};
  if(code==='PAUSED')return {code:'PAUSED',message:'上次登录被拒绝，自动同步已暂停。修改账号或凭据后，点击“重试同步”。',paused:true};
  if(/CERT|TLS|SSL|SELF_SIGNED|VERIFY_LEAF/.test(code))return {code:'TLS',message:'TLS证书验证失败，请核对服务器地址和证书；未关闭证书校验。',paused:false};
  if(['DNS','ENOTFOUND','EAI_AGAIN'].includes(code))return {code:'DNS',message:'无法解析邮箱服务器地址，请检查服务器名称和网络。',paused:false};
  if(/TIMEOUT|TIMEDOUT/.test(code))return {code:'TIMEOUT',message:'连接或服务器响应超时，请检查网络、服务器或VPN要求。',paused:false};
  if(['NETWORK','ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETUNREACH'].includes(code))return {code:'NETWORK',message:'无法连接邮箱服务器，请核对网络、服务器和TLS端口。',paused:false};
  if(phase==='mailbox'||code==='MAILBOX')return {code:'MAILBOX',message:'已登录，但无法以只读方式打开文件夹，请核对文件夹名称（通常为INBOX）。',paused:false};
  if(phase==='search'||phase==='fetch'||code==='IMAP_COMMAND')return {code:'IMAP_COMMAND',message:'已登录，但服务器未能完成邮件检索或读取；本页同步进度未推进。',paused:false};
  if(phase==='process'||code==='PROCESS')return {code:'PROCESS',message:'邮件已读取，但本地分析或保存失败；同步进度未推进，下次会去重重试。',paused:false};
  if(['THROTTLED','ErrorInvalidSyncStateData'].includes(code))return {code,message:code==='THROTTLED'?'服务器限制请求，请稍后重试。':'同步游标已失效，下轮重新建立，历史记录会去重。',paused:false};
  return {code:'MAIL_ERROR',message:'邮箱操作失败，请测试连接以区分登录、网络和文件夹问题。',paused:false};
}
export function imapOptions(mail) { return {host:mail.host,port:mail.port,secure:true,auth:{user:mail.user,pass:mail.password},logger:false,connectionTimeout:15000,greetingTimeout:15000,socketTimeout:30000,maxIdleTime:1000}; }
export async function testImapConnection(mail,Client=ImapFlow) {
  const client=new Client(imapOptions(mail));client.on('error',()=>{});let phase='connect';
  try{await client.connect();phase='mailbox';const box=await client.mailboxOpen(mail.mailbox||'INBOX',{readOnly:true});return {connected:true,total:Number(box.exists||0),readOnly:true,bodiesRead:false};}
  catch(error){const issue=mailFailure(error,phase);throw Object.assign(new Error(issue.message),{code:issue.code});}
  finally{try{await client.logout();}catch{client.close();}}
}
