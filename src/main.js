import { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, Notification, powerMonitor, safeStorage, dialog, screen, nativeTheme } from 'electron';
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
import { mailStateKey } from './core/exchange-sync.js';
import { exchangeInput, exchangeRequestOptions } from './core/exchange.js';
import { extractMemories } from './core/memory.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const smoke = process.argv.includes('--smoke');
const exchangeTestMode = process.argv.includes('--exchange-test');
const launchValue = key => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3) || '';
const dataArg = process.argv.find(a => a.startsWith('--data-dir='));
// The public brand can change without moving databases or OS-encrypted secrets.
app.setPath('userData', dataArg ? path.resolve(dataArg.slice(11)) : path.join(app.getPath('appData'), 'shiguang-reminder'));
app.setName('LoNo');
app.setAppUserModelId('com.shiguang.reminder');
let mainWindow, captureWindow, tray, store, config, timer, quitting = false, syncing = false, captureExpanded = false;
let shortcutOK = false, startupWarning = '', notificationWarning = '', notificationBusy = false;
let shortcutState = { keys: [], active: null }, shortcutWarning = '', lastShortcutAt = 0;
let captureBlurTimer;
let startupPhase = 'data', captureReady = false, captureLoading = null, captureWarning = '';
const previews = new Map();
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
  shortcutWarning = !shortcutOK ? '两个全局快捷键均被占用，请使用托盘或快速记录按钮。' : !shortcutState.keys[0].registered ? `Ctrl+Shift+Space 已被占用；当前可用 ${shortcutState.active}。` : '';
  tray?.setToolTip(`LoNo · ${shortcutState.active || '托盘菜单'} 快速记录`);
}
function broadcast() { for (const win of [mainWindow, captureWindow]) if (win && !win.isDestroyed()) win.webContents.send('changed'); }
function snapshot() {
  return { tasks: store.tasks(), records: store.records(), memories: store.memories(), settings: config.public(), sync: syncStatus,
    runtime: { shortcutOK, shortcut: shortcutState.active, shortcuts: shortcutState.keys, shortcutWarning, startupWarning, captureWarning, notificationWarning, material: windowMaterial(), dataPath: app.getPath('userData'), version: app.getVersion() } };
}
async function start() {
  nativeTheme.themeSource = 'light';
  store = await Store.open(path.join(app.getPath('userData'), 'reminders.sqlite'));
  if (quitting) return;
  config = new Config(path.join(app.getPath('userData'), 'settings.json'), safeStorage);
  try { await config.load(); } catch { startupWarning = '设置或系统密钥无法读取，本次使用离线模式；原设置文件已保留。请先备份，再重新配置。'; }
  if (quitting) return;
  startupPhase = 'windows';
  mainWindow = new BrowserWindow(windowOptions({ width: 1260, height: 850, minWidth: 960, minHeight: 650, title: 'LoNo · Loop Notify', show: false }));
  captureWindow = new BrowserWindow(windowOptions({ width: 680, height: 340, title: '快速记录 · LoNo', frame: false, hasShadow: true, roundedCorners: true, backgroundColor: '#f7f7f9', alwaysOnTop: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false }));
  for (const win of [mainWindow, captureWindow]) { secureWindow(win); win.setMenuBarVisibility(false); }
  for (const win of [mainWindow, captureWindow]) applyMaterial(win);
  nativeTheme.on('updated', () => { for (const win of [mainWindow, captureWindow]) if (!win.isDestroyed()) applyMaterial(win); broadcast(); });
  mainWindow.on('close', event => {
    if (quitting) return;
    if (exchangeTestMode || !tray) { quitting = true; app.quit(); }
    else { event.preventDefault(); mainWindow.hide(); }
  });
  captureWindow.on('close', event => { if (!quitting) { event.preventDefault(); captureWindow.hide(); } });
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
  tray = new Tray(trayIcon()); tray.setToolTip('LoNo · Ctrl+Shift+Space 快速记录');
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
    const key = mailStateKey(config.value.mail); store.setState(key, { ...store.state(key, {}), authPaused: false });
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
      await config.save(previous);
      throw new Error('未能更新系统登录启动项，设置已还原');
    }
    if (JSON.stringify(previous.mail) !== JSON.stringify(config.value.mail)) {
      const key = mailStateKey(config.value.mail); store.setState(key, { ...store.state(key, {}), authPaused: false });
    }
    resetPolling(); broadcast(); return result;
  });
  handle('sync', async () => { await syncAll(); return syncStatus; });
  handle('resume-mail', () => {
    if (syncing) throw new Error('请等待当前同步完成');
    const key = mailStateKey(config.value.mail);
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
    sendNotification('提醒测试', '系统通知已触发；若未看到，请检查 Windows 通知与勿扰设置。', false);
  });
  handle('export', async () => {
    const target = await dialog.showSaveDialog(mainWindow, { title: '导出本地记录（不含凭据）', defaultPath: 'shiguang-backup.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (!target.canceled) fs.writeFileSync(target.filePath, JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), tasks: store.tasks(), records: store.records(null), memories: store.memories() }, null, 2));
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
    if (command === 'capture') capture();
    if (command === 'due') { const tasks = store.tasks().filter(t => t.status === 'pending'); if (tasks[0]) { store.db.run('UPDATE tasks SET remind_at=?, notified_at=NULL WHERE id=?', [new Date(Date.now() - 1000).toISOString(), tasks[0].id]); store.persist(); await checkDue(); } return snapshot(); }
    if (command === 'check') await checkDue();
    return snapshot();
  });
}

function resetPolling() { if (timer) clearInterval(timer); timer = setInterval(() => void syncAll(), config.value.pollMinutes * 60000); timer.unref(); }
async function consume(message) {
  if (store.hasRecord(message.key)) return { duplicate: true };
  const received = new Date(message.receivedAt);
  // Relative dates refer to when a message was sent/received, not the later sync time.
  const analysis = await analyze(message.text, { now: received, source: message.source, sender: message.sender, model: config.value.model, memories: store.recall(message.text) });
  let memoryExtraction;
  if (message.source === 'email' && config.value.mail.extractMemory) memoryExtraction = await extractMemories(message.text, { model: config.value.model });
  // Candidates and the source are committed together. A failed write cannot leave
  // a source marked consumed without its extracted memories.
  return store.ingest(message, { ...analysis, ...(memoryExtraction?.warning ? { memoryWarning: memoryExtraction.warning } : {}) }, undefined, message.source === 'email' && !config.value.mail.extractMemory ? false : memoryExtraction?.memories);
}
async function syncAll() {
  if (syncing) return;
  syncing = true;
  try {
    if (config.value.mail.enabled) {
      syncStatus.email = { state: 'syncing', message: '正在读取邮件…' }; broadcast();
      try {
        const mail = config.value.mail;
        const key = mailStateKey(mail);
        const state = store.state(key, {});
        if (state.authPaused) { const e = new Error('认证失败后已暂停自动尝试；请修改连接设置或点击恢复邮件同步'); e.code = 'PAUSED'; throw e; }
        const result = mail.protocol === 'exchange'
          ? await pollExchangeLocally(mail, state, consume, { hasRecord: key => store.hasRecord(key) })
          : await pollMail(mail, state, consume);
        store.setState(key, result);
        syncStatus.email = { state: 'ok', message: `已处理 ${result.count} 封邮件${result.remaining ? `，剩余 ${result.remaining} 封下轮继续` : ''}`, at: new Date().toISOString() };
      } catch (error) {
        const key = mailStateKey(config.value.mail);
        if (error.code === 'AUTH') store.setState(key, { ...store.state(key, {}), authPaused: true });
        if (error.code === 'ErrorInvalidSyncStateData') store.setState(key, {});
        syncStatus.email = { state: 'error', message: ['AUTH', 'PAUSED', 'THROTTLED', 'ErrorInvalidSyncStateData'].includes(error.code) ? error.message + (error.code === 'ErrorInvalidSyncStateData' ? '；下轮重新建立游标，原记录会去重' : '') : '邮件同步失败，请检查服务器、TLS、账号或密码；本页游标未推进，已保存记录会去重重试。', at: new Date().toISOString() };
      }
    }
    if (config.value.bridge.enabled) {
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
  n.once('failed', () => { notificationWarning = '系统通知发送失败，提醒仍保留在列表中；请检查 Windows 通知权限。'; notifications.delete(n); broadcast(); });
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
