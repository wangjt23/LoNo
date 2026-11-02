import { mailStateKey } from './exchange-sync.js';
export const accountStateKey = mail => mailStateKey(mail) + (mail.id && mail.id !== 'legacy-mail' ? ':' + mail.id : '');
export const accountMessage = (mail, message) => ({ ...message, key: mail.id==='legacy-mail'?message.key:`account:${mail.id}:${message.key}`, accountId:mail.id, accountAlias:mail.alias });
// Each mailbox owns its cursor and failure state. Failure in one never blocks another.
export async function syncMailAccounts({accounts,store,pollImap,pollExchange,consume,onStatus}) {
  for(const mail of accounts.filter(a=>a.enabled)){
    const key=accountStateKey(mail);
    onStatus(mail,{state:'syncing',message:'正在读取邮件…'});
    try{
      const state=store.state(key,{});
      if(state.authPaused){const e=new Error('认证失败后已暂停，请修改配置或恢复同步');e.code='PAUSED';throw e;}
      const receive=m=>consume(accountMessage(mail,m));
      const result=await (mail.protocol==='exchange'?pollExchange(mail,state,receive,{hasRecord:k=>store.hasRecord(accountMessage(mail,{key:k}).key)}):pollImap(mail,state,receive));
      store.setState(key,result);
      onStatus(mail,{state:'ok',message:`已处理 ${result.count} 封邮件${result.remaining?`，剩余 ${result.remaining} 封下轮继续`:''}`,at:new Date().toISOString()});
    }catch(error){
      if(error.code==='AUTH')store.setState(key,{...store.state(key,{}),authPaused:true});
      if(error.code==='ErrorInvalidSyncStateData')store.setState(key,{});
      onStatus(mail,{state:'error',message:['AUTH','PAUSED','THROTTLED','ErrorInvalidSyncStateData'].includes(error.code)?error.message:'邮件同步失败，请检查服务器、TLS、账号或密码；游标未推进，下轮会去重重试。',at:new Date().toISOString()});
    }
  }
}
