const api = window.reminder;
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const labels = { manual: '快捷记录', email: '邮件', wecom: '企业微信', high: '重要', medium: '普通', low: '低优先级', pending: '进行中', review: '待确认', done: '已完成' };
const isCapture = new URLSearchParams(location.search).has('capture');
let data, view = 'all', query = '', preview = null, editing = null, busy = false, captureRevision = 0;
const icons = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  inbox: '<path d="M4 4h16l2 12v4H2v-4L4 4Z"/><path d="M2 15h6l2 3h4l2-3h6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.clock}</svg>`; }
function dateText(value) { return value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '时间待确认'; }
function inputDate(value) { if (!value) return ''; const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function iso(value) { return value ? new Date(value).toISOString() : null; }
function toast(text, error = false) { $('#toast').textContent = text; $('#toast').className = `visible ${error ? 'error' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').className = '', 4500); }
function overdue(t) { return t.status !== 'done' && t.due_at && Date.parse(t.due_at) < Date.now(); }
function today(t) { return t.remind_at && new Date(t.remind_at).toDateString() === new Date().toDateString(); }
function modelNotice() { return data?.settings.model.enabled ? '已启用模型 · 内容将发送到配置的模型服务' : '离线分析 · 输入内容不会发送到模型服务'; }
const titles = { all: ['提醒总览', '让每一件重要的事，都有着落。'], today: ['今日安排', '专注今天，也照顾那些尚未完成的事。'], review: ['待确认', '补充时间或核对分析，让提醒更准确。'], done: ['已完成', '每一次完成，都值得被记住。'], sources: ['信息来源', '把分散的信息，汇聚到同一个地方。'], settings: ['偏好设置', '按你的工作方式，连接信息与智能。'] };

async function refresh() {
  data = await api.invoke('snapshot');
  document.title = isCapture ? '快速记录 · 拾光' : new URLSearchParams(location.search).has('exchangeTest') ? 'Exchange 连接测试 · 拾光' : `拾光提醒 · ${data.runtime.version}`;
  document.documentElement.dataset.material = data.runtime.material || 'opaque';
  if (isCapture && $('#capture-mode-note')) $('#capture-mode-note').textContent = modelNotice();
  if (!isCapture) {
    if (!$('#workspace')) shell();
    updateNav();
    $('.new-button kbd').textContent = data.runtime.shortcut === 'Ctrl+Alt+Space' ? 'Ctrl Alt ␣' : data.runtime.shortcut ? 'Ctrl ⇧ ␣' : '未注册';
    if (view !== 'settings' || !$('#settings-form')) renderView();
  }
}
function shell() {
  $('#app').innerHTML = `<aside class="sidebar"><div class="brand"><div class="brand-mark">${icon('check')}</div><div>拾光<small>记住重要的事</small></div></div><button class="primary new-button" data-action="capture">${icon('plus')} 快速记录 <kbd>Ctrl ⇧ Space</kbd></button><div class="nav-caption">我的提醒</div><nav aria-label="提醒列表">${[['all', 'grid', '提醒总览'], ['today', 'sun', '今日安排'], ['review', 'clock', '待确认'], ['done', 'check', '已完成']].map(([id, i, name]) => `<button data-view="${id}">${icon(i)}<span>${name}</span><b id="count-${id}"></b></button>`).join('')}</nav><div class="nav-caption second">管理</div><nav aria-label="管理"><button data-view="sources">${icon('inbox')}<span>信息来源</span></button><button data-view="settings">${icon('settings')}<span>偏好设置</span></button></nav><div class="sidebar-footer"><span class="status-dot"></span> 记录保存在此设备<small>在托盘中继续为你提醒</small></div></aside><main id="workspace"><header class="topbar"><div class="breadcrumb"><b id="crumb"></b></div><span class="today-date">${new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span></header><div id="content"></div></main><dialog id="editor"></dialog>`;
}
function updateNav() {
  const active = data.tasks.filter(t => t.status !== 'done');
  for (const [key, count] of Object.entries({ all: active.length, today: active.filter(t => today(t) || overdue(t)).length, review: active.filter(t => t.status === 'review').length, done: data.tasks.length - active.length })) $(`#count-${key}`).textContent = count || '';
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#crumb').textContent = titles[view][0];
}
function renderView() {
  const [title, subtitle] = titles[view];
  const warning = [data.runtime.startupWarning, data.runtime.shortcutWarning].filter(Boolean).join(' ');
  $('#content').innerHTML = `<section class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><button class="secondary" data-action="sync">${icon('refresh')} 同步</button></section>${warning ? `<details class="runtime-notice"><summary>快捷键或本地设置需要留意</summary><p>${esc(warning)}</p></details>` : ''}${data.runtime.notificationWarning ? `<div class="warning">${esc(data.runtime.notificationWarning)}</div>` : ''}<div id="view-content"></div>`;
  if (view === 'settings') renderSettings();
  else if (view === 'sources') renderSources();
  else renderTasks();
}
function renderTasks() {
  const active = data.tasks.filter(t => t.status !== 'done');
  const dueToday = active.filter(t => today(t)).length;
  $('#view-content').innerHTML = `${view === 'all' ? `<div class="stats"><article><div class="stat-icon blue">${icon('inbox')}</div><div><span>待办事项</span><strong>${active.length}<small>件</small></strong></div><div class="stat-note">每一件事，都井井有条</div></article><article><div class="stat-icon amber">${icon('sun')}</div><div><span>今日提醒</span><strong>${dueToday}<small>件</small></strong></div><div class="stat-note">${active.filter(overdue).length} 件已过截止时间</div></article><article><div class="stat-icon violet">${icon('clock')}</div><div><span>需要确认</span><strong>${active.filter(t => t.status === 'review').length}<small>件</small></strong></div><div class="stat-note">核对日期，让提醒更安心</div></article></div>` : ''}<section class="task-panel"><div class="panel-header"><h2>${view === 'done' ? '完成记录' : '我的提醒'} <span id="list-count"></span></h2><label class="search">${icon('search')}<input id="search" placeholder="搜索事项、原文或联系人" value="${esc(query)}" aria-label="搜索事项"></label></div><div id="task-list"></div></section><div class="bottom-note">${icon('check')} 原始信息与分析依据均保存在本地，可随时回溯。</div>`;
  renderTaskList();
}
function renderTaskList() {
  const tasks = data.tasks.filter(t => {
    if (view === 'done' ? t.status !== 'done' : t.status === 'done') return false;
    if (view === 'today' && !today(t) && !overdue(t)) return false;
    if (view === 'review' && t.status !== 'review') return false;
    return !query || `${t.title} ${t.text} ${t.sender}`.toLowerCase().includes(query.toLowerCase());
  });
  $('#list-count').textContent = `${tasks.length} 项`;
  $('#task-list').innerHTML = tasks.length ? tasks.map(t => `<article class="task-row ${t.status === 'done' ? 'completed' : ''}"><button class="task-check ${t.status === 'done' ? 'checked' : ''}" data-action="${t.status === 'done' ? 'restore' : 'complete'}" data-id="${t.id}" title="${t.status === 'done' ? '恢复事项' : '标记完成'}" aria-label="${t.status === 'done' ? '恢复' : '完成'} ${esc(t.title)}">${t.status === 'done' ? '✓' : ''}</button><div class="task-body"><button class="task-title" data-action="edit" data-id="${t.id}">${esc(t.title)}</button><div class="task-meta"><span class="source-label ${t.source}">${esc(labels[t.source] || t.source)}</span>${t.sender ? `<span>${esc(t.sender.slice(0, 40))}</span>` : ''}<span class="${overdue(t) ? 'overdue' : ''}">${icon('clock')}${esc(dateText(t.remind_at))}${overdue(t) ? ' · 已逾期' : ''}</span>${t.status === 'review' ? '<span class="review-badge">请确认时间</span>' : ''}${t.notified_at ? '<span>已通知</span>' : ''}</div></div><span class="priority ${t.priority}"><i></i>${labels[t.priority]}</span><button class="row-more" data-action="edit" data-id="${t.id}" aria-label="查看详情">${icon('arrow')}</button></article>`).join('') : `<div class="empty"><div class="empty-art">${icon(view === 'done' ? 'check' : 'inbox')}</div><h3>${query ? '没有找到匹配的事项' : view === 'review' ? '暂时没有需要确认的事项' : view === 'done' ? '从完成第一件小事开始' : view === 'today' ? '今天的安排，尽在掌握' : '把第一件事，交给拾光'}</h3><p>${query ? '试试搜索原文中的词语或联系人。' : '随手记下一句话，让提醒替你记住。'}</p><button class="primary" data-action="capture">${icon('plus')} 记录一件事</button><small>试试：明天下午三点提醒我提交项目材料</small></div>`;
}
function renderSources() {
  const s = data.settings;
  $('#view-content').innerHTML = `<div class="source-grid">${[['email', '邮箱', 'IMAP / TLS', s.mail.enabled], ['wecom', '企业微信', '授权会话存档 / n8n 桥接', s.bridge.enabled]].map(([key, title, sub, enabled]) => `<article class="connection-card"><div class="connection-icon ${key}">${icon('inbox')}</div><h2>${title}</h2><p>${sub}</p><span class="connection-state ${enabled ? data.sync[key].state : ''}">${enabled ? esc(data.sync[key].message) : '尚未连接'}</span><small>${data.sync[key].at ? `上次尝试：${dateText(data.sync[key].at)}` : '配置后按设定频率自动采集'}</small><button class="secondary" data-view="settings">配置连接 ${icon('arrow')}</button></article>`).join('')}</div><div class="info-box"><h3>连接企业微信的方式</h3><p>需要企业授权的会话存档服务，或由 n8n 将消息转换为桥接 JSON。普通应用密钥不能直接获取个人全部聊天记录。</p><button class="text-button" data-action="import">导入桥接 JSON 文件 →</button></div><section class="task-panel records"><div class="panel-header"><h2>来源记录 <span>最近 ${data.records.length} 条</span></h2><button class="text-button" data-action="export">导出本地记录</button></div>${data.records.length ? data.records.slice(0, 100).map(r => { const a = JSON.parse(r.analysis); return `<details class="record"><summary><span class="source-label ${r.source}">${labels[r.source]}</span><b>${esc(r.text.split('\n')[0].slice(0, 80))}</b><small>${dateText(r.received_at)}</small></summary><p class="raw-text">${esc(r.text)}</p><p>${esc(a.reason)} ${a.shouldRemind ? '' : '· 未创建提醒'}</p>${a.warning ? `<p class="warning">${esc(a.warning)}</p>` : ''}</details>`; }).join('') : '<div class="small-empty">连接后，邮件与聊天来源会在这里留下可追溯的记录。</div>'}</section>`;
}
function field(label, name, value, type = 'text', hint = '') { return `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(value)}" ${type === 'password' ? 'autocomplete="new-password"' : ''}>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`; }
function openExchangeTest(draft = {}) {
  $('#editor').innerHTML = `<form id="exchange-test-form"><div class="dialog-header"><h2>Exchange 连接测试</h2><button type="button" class="close-button" data-action="close" aria-label="关闭">×</button></div><p class="exchange-intro">用于单位自建 Exchange。只验证账号能否读取收件箱计数，不读取正文、不改变已读状态，也不保存本次密码。</p><div class="form-grid">${field('EWS 接口地址', 'endpoint', draft.endpoint || '', 'url', '通常为 https://mail.example.com/EWS/Exchange.asmx')}${field('邮箱账号 / 域账号', 'user', draft.account || data.settings.mail.user)}${field('域（可选）', 'domain', '', 'text', '邮箱地址可先留空；也可使用 DOMAIN\\用户名')}${field('密码（仅本次测试）', 'password', '', 'password', '请直接在这里输入，不要发到聊天')}</div><div class="analysis-note">该入口验证 EWS / NTLM 登录。当前邮件定时采集仍使用 IMAP；EWS 自动采集尚未开启。</div><p id="exchange-test-result" role="status" aria-live="polite"></p><div class="button-row end"><button class="primary" type="submit">测试连接</button></div></form>`;
  $('#editor').showModal();
}
function toggle(name, checked, title, description) { return `<label class="toggle-line"><div><strong>${title}</strong><small>${description}</small></div><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}></label>`; }
function renderSettings() {
  const s = data.settings;
  $('#view-content').innerHTML = `<form id="settings-form"><section class="settings-card"><div class="section-label">01 / 智能分析</div><h2>接入你的模型或 Agent 网关</h2><p>启用后，输入内容和采集到的正文会发送至你配置的服务。关闭时使用本地中文规则。</p>${toggle('model.enabled', s.model.enabled, '启用模型分析', '兼容 chat/completions JSON 响应；不执行模型返回的工具调用')}<div class="form-grid">${field('完整接口地址', 'model.endpoint', s.model.endpoint, 'url', '例如 https://your-gateway/v1/chat/completions')}${field('模型名称', 'model.model', s.model.model)}${field('API Key', 'model.apiKey', '', 'password', s.model.hasApiKey ? '已加密保存；留空保留原密钥' : '仅使用系统加密保存')}${toggle('model.clearSecret', false, '清除已保存的 API Key', '保存设置后生效')}</div></section><section class="settings-card"><div class="section-label">02 / 邮件采集</div><h2>让邮件里的待办，自动出现</h2><button type="button" class="text-button" data-action="test-exchange">自建 Exchange？测试 EWS 连接 →</button><p>使用邮箱 IMAP 授权码。只读采集，不更改邮件已读状态；首次读取近 7 天最多 50 封。</p>${toggle('mail.enabled', s.mail.enabled, '定期同步邮件', '仅支持 TLS 直连（通常为端口 993）')}<div class="form-grid">${field('IMAP 服务器', 'mail.host', s.mail.host, 'text', '例如 imap.qq.com')}${field('TLS 端口', 'mail.port', s.mail.port, 'number')}${field('邮箱账号', 'mail.user', s.mail.user)}${field('授权码 / 密码', 'mail.password', '', 'password', s.mail.hasPassword ? '已加密保存；留空保留' : '从邮箱设置中开启 IMAP 并生成授权码')}${field('文件夹', 'mail.mailbox', s.mail.mailbox)}${toggle('mail.clearSecret', false, '清除邮箱授权码', '同时关闭邮件同步后再清除')}</div></section><section class="settings-card"><div class="section-label">03 / 企业微信</div><h2>连接已授权的数据桥接</h2><p>由企业会话存档服务或 n8n 提供 GET JSON 接口；返回 messages 数组及可选 nextCursor。详见项目 README。</p>${toggle('bridge.enabled', s.bridge.enabled, '定期读取桥接', '请求携带 Bearer Token；仅允许 HTTPS 或本机 HTTP')}<div class="form-grid">${field('桥接接口地址', 'bridge.endpoint', s.bridge.endpoint, 'url')}${field('Bridge Token', 'bridge.token', '', 'password', s.bridge.hasToken ? '已加密保存；留空保留' : '可选，取决于桥接服务鉴权方式')}${toggle('bridge.clearSecret', false, '清除 Bridge Token', '保存设置后生效')}</div></section><section class="settings-card"><div class="section-label">04 / 桌面与数据</div><h2>适合你的工作节奏</h2><div class="form-grid">${field('采集间隔（分钟，1–1440）', 'pollMinutes', s.pollMinutes, 'number')}${toggle('launchAtLogin', s.launchAtLogin, '登录 Windows 后启动', '仅安装/固定存放应用后启用，移动文件可能导致失效')}</div><div class="settings-facts"><p>快速记录快捷键 <kbd>${esc(data.runtime.shortcut || '未注册')}</kbd> <span>${data.runtime.shortcutOK ? '已注册' : '被占用，可使用托盘'}</span></p><p>数据位置 <code>${esc(data.runtime.dataPath)}</code></p><p>记录保存在本地 SQLite，凭据使用系统密钥加密。退出应用或电脑关机时无法提醒，重新启动时会检查错过的提醒。</p></div><div class="button-row"><button type="button" class="secondary" data-action="retry-shortcuts">重新注册快捷键</button><button type="button" class="secondary" data-action="test-notification">测试桌面通知</button><button type="button" class="secondary" data-action="export">导出记录</button></div></section><div class="settings-save"><span id="settings-result">设置仅保存在此设备</span><button type="submit" class="primary">保存设置</button></div></form>`;
}
function captureMarkup() {
  return `<section class="capture-content"><div class="capture-drag-strip" aria-hidden="true"></div><div class="spotlight-bar"><span class="spotlight-search">${icon('search')}</span><textarea id="capture-text" aria-label="提醒内容" placeholder="记下一件事…" maxlength="30000" rows="1" autofocus></textarea><button class="capture-submit" id="analyze-button" data-action="analyze" aria-label="分析提醒" title="Enter 分析">${icon('arrow')}</button></div><div id="capture-result" aria-live="polite"></div><div class="capture-foot"><span id="capture-mode-note">${modelNotice()}</span><span id="capture-key-hint"><kbd>↵</kbd> 整理 <span class="hint-divider">·</span> 点外部收起</span></div></section>`;
}
function resetCapturePreview() {
  preview = null; $('#capture-result').innerHTML = ''; document.body.classList.remove('has-preview');
  $('#capture-key-hint').innerHTML = '<kbd>↵</kbd> 整理 <span class="hint-divider">·</span> 点外部收起';
  void api.invoke('capture-layout', 'input').catch(e => toast(e.message, true));
}
function fieldsMarkup(fields) {
  return `<div class="form-grid task-fields">${field('事项标题', 'title', fields.title)}<label class="field"><span>重要程度</span><select name="priority">${['high', 'medium', 'low'].map(p => `<option value="${p}" ${fields.priority === p ? 'selected' : ''}>${labels[p]}</option>`).join('')}</select></label>${field('截止时间', 'dueAt', inputDate(fields.dueAt), 'datetime-local')}${field('提醒时间', 'remindAt', inputDate(fields.remindAt), 'datetime-local')}</div>`;
}
async function openCapture() {
  if (!isCapture) { await api.invoke('capture'); return; }
}
function openEdit(id) {
  editing = data.tasks.find(t => t.id === id);
  if (!editing) return;
  const a = JSON.parse(editing.analysis);
  $('#editor').innerHTML = `<form id="edit-form"><div class="dialog-header"><h2>提醒详情</h2><button type="button" class="close-button" data-action="close">×</button></div>${fieldsMarkup({ title: editing.title, dueAt: editing.due_at, remindAt: editing.remind_at, priority: editing.priority })}<div class="analysis-note"><strong>${a.engine === 'model' ? '模型分析' : '本地分析'}</strong><p>${esc(a.reason)}</p>${a.warning ? `<p class="warning">${esc(a.warning)}</p>` : ''}</div><details class="original" open><summary>原始信息 · ${labels[editing.source]} ${esc(editing.sender)}</summary><p class="raw-text">${esc(editing.text)}</p></details><div class="button-row end">${editing.status !== 'done' ? '<button type="button" class="secondary" data-action="snooze-current">15 分钟后再提醒</button>' : ''}<button class="primary" type="submit">保存修改</button></div></form>`;
  $('#editor').showModal();
}
function getTaskFields(form) { const f = new FormData(form); return { title: f.get('title'), priority: f.get('priority'), dueAt: iso(f.get('dueAt')), remindAt: iso(f.get('remindAt')) }; }

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-view]');
  if (nav) { view = nav.dataset.view; query = ''; updateNav(); renderView(); return; }
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  try {
    if (action === 'capture') await openCapture();
    if (action === 'close') { if (isCapture) await api.invoke('hide-capture'); else $('#editor').close(); }
    if (action === 'sync') { button.disabled = true; button.textContent = '同步中…'; await api.invoke('sync'); toast('同步结束，请在信息来源查看结果'); await refresh(); }
    if (action === 'edit') openEdit(button.dataset.id);
    if (['complete', 'restore'].includes(action)) { await api.invoke('update-task', { id: button.dataset.id, action }); toast(action === 'complete' ? '又完成了一件事' : '事项已恢复'); }
    if (action === 'snooze-current') { await api.invoke('update-task', { id: editing.id, action: 'snooze' }); $('#editor').close(); toast('将在 15 分钟后再次提醒'); }
    if (action === 'analyze') {
      if (busy) return; busy = true; button.disabled = true; button.innerHTML = icon('refresh'); button.setAttribute('aria-label', '正在分析');
      const revision = captureRevision;
      resetCapturePreview();
      try {
        const result = await api.invoke('analyze', $('#capture-text').value);
        if (revision !== captureRevision) { toast('输入已修改，请重新分析'); return; }
        preview = result;
        document.body.classList.add('has-preview');
        $('#capture-key-hint').innerHTML = '<kbd>↵</kbd> 添加 <span class="hint-divider">·</span> 点外部收起';
        $('#capture-result').innerHTML = `<form id="capture-save-form"><div class="preview-heading"><span>提醒预览</span><span>${preview.remindAt ? '确认时间后添加' : '时间待确认'}</span></div>${fieldsMarkup(preview)}<details class="analysis-note"><summary>分析依据</summary><p>${esc(preview.reason)}</p></details>${preview.warning ? `<p class="warning">${esc(preview.warning)}</p>` : ''}<div class="spotlight-save-row"><span>${preview.remindAt ? dateText(preview.remindAt) : '可稍后补充时间'}</span><button type="submit" class="primary">${preview.remindAt ? '添加提醒' : '保存待确认'} <span class="button-shortcut">↵</span></button></div></form>`;
        await api.invoke('capture-layout', 'preview');
      } finally { busy = false; button.disabled = false; button.innerHTML = icon('arrow'); button.setAttribute('aria-label', '分析提醒'); }
    }
    if (action === 'test-notification') { await api.invoke(action); toast('已请求系统发送测试通知'); }
    if (action === 'test-exchange') openExchangeTest();
    if (action === 'retry-shortcuts') { const result = await api.invoke(action); toast(result.active ? `当前快捷键：${result.active}` : '快捷键仍被占用，可使用托盘快速记录', !result.active); }
    if (action === 'export') { if (await api.invoke('export')) toast('记录已导出（不包含连接密钥）'); }
    if (action === 'import') { button.disabled = true; const count = await api.invoke('import'); toast(`已导入 ${count} 条来源记录`); }
  } catch (error) { toast(error.message, true); }
  finally { if (action === 'sync' || action === 'import') { button.disabled = false; if (action === 'sync') button.innerHTML = `${icon('refresh')} 同步信息`; } }
});
document.addEventListener('input', event => {
  if (event.target.id === 'search') { query = event.target.value; renderTaskList(); }
  if (event.target.id === 'capture-text') { captureRevision++; resetCapturePreview(); }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; const button = form.querySelector('button[type="submit"]');
  if (button?.disabled) return;
  try {
    if (button) button.disabled = true;
    if (form.id === 'exchange-test-form') {
      const values = new FormData(form);
      $('#exchange-test-result').textContent = '正在验证 TLS 和 Exchange 收件箱权限…';
      try {
        const result = await api.invoke('test-exchange', Object.fromEntries(values.entries()));
        $('#exchange-test-result').textContent = `连接成功。收件箱共 ${result.total} 封，未读 ${result.unread} 封。没有读取邮件正文。`;
      } catch (error) { $('#exchange-test-result').textContent = error.message; }
      finally { form.querySelector('[name="password"]').value = ''; }
    }
    if (form.id === 'capture-save-form') {
      if (!preview) throw new Error('请先分析输入内容');
      $('#capture-text').disabled = true; $('#analyze-button').disabled = true;
      await api.invoke('save-capture', { token: preview.token, fields: getTaskFields(form) });
      preview = null; $('#app').innerHTML = captureMarkup(); document.body.classList.remove('has-preview');
      await api.invoke('capture-layout', 'input'); await api.invoke('hide-capture');
    }
    if (form.id === 'edit-form') { await api.invoke('update-task', { id: editing.id, action: 'edit', fields: getTaskFields(form) }); $('#editor').close(); toast('提醒已更新'); }
    if (form.id === 'settings-form') {
      const input = structuredClone(data.settings); const values = new FormData(form);
      for (const el of form.elements) {
        if (!el.name) continue;
        let value = el.type === 'checkbox' ? el.checked : values.get(el.name);
        if (el.type === 'number') value = Number(value);
        const parts = el.name.split('.'); if (parts.length === 2) input[parts[0]][parts[1]] = value; else input[parts[0]] = value;
      }
      await api.invoke('save-settings', input); toast('设置已安全保存'); data = await api.invoke('snapshot'); renderSettings();
    }
  } catch (error) { toast(error.message, true); }
  finally {
    if (button) button.disabled = false;
    if (form.id === 'capture-save-form') { $('#capture-text').disabled = false; $('#analyze-button').disabled = false; }
  }
});
document.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape' && isCapture) { event.preventDefault(); void api.invoke('hide-capture').catch(e => toast(e.message, true)); }
  if (isCapture && event.key === 'Enter' && !event.shiftKey && (event.ctrlKey || event.metaKey || event.target.id === 'capture-text')) {
    event.preventDefault();
    if (busy) return;
    const form = $('#capture-save-form');
    if (form) { if (!form.querySelector('[type="submit"]').disabled) form.requestSubmit(); }
    else $('#analyze-button').click();
  }
  if (!isCapture && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && $('#search')) { event.preventDefault(); $('#search').focus(); }
});
api.onChange(() => refresh().catch(e => toast(e.message, true)));
api.onCapture(() => { requestAnimationFrame(() => { const field = $('#capture-text'); if (field && document.activeElement !== field) { field.focus({ preventScroll: true }); field.setSelectionRange(field.value.length, field.value.length); } }); });
try {
  await refresh();
  if (isCapture) { document.body.classList.add('capture-mode'); $('#app').innerHTML = captureMarkup(); $('#capture-text').focus(); }
  else if (new URLSearchParams(location.search).has('exchangeTest')) {
    view = 'settings'; updateNav(); renderView();
    const params = new URLSearchParams(location.search);
    openExchangeTest({ endpoint: params.get('endpoint'), account: params.get('account') });
  }
} catch (error) { $('#app').textContent = `加载失败：${error.message}`; }
