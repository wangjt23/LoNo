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

const root = path.dirname(fileURLToPath(import.meta.url));
const smoke = process.argv.includes('--smoke');
const dataArg = process.argv.find(a => a.startsWith('--data-dir='));
if (dataArg) app.setPath('userData', path.resolve(dataArg.slice(11)));
app.setAppUserModelId('com.shiguang.reminder');
let mainWindow, captureWindow, tray, store, config, timer, quitting = false, syncing = false, captureExpanded = false;
let shortcutOK = false, startupWarning = '', notificationWarning = '', notificationBusy = false;
const previews = new Map();
const notifications = new Set();
const syncStatus = { email: { state: 'idle', message: '尚未同步' }, wecom: { state: 'idle', message: '尚未同步' } };

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showMain());
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('拾光提醒启动失败', `未能加载本地数据，请保留数据目录并重试。\n${error.message}`); app.quit(); });
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
function showMain() { if (mainWindow) { mainWindow.show(); mainWindow.restore(); mainWindow.focus(); } }
function layoutCapture(useCursor = false) {
  const area = useCursor ? screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea : screen.getDisplayMatching(captureWindow.getBounds()).workArea;
  const width = Math.min(680, area.width - 32);
  const height = Math.min(captureExpanded ? 640 : 310, area.height - 40);
  const current = captureWindow.getBounds();
  const x = useCursor ? area.x + (area.width - width) / 2 : Math.max(area.x + 16, Math.min(current.x, area.x + area.width - width - 16));
  const y = useCursor ? area.y + (area.height - height) / 3 : Math.max(area.y + 20, Math.min(current.y, area.y + area.height - height - 20));
  captureWindow.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
}
function capture() {
  layoutCapture(true);
  captureWindow.show(); captureWindow.focus(); captureWindow.webContents.send('capture-focus');
}
function broadcast() { for (const win of [mainWindow, captureWindow]) if (win && !win.isDestroyed()) win.webContents.send('changed'); }
function snapshot() {
  return { tasks: store.tasks(), records: store.records(), settings: config.public(), sync: syncStatus,
    runtime: { shortcutOK, shortcut: 'Ctrl+Shift+Space', startupWarning, notificationWarning, material: windowMaterial(), dataPath: app.getPath('userData'), version: app.getVersion() } };
}
async function start() {
  nativeTheme.themeSource = 'light';
  store = await Store.open(path.join(app.getPath('userData'), 'reminders.sqlite'));
  config = new Config(path.join(app.getPath('userData'), 'settings.json'), safeStorage);
  try { await config.load(); } catch { startupWarning = '设置或系统密钥无法读取，本次使用离线模式；原设置文件已保留。请先备份，再重新配置。'; }
  mainWindow = new BrowserWindow(windowOptions({ width: 1260, height: 850, minWidth: 960, minHeight: 650, title: '拾光提醒 · Shiguang', show: false }));
  captureWindow = new BrowserWindow(windowOptions({ width: 680, height: 340, title: '快速记录 · 拾光提醒', frame: false, hasShadow: true, roundedCorners: true, backgroundColor: '#f7f7f9', alwaysOnTop: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, show: false }));
  for (const win of [mainWindow, captureWindow]) { secureWindow(win); win.setMenuBarVisibility(false); }
  for (const win of [mainWindow, captureWindow]) applyMaterial(win);
  nativeTheme.on('updated', () => { for (const win of [mainWindow, captureWindow]) if (!win.isDestroyed()) applyMaterial(win); broadcast(); });
  mainWindow.on('close', event => { if (!quitting && tray) { event.preventDefault(); mainWindow.hide(); } });
  captureWindow.on('close', event => { if (!quitting) { event.preventDefault(); captureWindow.hide(); } });
  registerIPC();
  await mainWindow.loadFile(path.join(root, 'ui/index.html'));
  await captureWindow.loadFile(path.join(root, 'ui/index.html'), { query: { capture: '1' } });
  mainWindow.show();
  tray = new Tray(trayIcon()); tray.setToolTip('拾光提醒 · Ctrl+Shift+Space 快速记录');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开拾光提醒', click: showMain }, { label: '快速记录', click: capture }, { type: 'separator' }, { label: '退出（停止提醒）', click: () => { quitting = true; app.quit(); } }]));
  tray.on('double-click', showMain);
  shortcutOK = globalShortcut.register('CommandOrControl+Shift+Space', () => { if (captureWindow.isVisible() && captureWindow.isFocused()) captureWindow.hide(); else capture(); });
  if (!shortcutOK) startupWarning += ' 全局快捷键被其他程序占用，可使用托盘快速记录。';
  powerMonitor.on('resume', () => { checkDue(); void syncAll(); });
  resetPolling();
  setInterval(() => void checkDue(), 15000).unref();
  await checkDue();
  if (!smoke) void syncAll();
  broadcast();
}

function registerIPC() {
  const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
    if (![mainWindow?.webContents.id, captureWindow?.webContents.id].includes(event.sender.id) || event.senderFrame !== event.sender.mainFrame) throw new Error('未经授权的调用');
    try { return { ok: true, value: await fn(...args) }; }
    catch (error) { return { ok: false, error: error.name === 'ZodError' ? '输入格式无效，请检查日期、地址或必填项' : error.message || '操作失败' }; }
  });
  handle('snapshot', snapshot);
  handle('analyze', async text => {
    if (previews.size > 100) previews.delete(previews.keys().next().value);
    const analysis = await analyze(text, { manual: true, model: config.value.model });
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
    resetPolling(); broadcast(); return result;
  });
  handle('sync', async () => { await syncAll(); return syncStatus; });
  handle('capture', () => capture());
  handle('hide-capture', () => captureWindow.hide());
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
    if (!target.canceled) fs.writeFileSync(target.filePath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), tasks: store.tasks(), records: store.records(null) }, null, 2));
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
  const analysis = await analyze(message.text, { now: received, model: config.value.model });
  return store.ingest(message, analysis);
}
async function syncAll() {
  if (syncing) return;
  syncing = true;
  try {
    if (config.value.mail.enabled) {
      syncStatus.email = { state: 'syncing', message: '正在读取邮件…' }; broadcast();
      try {
        const mail = config.value.mail;
        const key = `imap:${identity(`${mail.host}:${mail.port}:${mail.user}:${mail.mailbox}`)}`;
        const result = await pollMail(mail, store.state(key, {}), consume);
        store.setState(key, result);
        syncStatus.email = { state: 'ok', message: `已处理 ${result.count} 封邮件${result.remaining ? `，剩余 ${result.remaining} 封下轮继续` : ''}`, at: new Date().toISOString() };
      } catch { syncStatus.email = { state: 'error', message: '邮件同步失败，请检查服务器、TLS、账号和授权码；已处理记录会去重重试。', at: new Date().toISOString() }; }
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
      sendNotification(`${task.priority === 'high' ? '重要 · ' : ''}${task.title}`, '提醒时间已到，点击打开拾光提醒。', true, task.id, task.revision);
    }
  } catch { notificationWarning = '检查提醒时出现错误，请检查本地数据和磁盘空间。'; broadcast(); }
  finally { notificationBusy = false; }
}
app.on('activate', showMain);
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('before-quit', () => { quitting = true; globalShortcut.unregisterAll(); if (timer) clearInterval(timer); });
app.on('will-quit', () => { store?.close(); });
