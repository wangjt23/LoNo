import { soapEnvelope } from '../../src/core/exchange-sync.js';

export function demoMessages(now = new Date()) {
  const due = new Date(+now + 86400000); due.setHours(15, 0, 0, 0);
  const date = `${due.getFullYear()}年${due.getMonth() + 1}月${due.getDate()}日`;
  return [
    { id: 'demo-workflow', subject: '本周报销材料 · 请按流程提交', body: `报销流程通常先整理发票，再提交部门审核。请于${date}下午三点前提交报销材料，提前一小时提醒。`, received: now.toISOString(), name: '项目办公室' },
    { id: 'demo-news', subject: '园区资讯 · 本周动态', body: '仅供参考，无需回复或处理。', received: now.toISOString(), name: '行政服务' },
    { id: 'demo-review', subject: '资料核对 · 时间待确认', body: '请核对项目联系人名单，具体时间另行通知。', received: now.toISOString(), name: '项目协调组' },
    { id: 'demo-next', subject: '新增报销任务 · 准备下次报送', body: `请于${date}下午五点前提交补充报销材料。`, received: now.toISOString(), name: '项目办公室' },
  ];
}
const xml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const result = (operation, body) => soapEnvelope(`<m:${operation}Response><m:ResponseMessages><m:${operation}ResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode>${body}</m:${operation}ResponseMessage></m:ResponseMessages></m:${operation}Response>`);
export async function installDemoExchange(app, messages) {
  const initial = messages.slice(0, 3);
  const changes = items => items.map(m => `<t:Create><t:Message><t:ItemId Id="${xml(m.id)}"/><t:DateTimeReceived>${m.received}</t:DateTimeReceived></t:Message></t:Create>`).join('');
  const pages = [initial, [messages[3]], []].map((items, i) => result('SyncFolderItems', `<m:SyncState>demo-cursor-${i}</m:SyncState><m:IncludesLastItemInRange>true</m:IncludesLastItemInRange><m:Changes>${changes(items)}</m:Changes>`));
  const items = Object.fromEntries(messages.map(m => [m.id, result('GetItem', `<m:Items><t:Message><t:Subject>${xml(m.subject)}</t:Subject><t:Body BodyType="Text">${xml(m.body)}</t:Body><t:DateTimeReceived>${m.received}</t:DateTimeReceived><t:From><t:Mailbox><t:Name>${m.name}</t:Name><t:EmailAddress>team@example.com</t:EmailAddress></t:Mailbox></t:From></t:Message></m:Items>`)]));
  await app.evaluate(({ net }, fixture) => {
    const { EventEmitter } = process.getBuiltinModule('events');
    const original = net.request;
    globalThis.ewsDemo = { phase: 0, calls: [], status: 200, authCalls: 0 };
    net.request = options => {
      if (new URL(options.url).hostname !== 'mail.demo.invalid') return original(options);
      const req = new EventEmitter(); const headers = {}; let aborted = false;
      req.abort = () => { aborted = true; };
      req.setHeader = (key, value) => { headers[key] = value; };
      req.end = body => setTimeout(() => {
        const demo = globalThis.ewsDemo; if (aborted) return;
        demo.calls.push({ operation: headers.SOAPAction.split('/').at(-1), body });
        req.emit('login', { isProxy: false, host: 'mail.demo.invalid', port: 443, scheme: 'ntlm' }, (user, password) => { if (user && password) demo.authCalls++; });
        if (aborted) return;
        const res = new EventEmitter(); res.statusCode = demo.status;
        req.emit('response', res);
        const id = /<t:ItemId Id="([^"]+)"/.exec(body)?.[1];
        const data = headers.SOAPAction.endsWith('/SyncFolderItems') ? fixture.pages[demo.phase] : fixture.items[id];
        res.emit('data', Buffer.from(data || '')); res.emit('end');
      }, 120);
      return req;
    };
  }, { pages, items });
}
