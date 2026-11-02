import { renderSourcesContent } from './components/sources.js';
import { renderChat } from './components/chat.js';
import { renderTaskReview } from './components/task-review.js';
import { esc, dateText } from './format.js';
import { renderAiSummary as aiSummaryMarkup } from './components/ai-summary.js';
import { isToday, isOverdue, isReview, isFuture, matchesTaskView } from './task-views.js';
import { readableSource } from '../core/source-text.js';
import { createRefreshQueue } from './refresh-queue.js';
import { renderPreferences, readPreferences, newMailAccount, renderMailStatus } from './components/preferences.js';
const api = window.reminder;
document.documentElement.dataset.platform = api.platform;
const $ = selector => document.querySelector(selector);
const labels = { manual: '快捷记录', chat: 'Agent 聊天', email: '邮件', wecom: '企业微信', high: '重要', medium: '普通', low: '低优先级', pending: '进行中', review: '待确认', done: '已完成' };
const isCapture = new URLSearchParams(location.search).has('capture');
let chatMessages = [], chatBusy = false, chatDraft = '';
let reviewResult = null, pendingReview = null, editingSession = 0;
let data, view = 'all', query = '', preview = null, editing = null, busy = false, captureRevision = 0, captureSession = 0;
const refresh = createRefreshQueue(refreshOnce);
const icons = { chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2V11.5a8.5 8.5 0 1 1 20 0Z"/><path d="M7 10h10M7 14h6"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  inbox: '<path d="M4 4h16l2 12v4H2v-4L4 4Z"/><path d="M2 15h6l2 3h4l2-3h6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2"/>',
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.clock}</svg>`; }
function inputDate(value) { if (!value) return ''; const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function iso(value) { return value ? new Date(value).toISOString() : null; }
function toast(text, error = false) { $('#toast').textContent = text; $('#toast').className = `visible ${error ? 'error' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').className = '', 4500); }
const overdue = task => isOverdue(task);
const today = task => isToday(task);
function modelNotice() { return data?.settings.model.enabled ? '已启用模型 · 内容将发送到配置的模型服务' : '离线分析 · 输入内容不会发送到模型服务'; }
const titles = { chat: ['Agent 对话', '在对话中查找、理解和整理你的工作。'], all: ['提醒总览', '让每一件重要的事，都有着落。'], today: ['今日安排', '专注今天，也照顾那些尚未完成的事。'], future: ['未来安排', '今天之后的安排，提前准备，从容处理。'], overdue: ['已过期', '超过截止时间（未设截止时按提醒时间）的未完成事项。'], review: ['待确认', '尚无明确时间的事项，补充时间后即可安排提醒。'], done: ['已完成', '每一次完成，都值得被记住。'], sources: ['信息来源', '把分散的信息，汇聚到同一个地方。'], memories: ['全局记忆', '一份记忆，聊天、邮件与快捷输入共同使用。'], settings: ['偏好设置', '按你的工作方式，连接信息与智能。'] };

async function refreshOnce() {
  data = await api.invoke('snapshot');
  if(view==='sources'&&sourceAccountFilter)sourceAccountRecords=await api.invoke('mail-records',sourceAccountFilter);
  document.title = isCapture ? '快速记录 · LoNo' : new URLSearchParams(location.search).has('exchangeTest') ? 'Exchange 连接测试 · LoNo' : `LoNo · ${data.runtime.version}`;
  document.documentElement.dataset.material = data.runtime.material || 'opaque';
  if (isCapture && $('#capture-mode-note')) $('#capture-mode-note').textContent = modelNotice();
  if (!isCapture) {
    if (!$('#workspace')) shell();
    updateNav();
    $('.new-button kbd').textContent = data.runtime.shortcut ? data.runtime.shortcut.replace('Command', '⌘').replace('Ctrl', 'Ctrl ').replace('Shift', '⇧').replace('Option', '⌥').replace('Alt', 'Alt ').replace('Space', '␣').replaceAll('+', ' ') : '未注册';
    if ((view !== 'settings' || !$('#settings-form')) && (view !== 'chat' || !$('#chat-panel'))) renderView();
    if(view==='settings'&&$('#settings-form'))updateMailStatuses();
  }
}
let editorBackdropDown = false;
function shell() {
  $('#app').innerHTML = `<aside class="sidebar"><div class="brand"><div class="brand-mark"><img src="brand.svg" alt=""></div><div>LoNo<small>Loop Notify</small></div></div><button class="primary new-button" data-action="capture">${icon('plus')} 快速记录 <kbd>Ctrl ⇧ Space</kbd></button><div class="nav-caption">我的提醒</div><nav aria-label="提醒列表">${[['all', 'grid', '提醒总览'], ['today', 'sun', '今日安排'], ['future', 'circle', '未来安排'], ['overdue', 'clock', '已过期'], ['review', 'clock', '待确认'], ['done', 'check', '已完成']].map(([id, i, name]) => `<button data-view="${id}">${icon(i)}<span>${name}</span><b id="count-${id}"></b></button>`).join('')}</nav><div class="nav-caption second">管理</div><nav aria-label="管理"><button data-view="chat">${icon('chat')}<span>Agent 对话</span></button><button data-view="memories">${icon('grid')}<span>全局记忆</span></button><button data-view="sources">${icon('inbox')}<span>信息来源</span></button><button data-view="settings">${icon('settings')}<span>偏好设置</span></button></nav><div class="sidebar-footer"><span class="status-dot"></span> 记录保存在此设备<small>在托盘中继续为你提醒</small></div></aside><main id="workspace"><header class="topbar"><div class="breadcrumb"><b id="crumb"></b></div><span class="today-date">${new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}</span></header><div id="content"></div></main><dialog id="editor"></dialog>`;
}
function updateNav() {
  const active = data.tasks.filter(t => t.status !== 'done');
  for (const [key, count] of Object.entries({ all: active.length, future: active.filter(t => isFuture(t)).length, today: active.filter(today).length, overdue: active.filter(overdue).length, review: active.filter(isReview).length, done: data.tasks.length - active.length })) $(`#count-${key}`).textContent = count || '';
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#crumb').textContent = titles[view][0];
}
function renderView() {
  $('#content').classList.toggle('chat-page', view === 'chat');
  const [title, subtitle] = titles[view];
  const warning = [data.runtime.startupWarning, data.runtime.shortcutWarning, data.runtime.captureWarning].filter(Boolean).join(' ');
  $('#content').innerHTML = `<section class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div><button class="secondary" data-action="sync">${icon('refresh')} 同步</button></section>${warning ? `<details class="runtime-notice"><summary>快捷输入或本地设置需要留意</summary><p>${esc(warning)}</p></details>` : ''}${data.runtime.notificationWarning ? `<div class="warning">${esc(data.runtime.notificationWarning)}</div>` : ''}<div id="view-content"></div>`;
  if (view === 'settings') renderSettings();
  else if (view === 'sources') renderSources();
  else if (view === 'memories') renderMemories();
  else if (view === 'chat') renderChatPanel();
  else renderTasks();
}
function renderChatPanel() {
  $('#view-content').innerHTML = renderChat({ messages: chatMessages, busy: chatBusy, enabled: data.settings.model.enabled, draft: chatDraft, memories: data.memories });
  const scroll = $('#chat-scroll'); scroll.scrollTop = scroll.scrollHeight;
}
async function loadChat() { chatMessages = await api.invoke('chat-history'); if (view === 'chat') renderChatPanel(); }
function renderTasks() {
  const active = data.tasks.filter(t => t.status !== 'done');
  const dueToday = active.filter(t => today(t)).length;
  $('#view-content').innerHTML = `${view === 'all' ? `<div class="stats"><article><div class="stat-icon blue">${icon('inbox')}</div><div><span>待办事项</span><strong>${active.length}<small>件</small></strong></div><div class="stat-note">每一件事，都井井有条</div></article><article><div class="stat-icon amber">${icon('sun')}</div><div><span>今日提醒</span><strong>${dueToday}<small>件</small></strong></div><div class="stat-note">${active.filter(overdue).length} 件已过截止时间</div></article><article><div class="stat-icon violet">${icon('clock')}</div><div><span>需要确认</span><strong>${active.filter(isReview).length}<small>件</small></strong></div><div class="stat-note">核对日期，让提醒更安心</div></article></div>` : ''}<section class="task-panel"><div class="panel-header"><h2>${view === 'done' ? '完成记录' : view === 'overdue' ? '过期事项' : view === 'future' ? '未来事项' : '我的提醒'} <span id="list-count"></span></h2><label class="search">${icon('search')}<input id="search" placeholder="搜索事项、原文或联系人" value="${esc(query)}" aria-label="搜索事项"></label></div><div id="task-list"></div></section><div class="bottom-note">${icon('check')} 原始信息与分析依据均保存在本地，可随时回溯。</div>`;
  renderTaskList();
}
function analysisBadge(task) { const a = JSON.parse(task.analysis); return a.engine === 'model' ? '<span class="engine-badge">AI 分析</span>' : '<span class="engine-badge local">' + (a.warning ? '本地规则 · AI 调用失败' : '本地规则') + '</span>'; }
function renderTaskList() {
  const tasks = data.tasks.filter(t => {
    if (!matchesTaskView(t, view)) return false;
    return !query || `${t.title} ${t.text} ${t.sender} ${sourceName(t)}`.toLowerCase().includes(query.toLowerCase());
  });
  $('#list-count').textContent = `${tasks.length} 项`;
  $('#task-list').innerHTML = tasks.length ? tasks.map(t => `<article class="task-row ${t.status === 'done' ? 'completed' : ''}"><button class="task-check ${t.status === 'done' ? 'checked' : ''}" data-action="${t.status === 'done' ? 'restore' : 'complete'}" data-id="${t.id}" title="${t.status === 'done' ? '恢复事项' : '标记完成'}" aria-label="${t.status === 'done' ? '恢复' : '完成'} ${esc(t.title)}">${t.status === 'done' ? '✓' : ''}</button><div class="task-body"><button class="task-title" data-action="edit" data-id="${t.id}">${esc(t.title)}</button><div class="task-meta"><span class="source-label ${t.source}">${esc(sourceName(t))}</span>${analysisBadge(t)}${t.sender ? `<span>${esc(t.sender.slice(0, 40))}</span>` : ''}<span class="${overdue(t) ? 'overdue' : ''}">${icon('clock')}${esc(dateText(t.remind_at))}${overdue(t) ? ' · 已逾期' : ''}</span>${isReview(t) ? '<span class="review-badge">请确认时间</span>' : ''}${t.notified_at ? '<span>已通知</span>' : ''}</div></div><span class="priority ${t.priority}"><i></i>${labels[t.priority]}</span><button class="row-more" data-action="edit" data-id="${t.id}" aria-label="查看详情">${icon('arrow')}</button></article>`).join('') : `<div class="empty"><div class="empty-art">${icon(view === 'done' ? 'check' : 'inbox')}</div><h3>${query ? '没有找到匹配的事项' : view === 'review' ? '暂时没有需要确认的事项' : view === 'done' ? '从完成第一件小事开始' : view === 'overdue' ? '没有过期的未完成事项' : view === 'today' ? '今天的安排，尽在掌握' : view === 'future' ? '暂无未来安排' : '把第一件事，交给LoNo'}</h3><p>${query ? '试试搜索原文中的词语或联系人。' : '随手记下一句话，让提醒替你记住。'}</p><button class="primary" data-action="capture">${icon('plus')} 记录一件事</button><small>试试：明天下午三点提醒我提交项目材料</small></div>`;
}
let sourceAccountFilter='',sourceAccountRecords=[];
function renderSources() {
  const records=sourceAccountFilter?sourceAccountRecords:data.records;
  const opened = new Set([...document.querySelectorAll('.record[open]')].map(el => el.dataset.sourceId));
  $('#view-content').innerHTML = renderSourcesContent(data, records, sourceAccountFilter, { icon, sourceName });
  document.querySelectorAll('.record').forEach(el => { el.open = opened.has(el.dataset.sourceId); });
}
function field(label, name, value, type = 'text', hint = '') { return `<label class="field"><span>${label}</span><input type="${type}" name="${name}" value="${esc(value)}" ${type === 'password' ? 'autocomplete="new-password"' : ''}>${hint ? `<small>${esc(hint)}</small>` : ''}</label>`; }

let memoryQuery = '';
function memoryContextMarkup(analysis) {
  return analysis.memoryContext?.length ? `<details><summary>本次提供给模型的记忆（${analysis.memoryContext.length}）</summary>${analysis.memoryContext.map(m => `<p>${esc(m.content)}</p>`).join('')}</details>` : '';
}
function renderMemories() {
  $('#view-content').innerHTML = '<div class="memory-intro"><div><h3>记住你的工作方式</h3><p>所有场景共享同一份记忆，你可以随时补充和修改。</p></div><button class="primary" data-action="memory-new">' + icon('plus') + ' 添加记忆</button></div><section class="task-panel"><div class="panel-header"><h2>全局记忆</h2><label class="search">' + icon('search') + '<input id="memory-search" placeholder="搜索记忆" value="' + esc(memoryQuery) + '" aria-label="搜索记忆"></label></div><div id="memory-list"></div></section><div id="memory-suggestions"></div><p class="bottom-note">已记住的内容会按相关性用于聊天、邮件分析和快捷输入。</p>';
  renderMemoryList();
}
function renderMemoryList() {
  const list=data.memories.filter(m=>m.content.toLowerCase().includes(memoryQuery.toLowerCase()));
  const row=m=>'<article class="memory-row"><div class="task-meta"><span class="' + (m.status==='candidate'?'review-badge':'') + '">' + (m.status==='candidate'?'待核对 · 尚未记住':'全局生效') + '</span></div><p class="raw-text">' + esc(m.content) + '</p><div class="button-row">' + (m.status==='candidate'?'<button class="text-button" data-action="memory-approve" data-id="'+m.id+'">记住</button><button class="text-button" data-action="memory-dismiss" data-id="'+m.id+'">忽略</button>':'') + '<button class="text-button" data-action="memory-edit" data-id="'+m.id+'">编辑</button>' + (m.record_id?'<button class="text-button" data-action="memory-source" data-id="'+m.id+'">查看来源</button>':'<small>手动添加</small>') + '</div></article>';
  const active=list.filter(m=>m.status==='approved'),suggestions=list.filter(m=>m.status==='candidate');
  $('#memory-list').innerHTML=active.length?active.map(row).join(''):'<div class="small-empty">还没有匹配的全局记忆。记下一条习惯或经验，让 LoNo 更了解你。</div>';
  $('#memory-suggestions').innerHTML=suggestions.length?'<section class="memory-suggestions"><header><h3>新发现</h3><small>'+suggestions.length+' 条内容，核对后即可加入全局记忆</small></header>'+suggestions.map(row).join('')+'</section>':'';
}
function openMemory(id) {
  const m=data.memories.find(m=>m.id===id)||{kind:'fact',content:''};
  $('#editor').innerHTML='<form id="memory-form" data-memory-id="'+esc(id||'')+'"><div class="dialog-header"><h2>'+(id?'编辑记忆':'添加全局记忆')+'</h2><button type="button" class="close-button" data-action="close">×</button></div><input type="hidden" name="kind" value="'+esc(m.kind)+'"><input type="hidden" name="status" value="approved"><label class="field"><span>希望 LoNo 记住什么</span><textarea name="content" rows="5" maxlength="1000" required placeholder="例如：重要会议通常提前一天提醒我">'+esc(m.content)+'</textarea></label><p class="memory-hint">保存后，聊天、邮件分析和快捷输入都可以使用这条记忆。</p><div class="button-row end">'+(id?'<button type="button" class="secondary" data-action="memory-delete" data-id="'+id+'">删除记忆</button>':'')+'<button type="submit" class="primary">保存记忆</button></div></form>';
  $('#editor').showModal();
}
function openExchangeTest(draft = {}) {
  $('#editor').innerHTML = `<form id="exchange-test-form"><div class="dialog-header"><h2>Exchange 连接测试</h2><button type="button" class="close-button" data-action="close" aria-label="关闭">×</button></div><p class="exchange-intro">用于单位自建 Exchange。「仅测试连接」只读取收件箱计数；「保存并开始采集」会加密保存凭据并读取邮件正文。两种方式均不修改已读状态。</p><div class="form-grid">${field('EWS 接口地址', 'endpoint', draft.endpoint || data.settings.mail.endpoint || '', 'url', '通常为 https://mail.example.com/EWS/Exchange.asmx')}${field('邮箱账号 / 域账号', 'user', draft.account || data.settings.mail.user)}${field('域（可选）', 'domain', '', 'text', '邮箱地址可先留空；也可使用 DOMAIN\\用户名')}${field('密码（仅本次测试）', 'password', '', 'password', '请直接在这里输入，不要发到聊天')}</div><div class="analysis-note">「仅测试」只读取计数且不保存密码；「保存并开始采集」会加密保存凭据并读取近 14 天邮件正文，之后定时同步。已启用模型时，正文和相关已确认记忆会发送到配置的模型。</div><p id="exchange-test-result" role="status" aria-live="polite"></p><div class="button-row end"><button class="secondary" type="submit">仅测试连接</button><button class="primary" type="button" data-action="connect-exchange">保存并开始采集</button></div></form>`;
  $('#editor').showModal();
}
function toggle(name, checked, title, description) { return `<label class="toggle-line"><div><strong>${title}</strong><small>${description}</small></div><input type="checkbox" name="${name}" ${checked ? 'checked' : ''}></label>`; }
let preferencesDraft, secretToClear;
function renderSettings(draft = data.settings) { preferencesDraft = structuredClone(draft); $('#view-content').innerHTML = renderPreferences(preferencesDraft, data.runtime, data.sync); for(const group of document.querySelectorAll('[data-protocol]'))group.querySelectorAll('input').forEach(input=>input.disabled=group.hidden); }
function updateMailStatuses() {
 for(const account of preferencesDraft?.mailAccounts||[]) {
  const card=[...document.querySelectorAll('[data-mail-account]')].find(el=>el.dataset.mailAccount===account.id);if(!card)continue;
  const status=data.sync.mailAccounts?.[account.id]||{};
  card.querySelector('[data-mail-status]').innerHTML=renderMailStatus(account,status,data.settings.pollMinutes);
  const busy=status.state==='syncing'||status.testState==='testing';
  const test=card.querySelector('[data-action="test-mail"]');test.disabled=busy;test.textContent=status.testState==='testing'?'测试中…':'测试连接';
  const sync=card.querySelector('[data-action="sync-mail"]');sync.disabled=busy||!status.saved;sync.textContent=status.state==='syncing'?'同步中…':status.paused?'重试同步':'立即同步';
 }
}
function sourceName(record) { if(record.source!=='email')return labels[record.source]||record.source;const account=data.settings.mailAccounts.find(a=>a.id===record.account_id);return '邮件'+((account?.alias||record.account_alias)?' · '+(account?.alias||record.account_alias):''); }

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
  editingSession++; reviewResult = null; pendingReview = null;
  editing = data.tasks.find(t => t.id === id);
  if (!editing) return;
  const a = JSON.parse(editing.analysis);
  $('#editor').innerHTML = `<form id="edit-form"><div class="dialog-header"><h2>提醒详情</h2><button type="button" class="secondary review-button" data-action="review-task" ${data.settings.model.enabled ? '' : 'disabled'} title="根据原文重新判断，不沿用旧分析">AI 整理</button><button type="button" class="close-button" data-action="close">×</button></div>${fieldsMarkup({ title: editing.title, dueAt: editing.due_at, remindAt: editing.remind_at, priority: editing.priority })}<div id="task-review" aria-live="polite"></div><div class="analysis-note"><strong>${a.engine === 'model' ? '模型分析' : '本地分析'}</strong><p>${esc(a.reason)}</p>${memoryContextMarkup(a)}${a.warning ? `<p class="warning">${esc(a.warning)}</p>` : ''}</div>${aiSummaryMarkup(editing.record_id, a)}<details class="original" open><summary>原始信息 · ${esc(sourceName(editing))} ${esc(editing.sender)}</summary><p class="raw-text">${esc(readableSource(editing.text))}</p></details><div class="button-row end">${editing.status !== 'done' ? '<button type="button" class="secondary" data-action="snooze-current">15 分钟后再提醒</button>' : ''}<button class="primary" type="submit">修改并保存</button></div></form>`;
  $('#editor').showModal();
}
function getTaskFields(form) { const value = name => form.querySelector('[name="'+name+'"]').value; return { title:value('title'),priority:value('priority'),dueAt:iso(value('dueAt')),remindAt:iso(value('remindAt')) }; }

document.addEventListener('pointerdown', event => {
  const dialog=$('#editor'); editorBackdropDown=false;
  if (dialog?.open && event.target===dialog) { const r=dialog.getBoundingClientRect(); editorBackdropDown=event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom; }
});
document.addEventListener('close', event => { if(event.target.id==='editor') { editingSession++; reviewResult=null; pendingReview=null; editing=null; } }, true);
document.addEventListener('click', async event => {
  const dialog = $('#editor');
  if (editorBackdropDown && event.target === dialog) { editorBackdropDown = false; dialog.close(); return; }
  editorBackdropDown = false;
  const nav = event.target.closest('[data-view]');
  if (nav) {
    view = nav.dataset.view; query = ''; updateNav(); renderView();
    if (view === 'settings') {
      const target = ['mail', 'bridge'].includes(nav.dataset.settingsSection) ? $('#settings-' + nav.dataset.settingsSection) : null;
      if (target) {
        target.classList.add('settings-target');
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
        target.focus({ preventScroll: true });
        setTimeout(() => target.classList.remove('settings-target'), 1800);
      } else scrollTo(0, 0);
    }
    if (view === 'chat') await loadChat(); return;
  }
  const button = event.target.closest('[data-action]'); if (!button) return;
  const action = button.dataset.action;
  try {
    if(action==='mail-records') {sourceAccountFilter=button.dataset.id;sourceAccountRecords=await api.invoke('mail-records',sourceAccountFilter);renderSources();document.querySelector('.task-panel.records').scrollIntoView({block:'start'});}
    if(action==='clear-source-filter') {sourceAccountFilter='';renderSources();}
    if (action === 'test-mail' || action === 'sync-mail') {
      button.disabled=true;
      try {
        if(action==='test-mail') {const draft=$('#settings-form')?readPreferences($('#settings-form'),preferencesDraft):data.settings;const account=draft.mailAccounts.find(a=>a.id===button.dataset.id);await api.invoke('test-mail',account);}
        else {const status=await api.invoke('sync-mail',button.dataset.id);toast(status.state==='ok'?'邮箱同步完成':'同步未完成，请查看此邮箱的状态',status.state!=='ok');}
        await refresh();
      } finally {button.disabled=false;updateMailStatuses();}
    }
    if (action === 'add-mail-account') { const draft=readPreferences($('#settings-form'),preferencesDraft);const account=newMailAccount(draft.mailAccounts);draft.mailAccounts.push(account);renderSettings(draft);const card=[...document.querySelectorAll('[data-mail-account]')].at(-1);card.scrollIntoView({block:'start'});card.querySelector('input').focus({preventScroll:true}); }
    if (action === 'remove-mail-account') { const draft=readPreferences($('#settings-form'),preferencesDraft);renderSettings({...draft,mailAccounts:draft.mailAccounts.filter(a=>a.id!==button.dataset.id)});toast('保存配置后移除邮箱，历史提醒保留'); }
    if (action === 'clear-secret') {
      secretToClear={kind:button.dataset.kind,accountId:button.dataset.accountId};
      $('#editor').innerHTML='<form id="clear-secret-form"><h2>确认清除已保存的凭据？</h2><p>确认后立即清除并暂停对应连接，不影响其他配置和历史记录。</p><div class="button-row end"><button type="button" class="secondary" data-action="close">取消</button><button type="submit" class="primary">确认清除</button></div></form>';$('#editor').showModal();
    }
    if (action === 'chat-example') { chatDraft = button.dataset.text; $('#chat-input').value = chatDraft; $('#chat-input').focus(); }
    if (action === 'chat-apply-all' || action === 'chat-dismiss-all') { button.disabled=true;try{await api.invoke('chat-resolve',{messageId:button.dataset.id,decision:action==='chat-apply-all'?'apply':'dismiss'});await refresh();await loadChat();toast(action==='chat-apply-all'?'全部操作已保存':'全部建议已忽略');}finally{button.disabled=false;} }
    if (action === 'chat-apply' || action === 'chat-dismiss') { button.disabled = true; try { await api.invoke('chat-resolve', { id: button.dataset.id, decision: action === 'chat-apply' ? 'apply' : 'dismiss' }); await refresh(); await loadChat(); toast(action === 'chat-apply' ? '操作已保存' : '建议已忽略'); } finally { button.disabled = false; } }
    if (action === 'chat-source') { const record = await api.invoke('chat-source', button.dataset.id); $('#editor').innerHTML = '<div class="dialog-header"><h2>原始记录</h2><button class="close-button" data-action="close">×</button></div><p class="raw-text">' + esc(readableSource(record.text)) + '</p>'; $('#editor').showModal(); }
    if (action === 'memory-new') openMemory();
    if (action === 'memory-edit') openMemory(button.dataset.id);
    if (action === 'memory-approve' || action === 'memory-dismiss') {
      const m = data.memories.find(m => m.id === button.dataset.id);
      await api.invoke('save-memory', { ...m, status: action === 'memory-approve' ? 'approved' : 'dismissed' });
      await refresh(); if (view === 'chat') await loadChat(); toast(action === 'memory-approve' ? '记忆已确认，后续分析可检索使用' : '候选已忽略');
    }
    if (action === 'memory-delete') { await api.invoke('delete-memory', button.dataset.id); $('#editor').close(); await refresh(); toast('记忆已删除；历史分析记录仍保留当时的依据'); }
    if (action === 'memory-source') {
      const { memory: m, record: r } = await api.invoke('memory-source', button.dataset.id);
      $('#editor').innerHTML = '<div class="dialog-header"><h2>记忆来源</h2><button class="close-button" data-action="close">×</button></div><p class="raw-text">' + esc(m.evidence) + '</p>' + (r ? '<p>' + esc((sourceName(r)) + ' · ' + r.sender + ' · ' + dateText(r.received_at)) + '</p><details><summary>完整原文</summary><p class="raw-text">' + esc(readableSource(r.text)) + '</p></details>' : '');
      $('#editor').showModal();
    }
    if (action === 'extract-memory') { button.disabled = true; try { const result = await api.invoke('extract-memories', button.dataset.id); toast('新增 ' + result.count + ' 条候选记忆' + (result.warning ? ' · ' + result.warning : '')); await refresh(); } finally { button.disabled = false; } }
    if (action === 'test-model') {
      button.disabled = true; $('#model-test-result').textContent = '正在调用模型分析示例文本…';
      try { const r = await api.invoke('test-model'); $('#model-test-result').textContent = 'AI 连接成功 · ' + r.title + ' · 提醒 ' + dateText(r.remindAt) + ' · ' + labels[r.priority]; }
      catch (e) { $('#model-test-result').textContent = e.message; }
      finally { button.disabled = false; }
    }
    if (action === 'capture') await openCapture();
    if (action === 'close') { if (isCapture) await api.invoke('hide-capture'); else $('#editor').close(); }
    if (action === 'sync') { button.disabled = true; button.textContent = '同步中…'; await api.invoke('sync'); toast('同步结束，请在信息来源查看结果'); await refresh(); }
    if (action === 'edit') openEdit(button.dataset.id);
    if (action === 'review-task') {
      const id = editing.id, session = editingSession, currentFields = getTaskFields($('#edit-form')); button.disabled = true; button.textContent = '正在整理…';
      try {
        const result = await api.invoke('review-task', id);
        if (session !== editingSession || !$('#editor').open || !$('#task-review')) return;
        reviewResult = { ...result, baseFields: currentFields }; pendingReview = null; $('#task-review').innerHTML = renderTaskReview(result, currentFields);
        for (const el of $('#editor').querySelectorAll('.analysis-note, .ai-summary')) el.hidden = true;
      } finally { button.disabled = false; button.textContent = 'AI 整理'; }
    }
    if (action === 'adopt-task-review') {
      if (!reviewResult || reviewResult.taskId !== editing.id) throw new Error('请重新 AI 整理');
      const a = reviewResult.analysis, form = $('#edit-form');
      form.elements.namedItem('title').value = a.title; form.elements.namedItem('priority').value = a.priority;
      form.elements.namedItem('dueAt').value = inputDate(a.dueAt); form.elements.namedItem('remindAt').value = inputDate(a.remindAt);
      pendingReview = reviewResult;
      $('#task-review').innerHTML = '<p class="review-applied">建议已填入，摘要将一并更新。可继续修改，确认后点击「修改并保存」；尚未写入记录。</p>' + aiSummaryMarkup(editing.record_id, a);
    }
    if (action === 'cancel-task-review') { reviewResult = null; pendingReview = null; $('#task-review').innerHTML = ''; for (const el of $('#editor').querySelectorAll('.analysis-note, .ai-summary')) el.hidden = false; }
    if (action === 'dismiss-task-review') {
      if (!reviewResult || reviewResult.taskId !== editing.id) throw new Error('请重新 AI 整理');
      button.disabled = true;
      try { await api.invoke('apply-task-review', { token: reviewResult.token, decision: 'complete' }); $('#editor').close(); toast('已确认无需处理，原始信息继续保留'); }
      finally { button.disabled = false; }
    }
    if (['complete', 'restore'].includes(action)) { await api.invoke('update-task', { id: button.dataset.id, action }); toast(action === 'complete' ? '又完成了一件事' : '事项已恢复'); }
    if (action === 'snooze-current') { await api.invoke('update-task', { id: editing.id, action: 'snooze' }); $('#editor').close(); toast('将在 15 分钟后再次提醒'); }
    if (action === 'analyze') {
      if (busy) return; busy = true; button.disabled = true; button.innerHTML = icon('refresh'); button.setAttribute('aria-label', '正在分析');
      const revision = captureRevision, session = captureSession;
      resetCapturePreview();
      try {
        const result = await api.invoke('analyze', $('#capture-text').value);
        if (session !== captureSession) return;
        if (revision !== captureRevision) { toast('输入已修改，请重新分析'); return; }
        preview = result;
        document.body.classList.add('has-preview');
        $('#capture-key-hint').innerHTML = '<kbd>↵</kbd> 添加 <span class="hint-divider">·</span> 点外部收起';
        const multiple=preview.tasks.length>1;
        $('#capture-result').innerHTML = '<form id="capture-save-form" class="'+(multiple?'capture-batch':'')+'"><div class="preview-heading"><span>'+ (multiple?preview.tasks.length+' 条提醒预览':'提醒预览')+'</span><span>'+(multiple?'勾选需要的条目，可逐条修改':'确认时间后添加')+'</span></div><div class="capture-items">'+preview.tasks.map((item,index)=>'<fieldset data-capture-item="'+index+'">'+(multiple?'<legend><label><input type="checkbox" data-capture-select checked>第 '+(index+1)+' 项</label></legend>':'')+fieldsMarkup(item)+'<details class="analysis-note"><summary>分析依据</summary><p>'+esc(item.reason)+'</p>'+memoryContextMarkup(item)+'</details></fieldset>').join('')+'</div>'+(preview.skippedPast?'<p class="capture-note">已跳过 '+preview.skippedPast+' 个过去的场次。</p>':'')+(preview.warning?'<p class="warning">'+esc(preview.warning)+'</p>':'')+'<div class="spotlight-save-row"><span>'+(multiple?'仅保存勾选的提醒':preview.remindAt?dateText(preview.remindAt):'可稍后补充时间')+'</span><button type="submit" class="primary">'+(multiple?'确认添加所选提醒':preview.remindAt?'添加提醒':'保存待确认')+' <span class="button-shortcut">↵</span></button></div></form>';
        await api.invoke('capture-layout', 'preview');
      } catch (error) { if (session === captureSession) throw error; }
      finally { if (session === captureSession) { busy = false; button.disabled = false; button.innerHTML = icon('arrow'); button.setAttribute('aria-label', '分析提醒'); } }
    }
    if (action === 'test-notification') { await api.invoke(action); toast('已请求系统发送测试通知'); }
    if (action === 'test-exchange') openExchangeTest();
    if (action === 'connect-exchange') {
      const form = $('#exchange-test-form');
      button.disabled = true;
      $('#exchange-test-result').textContent = '正在加密保存连接并采集收件箱…';
      try { const status = await api.invoke('connect-exchange', Object.fromEntries(new FormData(form))); $('#exchange-test-result').textContent = status.message + '。连接已保存在此设备。'; }
      catch (error) { $('#exchange-test-result').textContent = error.message; }
      finally { form.querySelector('[name="password"]').value = ''; button.disabled = false; }
    }
    if (action === 'retry-shortcuts') { const result = await api.invoke(action); toast(result.active ? `当前快捷键：${result.active}` : '快捷键仍被占用，可使用托盘快速记录', !result.active); }
    if (action === 'export') { if (await api.invoke('export')) toast('记录已导出（不包含连接密钥）'); }
    if (action === 'import') { button.disabled = true; const count = await api.invoke('import'); toast(`已导入 ${count} 条来源记录`); }
  } catch (error) { toast(error.message, true); }
  finally { if (action === 'sync' || action === 'import') { button.disabled = false; if (action === 'sync') button.innerHTML = `${icon('refresh')} 同步信息`; } }
});
document.addEventListener('input', event => {
  if (event.target.id === 'memory-search') { memoryQuery = event.target.value; renderMemoryList(); }
  if (event.target.id === 'search') { query = event.target.value; renderTaskList(); }
  if (event.target.id === 'chat-input') chatDraft = event.target.value;
  if (event.target.id === 'capture-text') { captureRevision++; resetCapturePreview(); }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); const form = event.target; const button = form.querySelector('button[type="submit"]');
  const formSession = captureSession;
  if (button?.disabled) return;
  try {
    if (button) button.disabled = true;
    if (form.id === 'chat-form') {
      if (chatBusy || !chatDraft.trim()) return;
      const text = chatDraft.trim(); chatBusy = true; chatDraft = '';
      chatMessages.push({role:'user',text,detail:{},actions:[]}); renderChatPanel();
      try { await api.invoke('chat-send', text); }
      catch (error) { if (!chatDraft) chatDraft = text; throw error; }
      finally { chatBusy = false; await refresh(); await loadChat(); if (view === 'chat') $('#chat-input').focus(); }
    }
    if (form.id === 'memory-form') {
      const fields = Object.fromEntries(new FormData(form));
      if (form.dataset.memoryId) fields.id = form.dataset.memoryId;
      await api.invoke('save-memory', fields); $('#editor').close(); await refresh(); toast('记忆已保存');
    }
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
      const items=[...form.querySelectorAll('[data-capture-item]')].filter(el=>!el.querySelector('[data-capture-select]')||el.querySelector('[data-capture-select]').checked).map(el=>({index:Number(el.dataset.captureItem),fields:getTaskFields(el)}));
      if(!items.length)throw new Error('请至少勾选一条提醒');
      await api.invoke('save-capture', { token: preview.token, items });
      if (formSession !== captureSession) return;
      preview = null; $('#app').innerHTML = captureMarkup(); document.body.classList.remove('has-preview');
      await api.invoke('capture-layout', 'input'); await api.invoke('hide-capture');
    }
    if (form.id === 'edit-form') {
      const proposal = pendingReview || reviewResult;
      if (proposal?.taskId === editing.id) {
        let fields = getTaskFields(form);
        if (!pendingReview) {
          const a=proposal.analysis, suggested={title:a.title,dueAt:a.dueAt,remindAt:a.remindAt,priority:a.priority};
          fields=Object.fromEntries(Object.entries(suggested).map(([key,value])=>[key,fields[key]!==proposal.baseFields[key]?fields[key]:value]));
        }
        await api.invoke('apply-task-review',{token:proposal.token,fields,decision:'keep'});
      }
      else await api.invoke('update-task', { id: editing.id, action: 'edit', fields: getTaskFields(form) });
      $('#editor').close(); toast('提醒已更新');
    }
    if(form.id==='clear-secret-form') {
      const target={...secretToClear}; const saved=await api.invoke('clear-secret',target);data.settings=saved;
      const prefix=target.kind==='mail'?'mailAccounts.'+target.accountId:target.kind;
      const secretField=target.kind==='model'?'apiKey':target.kind==='mail'?'password':'token';
      const input=document.querySelector('[name="'+prefix+'.'+secretField+'"]');if(input){input.value='';input.placeholder='';input.classList.remove('stored-secret');input.parentElement.querySelector('small')?.remove();}
      const enabled=document.querySelector('[name="'+prefix+'.enabled"]');if(enabled)enabled.checked=false;
      if(target.kind==='mail'){const a=preferencesDraft.mailAccounts.find(a=>a.id===target.accountId);if(a){a.hasPassword=false;a.password='';a.enabled=false;}}else{preferencesDraft[target.kind][secretField]='';preferencesDraft[target.kind][target.kind==='model'?'hasApiKey':'hasToken']=false;preferencesDraft[target.kind].enabled=false;}
      for(const el of document.querySelectorAll('[data-action="clear-secret"]'))if(el.dataset.kind===target.kind&&(target.kind!=='mail'||el.dataset.accountId===target.accountId))el.disabled=true;
      $('#editor').close();secretToClear=null;toast('凭据已清除');
    }
    if (form.id === 'settings-form') {
      const input = readPreferences(form, preferencesDraft);
      await api.invoke('save-settings', input); toast('设置已安全保存'); data = await api.invoke('snapshot'); renderSettings();
    }
  } catch (error) { toast(error.message, true); }
  finally {
    if (button) button.disabled = false;
    if (form.id === 'capture-save-form' && formSession === captureSession) { $('#capture-text').disabled = false; $('#analyze-button').disabled = false; }
  }
});
document.addEventListener('keydown', event => {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!chatBusy) $('#chat-form').requestSubmit(); return; }
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
api.onCaptureReset(() => {
  if (!isCapture) return;
  captureSession++; captureRevision++; busy = false; preview = null;
  $('#app').innerHTML = captureMarkup(); document.body.classList.remove('has-preview');
  clearTimeout(toast.timer); $('#toast').className = '';
});
api.onCapture(() => { requestAnimationFrame(() => { const field = $('#capture-text'); if (field && document.activeElement !== field) { field.focus({ preventScroll: true }); field.setSelectionRange(field.value.length, field.value.length); } }); });
try {
  await refresh();
  if (isCapture) { document.body.classList.add('capture-mode'); $('#app').innerHTML = captureMarkup(); $('#capture-text').focus(); }
  else if (new URLSearchParams(location.search).has('exchangeTest') || new URLSearchParams(location.search).has('exchangeSetup')) {
    view = 'settings'; updateNav(); renderView();
    const params = new URLSearchParams(location.search);
    openExchangeTest({ endpoint: params.get('endpoint'), account: params.get('account') });
  }
} catch (error) { $('#app').textContent = `加载失败：${error.message}`; }

document.addEventListener('change',event=>{if(event.target.name?.startsWith('mailAccounts.')&&event.target.name.endsWith('.protocol')){const card=event.target.closest('[data-mail-account]');card.querySelectorAll('[data-protocol]').forEach(el=>{el.hidden=el.dataset.protocol!==event.target.value;el.querySelectorAll('input').forEach(input=>input.disabled=el.hidden);});}});
