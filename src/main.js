import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, Notification as SystemNotification, powerMonitor, safeStorage, dialog, screen, nativeTheme, shell } from 'electron';
import { release } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { analyze } from './core/analyzer.js';
import { Store } from './core/store.js';
import { Config } from './core/config.js';
import { pollMail, pollBridge, bridgeSchema, identity } from './core/connectors.js';
import { trayIcon } from './icon.js';
import { registerCaptureKeys } from './core/shortcuts.js';
import { testExchangeLocally, pollExchangeLocally } from './exchange-transport.js';
import { connectionInput, testImapConnection, mailFailure } from './core/mail-connection.js';
import { accountStateKey, syncMailAccounts } from './core/mail-accounts.js';
import { exchangeInput, exchangeRequestOptions } from './core/exchange.js';
import { extractMemories } from './core/memory.js';
import { MessageService } from './core/message-service.js';
import { TaskReviewService } from './core/task-review-service.js';
import { ChatStore } from './core/chat-store.js';
import { ChatService } from './core/chat-service.js';
import { TestNotification } from './core/test-notification.js';
import { configureWindowsIdentity, WINDOWS_APP_ID, WINDOWS_TOAST_CLSID } from './windows-shell.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const smoke = process.argv.includes('--smoke');
const Notification = smoke ? TestNotification : SystemNotification;
if (smoke) globalThis.lonoTestNotification = TestNotification;
const exchangeTestMode = process.argv.includes('--exchange-test');
const launchValue = key => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) || '';
const dataArg = process.argv.find(a => a.startsWith('--data-dir='));
// The public brand can change without moving databases or OS-encrypted secrets.
app.setPath('userData', dataArg ? path.resolve(dataArg.slice(11)) : path.join(app.getPath('appData'), 'shiguang-reminder'));
app.setName('LoNo');
if (process.platform === 'win32') {
  app.setAppUserModelId(WINDOWS_APP_ID);
  app.setToastActivatorCLSID(WINDOWS_TOAST_CLSID);
}
let mainWindow, captureWindow, tray, store, config, timer, quitting = false, syncing = false, captureExpanded = false;
let shortcutOK = false, startupWarning = '', notificationWarning = '', notificationBusy = false;
let shortcutState = { keys: [], active: null }, shortcutWarning = '', lastShortcutAt = 0;
let captureBlurTimer;
let startupPhase = 'data', captureReady = false, captureLoading = null, captureWarning = '';
const previews = new Map();
let messages, taskReviews, chatStore, chatAgent;
const notifications = new Set();
const syncStatus = { email: { state: 'idle', message: '尚未同步' }, wecom: { state: 'idle', message: '尚未同步' } };

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_event, argv) => { if (argv.includes('--quick-capture')) capture(); else showMain(); });
  app.whenReady().then(start).catch(error => {
    if (quitting) return; // Window navigation may reject during an intentional exit.
    dialog.showErrorBox('LoNo 启动失败', `${startupPhase === 'data' ? '未能打开本地记录，请保留数据目录并重试。' : '主界面未能加载，请重新启动或检查应用文件是否完整。'}\n${error.message}`);
    quitting = true; app.quit();
  });
}

const supportsAcrylic = process.platform === 'win32' && Number(release().split('.')[2]) >= 22621;
function windowMaterial() {
  if (nativeTheme.prefersReducedTransparency || nativeTheme.shouldUseHighContrastColors) return 'opaque';
  return supportsAcrylic ? 'acrylic' : process.platform === 'darwin' ? 'vibrancy' : 'opaque';
}
function applyMaterial(win) {
  const material = windowMaterial();
  win.setBackgroundColor(material === 'opaque' ? '#f5f5f7' : '#00000000');
  if (supportsAcrylic) win.setBackgroundMaterial(material === 'acrylic' ? 'acrylic' : 'none');
  if (process.platform === 'win32' && win === mainWindow) win.setTitleBarOverlay({ color: '#00000000', symbolColor: nativeTheme.shouldUseHighContrastColors && nativeTheme.shouldUseDarkColors ? '#ffffff' : '#65505d', height: 42 });
  if (process.platform === 'darwin') win.setVibrancy(material === 'vibrancy' ? 'under-window' : null);
}
function windowOptions(extra = {}) {
  return { backgroundColor: '#00000000', icon: trayIcon(), webPreferences: { preload: path.join(root, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, additionalArguments: smoke ? ['--smoke'] : [] }, ...extra };
}
function secureWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
}
function showMain() { if (!quitting && mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.restore(); mainWindow.focus(); } }
function layoutCapture(useCursor = false) {
  const area = useCursor ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea : screen.getDisplayMatching(captureWindow.getBounds()).workArea;
  const width = Math.min(680, area.width - 32);
  const height = Math.min(captureExpanded ? 470 : 112, area.height - 40);
  const current = captureWindow.getBounds();
  const x = useCursor ? area.x + (area.width - width) / 2 : Math.max(area.x + 16, Math.min(current.x, area.x + area.width - width - 16));
  const y = useCursor ? area.y + (area.height - height) / 3 : Math.max(area.y + 20, Math.min(current.y, area.y + area.height - height - 20));
  captureWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
}
async function ensureCapturePage() {
  if (quitting || !captureWindow || captureWindow.isDestroyed()) return false;
  if (captureReady) return true;
  if (captureLoading) return captureLoading;
  captureLoading = (async () => {
    try {
      await captureWindow.loadFile(path.join(root, 'ui/index.html'), { query: { capture: '1' } });
      if (quitting || captureWindow.isDestroyed()) return false;
      captureReady = true; captureWarning = ''; broadcast(); return true;
    } catch {
      if (!quitting) { captureWarning = '快捷输入暂时无法加载；主界面仍可使用。再次点击快速记录会重试。'; broadcast(); }
      return false;
    } finally { captureLoading = null; }
  })();
  return captureLoading;
}
async function capture() {
  if (!await ensureCapturePage()) { if (!quitting) showMain(); return false; }
  if (quitting || captureWindow.isDestroyed()) return false;
  clearTimeout(captureBlurTimer);
  if (!captureWindow.isVisible()) { captureExpanded = false; captureWindow.webContents.send('capture-reset'); }
  layoutCapture(true);
  if (captureWindow.isMinimized()) captureWindow.restore();
  captureWindow.show(); captureWindow.moveTop(); captureWindow.focus(); captureWindow.webContents.focus();
  captureWindow.webContents.send('capture-focus');
  // The compositor may focus the document after the first show. Repeat only while
  // this panel still owns focus, so an outside click never causes focus stealing.
  setTimeout(() => { if (!captureWindow.isDestroyed() && captureWindow.isVisible() && captureWindow.isFocused()) { captureWindow.webContents.focus(); captureWindow.webContents.send('capture-focus'); } }, 80);
  return true;
}
function registerShortcuts() {
  shortcutState = registerCaptureKeys(globalShortcut, () => {
    if (Date.now() - lastShortcutAt < 300) return;
    lastShortcutAt = Date.now();
    if (captureWindow.isVisible() && captureWindow.isFocused()) captureWindow.hide(); else capture();
  });
  shortcutOK = Boolean(shortcutState.active);
  shortcutWarning = !shortcutOK ? '两个全局快捷键均被占用，请使用托盘或快速记录按钮。' : !shortcutState.keys[0].registered ? `${shortcutState.keys[0].label} 已被占用；当前可用 ${shortcutState.active}。` : '';
  tray?.setToolTip(`LoNo · ${shortcutState.active || '托盘菜单'} 快速记录`);
}
function broadcast() { for (const win of [mainWindow, captureWindow]) if (win && !win.isDestroyed()) win.webContents.send('changed'); }
function mailStatuses() {
  const states={...syncStatus.mailAccounts};
  for(const account of config.value.mailAccounts) {
    const cursor=store.state(accountStateKey(account),{});
    states[account.id]={...store.state('mail-status:'+account.id,{}),...states[account.id],saved:true,enabled:account.enabled,paused:Boolean(cursor.authPaused)};
    if(states[account.id].testState==='testing'&&!mailTestJobs.has(account.id)){states[account.id].testState='interrupted';states[account.id].testMessage='上次连接测试未完成，请重新测试';}
    if(states[account.id].state==='syncing'&&!syncing){states[account.id].state='idle';states[account.id].message='上次同步未完成，请重新同步';}
  }
  return states;
}
function setMailStatus(account,status) {
  const saved=config.value.mailAccounts.some(a=>a.id===account.id);
  const next={...(syncStatus.mailAccounts?.[account.id]||store.state('mail-status:'+account.id,{})),...status,saved};
  syncStatus.mailAccounts ||= {};syncStatus.mailAccounts[account.id]=next;
  if(saved)store.setState('mail-status:'+account.id,next);
  broadcast();return next;
}
const mailTestJobs=new Set();
const mailIO={testImap:testImapConnection,pollImap:pollMail};
if(smoke)globalThis.lonoMailIO=mailIO;
function snapshot() {
  return { tasks: store.tasks(), records: store.records(), mailStats: store.mailStats(), memories: store.memories(), settings: config.public(), sync: { ...syncStatus, mailAccounts: mailStatuses() },
    runtime: { shortcutOK, shortcut: shortcutState.active, shortcuts: shortcutState.keys, shortcutWarning, startupWarning, captureWarning, notificationWarning, material: windowMaterial(), dataPath: app.getPath('userData'), version: app.getVersion() } };
}
async function start() {
  nativeTheme.themeSource = 'light';
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'LoNo', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { label: '打开 LoNo', click: showMain }, { label: '快速记录', click: capture }, { type: 'separator' }, { role: 'front' }] },
    ]));
  }
  store = await Store.open(path.join(app.getPath('userData'), 'reminders.sqlite'));
  if (quitting) return;
  config = new Config(path.join(app.getPath('userData'), 'settings.json'), safeStorage);
  try { await config.load(); store.assignLegacyMail(config.value.mailAccounts?.[0]); } catch { startupWarning = '设置或系统密钥无法读取，本次使用离线模式；原设置文件已保留。请先备份，再重新配置。'; }
  if (quitting) return;
  messages = new MessageService(store, () => config.value);
  taskReviews = new TaskReviewService(store, () => config.value.model);
  chatStore = new ChatStore(store);
  chatAgent = new ChatService(store, chatStore, () => config.value.model);
  startupPhase = 'windows';
  mainWindow = new BrowserWindow(windowOptions({ width: 1260, height: 850, minWidth: 960, minHeight: 650, title: 'LoNo · Loop Notify', show: false, ...(['win32', 'darwin'].includes(process.platform) ? { titleBarStyle: 'hidden' } : {}), ...(process.platform === 'win32' ? { titleBarOverlay: { color: '#00000000', symbolColor: '#65505d', height: 42 } } : {}), ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 18, y: 22 } } : {}) }));
  if (process.platform === 'win32') {
    try { await configureWindowsIdentity(mainWindow, { app, shell, isolated: smoke || exchangeTestMode || Boolean(dataArg) }); }
    catch (error) { startupWarning = [startupWarning, `Windows 图标设置未完成：${error.message}`].filter(Boolean).join('；'); }
  }
  if (quitting) return;
  captureWindow = new BrowserWindow(windowOptions({ width: 680, height: 340, title: '快速记录 · LoNo', frame: false, hasShadow: true, roundedCorners: true, backgroundColor: '#f7f7f9', alwaysOnTop: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false }));
  for (const win of [mainWindow, captureWindow]) {
    secureWindow(win);
    if (process.platform !== 'darwin') win.setMenuBarVisibility(false);
  }
  for (const win of [mainWindow, captureWindow]) applyMaterial(win);
  nativeTheme.on('updated', () => { for (const win of [mainWindow, captureWindow]) if (!win.isDestroyed()) applyMaterial(win); broadcast(); });
  mainWindow.on('close', event => {
    if (quitting) return;
    if (exchangeTestMode || !tray) { quitting = true; app.quit(); }
    else { event.preventDefault(); mainWindow.hide(); }
  });
  captureWindow.on('close', event => { if (!quitting) { event.preventDefault(); captureWindow.hide(); } });
  captureWindow.on('hide', () => { captureExpanded = false; captureWindow.webContents.send('capture-reset'); });
  captureWindow.on('blur', () => {
    clearTimeout(captureBlurTimer);
    captureBlurTimer = setTimeout(() => { if (!captureWindow.isDestroyed() && !captureWindow.isFocused()) captureWindow.hide(); }, 100);
  });
  registerIPC();
  await mainWindow.loadFile(path.join(root, 'ui/index.html'), { query: exchangeTestMode ? { exchangeTest: '1', endpoint: launchValue('endpoint'), account: launchValue('account') } : process.argv.includes('--exchange-setup') ? { exchangeSetup: '1', endpoint: launchValue('endpoint'), account: launchValue('account') } : {} });
  if (quitting) return;
  await ensureCapturePage();
  if (quitting || mainWindow.isDestroyed()) return;
  if (!process.argv.includes('--quick-capture')) mainWindow.show();
  tray = new Tray(trayIcon({ menuBar: process.platform === 'darwin' })); tray.setToolTip('LoNo · 快速记录');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开LoNo', click: showMain }, { label: '快速记录', click: capture }, { type: 'separator' }, { label: '退出（停止提醒）', click: () => { quitting = true; app.quit(); } }]));
  tray.on('double-click', showMain);
  if (!exchangeTestMode) registerShortcuts();
  powerMonitor.on('resume', () => { checkDue(); void syncAll(); });
  resetPolling();
  setInterval(() => void checkDue(), 15000).unref();
  await checkDue();
  if (!smoke && !exchangeTestMode) void syncAll();
  broadcast();
  if (process.argv.includes('--quick-capture')) capture();
}

function registerIPC() {
  const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
    if (![mainWindow?.webContents.id, captureWindow?.webContents.id].includes(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('未经授权的调用');
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.name === 'ZodError' ? '输入格式无效，请检查日期、地址或必填项' : error.message || '操作失败' }; }
  });
  handle('snapshot', snapshot);
  handle('chat-history', () => chatStore.messages());
  handle('chat-send', async text => { try { return await chatAgent.send(text); } finally { broadcast(); } });
  handle('chat-resolve', ({ id, decision }) => { chatStore.resolve(id, decision); broadcast(); void checkDue(); });
  handle('chat-source', id => { if (typeof id !== 'string' || id.length > 100) throw new Error('来源标识无效'); const record = store.record(id); if (!record) throw new Error('找不到原始记录'); return record; });
  handle('review-task', id => taskReviews.preview(id));
  handle('apply-task-review', input => { taskReviews.apply(input); broadcast(); void checkDue(); });
  handle('save-memory', input => { const id = store.saveMemory(input); broadcast(); return id; });
  handle('delete-memory', id => { store.deleteMemory(id); broadcast(); });
  handle('memory-source', id => {
    const memory = store.memories().find(m => m.id === id);
    if (!memory) throw new Error('找不到记忆');
    return { memory, record: memory.record_id ? store.record(memory.record_id) : null };
  });
  handle('extract-memories', async id => {
    const record = store.record(id);
    if (!record) throw new Error('找不到来源记录');
    const result = await extractMemories(record.text, { model: config.value.model });
    const count = store.addMemoryCandidates(id, result.memories); broadcast();
    return { count, warning: result.warning, engine: result.engine };
  });
  handle('test-exchange', input => testExchangeLocally(input));
  handle('mail-records', id => {if(typeof id!=='string'||id.length>100)throw new Error('无效邮箱标识');return store.recordsForAccount(id);});
  handle('test-mail', async input => {
    if(mailTestJobs.has(input?.id))throw new Error('正在测试此邮箱');
    const saved=config.value.mailAccounts.find(a=>a.id===input?.id),account=connectionInput(input,saved);
    mailTestJobs.add(account.id);setMailStatus(account,{testState:'testing',testMessage:'正在验证TLS、登录和只读收件箱权限…'});
    try {
      const result=account.protocol==='exchange'?await testExchangeLocally(account):await mailIO.testImap(account);
      const status=setMailStatus(account,{testState:'ok',testAt:new Date().toISOString(),testMessage:'连接成功，收件箱共 '+result.total+' 封；未读取邮件正文。'});
      return status;
    } catch(error) {
      const issue=mailFailure(error);
      return setMailStatus(account,{testState:'error',testAt:new Date().toISOString(),testCode:issue.code,testMessage:issue.message});
    } finally {mailTestJobs.delete(account.id);}
  });
  handle('sync-mail', async accountId => {
    if(syncing)throw new Error('正在同步，请等待当前任务完成');
    const account=config.value.mailAccounts.find(a=>a.id===accountId);if(!account)throw new Error('请先保存此邮箱配置');connectionInput(account,account);
    const key=accountStateKey(account);store.setState(key,{...store.state(key,{}),authPaused:false});
    await syncAll(accountId);return mailStatuses()[accountId];
  });
  handle('test-model', async () => {
    if (!config.value.model.enabled) throw new Error('请先启用并保存模型设置');
    const result = await analyze('FW: 有关事项说明\n请于明天下午三点前提交项目验收材料，提前一小时提醒。', { source: 'email', model: config.value.model });
    if (result.engine !== 'model') throw new Error('模型未返回有效的提醒 JSON，请检查地址、模型名称、密钥和账户余额');
    return result;
  });
  handle('connect-exchange', async input => {
    if (syncing) throw new Error('正在同步，请稍后再试');
    if (startupWarning) throw new Error('请先处理设置读取问题，再保存连接');
    const value = exchangeInput.parse(input); exchangeRequestOptions(value);
    await config.save({ ...config.value, mail: { ...config.value.mail, enabled: true, protocol: 'exchange', endpoint: value.endpoint, user: value.user, domain: value.domain, password: value.password } });
    const key = accountStateKey(config.value.mail); store.setState(key, { ...store.state(key, {}), authPaused: false });
    resetPolling(); broadcast(); await syncAll(); return syncStatus.email;
  });
  handle('analyze', async text => {
    if (previews.size > 100) previews.delete(previews.keys().next().value);
    const analysis = await analyze(text, { manual: true, model: config.value.model, memories: typeof text === 'string' ? store.recall(text) : [] });
    const token = randomUUID(); previews.set(token, { text: text.trim(), analysis, expires: Date.now() + 30 * 60000 });
    return { token, ...analysis };
  });
  handle('save-capture', ({ token, fields }) => {
    const preview = previews.get(token);
    if (!preview || preview.expires < Date.now()) throw new Error('分析已过期，请重新分析');
    const result = store.ingest({ text: preview.text }, preview.analysis, fields);
    previews.delete(token); broadcast(); void checkDue(); return result;
  });
  handle('update-task', ({ id, action, fields }) => { store.updateTask(id, action, fields); broadcast(); void checkDue(); });
  handle('save-settings', async input => {
    if (syncing) throw new Error('正在同步，请等待完成后再保存设置');
    if (startupWarning.includes('设置或系统密钥无法读取')) throw new Error('原设置文件无法解密，请先备份数据目录中的 settings.json 并移走，再重启配置');
    const previous = structuredClone(config.value);
    const result = await config.save(input);
    try {
      if (input.launchAtLogin !== previous.launchAtLogin) app.setLoginItemSettings({ openAtLogin: Boolean(input.launchAtLogin), path: process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe') });
    } catch {
      await config.save(previous, { retainBlankSecrets: false });
      throw new Error('未能更新系统登录启动项，设置已还原');
    }
    for(const account of config.value.mailAccounts) {
      const old=previous.mailAccounts.find(a=>a.id===account.id);
      if(!old || (!old.enabled && account.enabled) || ['protocol','endpoint','domain','host','port','user','password','mailbox'].some(key=>old[key]!==account[key])) {
        const key=accountStateKey(account); store.setState(key,{...store.state(key,{}),authPaused:false});
      }
    }
    resetPolling(); broadcast(); return result;
  });
  handle('sync', async () => { if(syncing)throw new Error('正在同步，请等待当前任务完成');await syncAll(); return syncStatus; });
  handle('clear-secret', async input => { if(syncing) throw new Error('正在同步，请稍后再清除'); const result=await config.clearSecret(input); resetPolling(); broadcast(); return result; });
  handle('resume-mail', accountId => {
    if (syncing) throw new Error('请等待当前同步完成');
    const account=config.value.mailAccounts.find(a=>a.id===accountId);if(!account)throw new Error('邮箱不存在');
    const key = accountStateKey(account);
    store.setState(key, { ...store.state(key, {}), authPaused: false });
    syncStatus.email = { state: 'idle', message: '暂停已解除，下次同步会重试' }; broadcast();
  });
  handle('capture', async () => { if (!await capture()) throw new Error(captureWarning || '应用正在退出'); });
  handle('hide-capture', () => captureWindow.hide());
  handle('retry-shortcuts', () => { registerShortcuts(); broadcast(); return shortcutState; });
  handle('capture-layout', state => {
    if (!['input', 'preview'].includes(state)) throw new Error('无效的弹窗状态');
    const expanded = state === 'preview';
    if (expanded === captureExpanded) return;
    captureExpanded = expanded;
    if (captureWindow.isVisible()) layoutCapture();
  });
  handle('test-notification', () => {
    if (!Notification.isSupported()) throw new Error('系统当前不支持通知');
    sendNotification('提醒测试', '系统通知已触发；若未看到，请检查系统通知与勿扰设置。', false);
  });
  handle('export', async () => {
    const target = await dialog.showSaveDialog(mainWindow, { title: '导出本地记录（不含凭据）', defaultPath: 'shiguang-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!target.canceled) fs.writeFileSync(target.filePath, JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), tasks: store.tasks(), records: store.records(null), memories: store.memories(), chat: chatStore.messages(0) }, null, 2));
    return !target.canceled;
  });
  handle('import', async () => {
    const files = await dialog.showOpenDialog(mainWindow, { title: '导入企业微信桥接数据', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (files.canceled) return 0;
    if (fs.statSync(files.filePaths[0]).size > 2 * 1024 * 1024) throw new Error('文件不能超过 2MB');
    const data = bridgeSchema.parse(JSON.parse(fs.readFileSync(files.filePaths[0], 'utf8')));
    let count = 0;
    for (const m of data.messages) {
      const result = await consume({ key: `wecom:import:${m.id}`, source: 'wecom', sender: m.sender || '', text: m.text, receivedAt: m.sentAt });
      if (!result.duplicate) count++;
    }
    broadcast(); return count;
  });
  if (smoke) handle('smoke', async command => {
    if (command === 'mail-sources') {
      for (const account of config.value.mailAccounts) store.ingest({ key:'smoke-mail:'+account.id,source:'email',accountId:account.id,accountAlias:account.alias,text:'多邮箱来源测试',receivedAt:new Date().toISOString() }, {shouldRemind:true,title:account.alias+' 来源测试',dueAt:null,remindAt:null,priority:'medium',confidence:.9,reason:'isolated test'});
      broadcast();
    }
    if (command === 'capture') capture();
    if (command === 'due') { const tasks = store.tasks().filter(t => t.status === 'pending'); if (tasks[0]) { store.db.run('UPDATE tasks SET remind_at=?, notified_at=NULL WHERE id=?', [new Date(Date.now() - 1000).toISOString(), tasks[0].id]); store.persist(); await checkDue(); } return snapshot(); }
    if (command === 'check') await checkDue();
    return snapshot();
  });
}

function resetPolling() { if (timer) clearInterval(timer); timer = setInterval(() => void syncAll(), config.value.pollMinutes * 60000); timer.unref(); }
const consume = message => messages.consume(message);

async function syncAll(accountId) {
  if (syncing) return;
  syncing = true;
  try {
    await syncMailAccounts({accounts:accountId?config.value.mailAccounts.filter(a=>a.id===accountId).map(a=>({...a,enabled:true})):config.value.mailAccounts,store,pollImap:mailIO.pollImap,pollExchange:pollExchangeLocally,consume,onStatus:(account,status)=>{setMailStatus(account,status);syncStatus.email=status;}});
    if (!accountId && config.value.bridge.enabled) {
      syncStatus.wecom = { state: 'syncing', message: '正在读取企业微信桥接…' }; broadcast();
      try {
        const bridge = config.value.bridge; const key = `bridge:${identity(bridge.endpoint)}`;
        const result = await pollBridge(bridge, store.state(key));
        let count = 0;
        for (const message of result.messages) { const r = await consume(message); if (!r.duplicate) count++; }
        if (result.cursor !== undefined && result.cursor !== null) store.setState(key, result.cursor);
        syncStatus.wecom = { state: 'ok', message: `新增 ${count} 条记录`, at: new Date().toISOString() };
      } catch { syncStatus.wecom = { state: 'error', message: '桥接同步失败，请检查地址、Token 和 JSON 格式；游标不会前移。', at: new Date().toISOString() }; }
    }
  } finally { syncing = false; broadcast(); await checkDue(); }
}

function sendNotification(title, body, persist = true, taskId, revision) {
  const n = new Notification({ title, body, silent: false }); notifications.add(n);
  n.taskKey = taskId ? `${taskId}:${revision}` : null;
  n.on('click', showMain);
  n.once('show', () => {
    try {
      if (persist && taskId) store.notified(taskId, new Date(), revision);
      notificationWarning = '';
    } catch { notificationWarning = '通知已显示，但状态保存失败，请检查磁盘空间；任务保留待重试。'; }
    broadcast();
  });
  n.once('failed', () => { notificationWarning = '系统通知发送失败，提醒仍保留在列表中；请检查系统通知权限。'; notifications.delete(n); broadcast(); });
  n.once('close', () => notifications.delete(n));
  try { n.show(); } catch { notifications.delete(n); notificationWarning = '系统通知发送失败，提醒保留待重试。'; broadcast(); }
  return n;
}
async function checkDue() {
  if (notificationBusy || !store) return;
  notificationBusy = true;
  try {
    if (!Notification.isSupported()) { notificationWarning = '当前系统不支持桌面通知，请在列表查看到期事项。'; return; }
    const active = new Set([...notifications].map(n => n.taskKey).filter(Boolean));
    for (const task of store.due()) {
      if (active.has(`${task.id}:${task.revision}`)) continue;
      sendNotification(`${task.priority === 'high' ? '重要 · ' : ''}${task.title}`, '提醒时间已到，点击打开LoNo。', true, task.id, task.revision);
    }
  } catch { notificationWarning = '检查提醒时出现错误，请检查本地数据和磁盘空间。'; broadcast(); }
  finally { notificationBusy = false; }
}
app.on('activate', showMain);
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); if (timer) clearInterval(timer); });
app.on('will-quit', () => { store?.close(); });
