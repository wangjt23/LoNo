import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { brandIconSet } from './core/brand.js';
import { trayIcon } from './icon.js';
import { Notification } from 'electron';

// Stable installation identity, not a display name. Must match build.appId;
// changing it would split existing shortcuts and notification registrations.
export const WINDOWS_APP_ID = 'com.shiguang.reminder';
export const WINDOWS_TOAST_CLSID = '{04C012C4-7BE6-48E1-92C2-D73B85AE814F}';

// The window icon alone does not identify the app to Explorer. Keep the shell
// icon outside app.asar and associate the same AppID with the window and link.
export async function configureWindowsIdentity(win, { app, shell, isolated = false, executable = process.execPath, initializeNotifications = true }) {
  const bytes = brandIconSet();
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 12);
  const iconDir = path.join(app.getPath('userData'), 'icons');
  fs.mkdirSync(iconDir, { recursive: true });
  const icon = path.join(iconDir, `lono-${digest}.ico`);
  if (!fs.existsSync(icon) || !fs.readFileSync(icon).equals(bytes)) fs.writeFileSync(icon, bytes);
  const notificationIcon = path.join(iconDir, `lono-${digest}.png`);
  const png = trayIcon().toPNG();
  if (!fs.existsSync(notificationIcon) || !fs.readFileSync(notificationIcon).equals(png)) fs.writeFileSync(notificationIcon, png);
  if (!isolated) {
    // Per-user branding only. No machine policy, notification permission or
    // security setting is changed. Windows reads these assets for toast headers.
    const registry = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const key = `HKCU\\Software\\Classes\\AppUserModelId\\${WINDOWS_APP_ID}`;
    for (const [name, value] of [['DisplayName', 'LoNo'], ['IconUri', notificationIcon]]) {
      execFileSync(registry, ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'], { windowsHide: true, timeout: 5000, stdio: 'ignore' });
    }
  }
  let target = executable;
  if (!isolated && app.isPackaged && process.env.ProgramData) {
    const sharedLink = path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'LoNo.lnk');
    if (fs.existsSync(sharedLink)) {
      const installed = shell.readShortcutLink(sharedLink);
      if (installed.appUserModelId === WINDOWS_APP_ID && path.basename(installed.target).toLowerCase() === 'lono.exe' && fs.existsSync(installed.target)) target = installed.target;
    }
  }
  const args = app.isPackaged ? '' : `"${app.getAppPath()}"`;
  win.setAppDetails({ appId: WINDOWS_APP_ID, appIconPath: icon, appIconIndex: 0,
    relaunchCommand: `"${target}"${args ? ` ${args}` : ''}`, relaunchDisplayName: 'LoNo' });
  const linkDir = isolated ? path.join(app.getPath('userData'), 'shell') : path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  fs.mkdirSync(linkDir, { recursive: true });
  const shortcut = path.join(linkDir, 'LoNo.lnk');
  const details = { target, args, cwd: path.dirname(target), description: 'LoNo · Loop Notify', icon, iconIndex: 0, appUserModelId: WINDOWS_APP_ID, toastActivatorClsid: WINDOWS_TOAST_CLSID };
  // Do not take over an unrelated app's shortcut if it uses the same name.
  const owned = filename => {
    if (!fs.existsSync(filename)) return true;
    const old = shell.readShortcutLink(filename);
    return old.appUserModelId === WINDOWS_APP_ID || (path.basename(old.target).toLowerCase() === 'lono.exe' && /^(LoNo|Loop Notify)/.test(old.description));
  };
  if (!owned(shortcut)) throw new Error('开始菜单已有其他应用的 LoNo 快捷方式，已保留');
  if (!shell.writeShortcutLink(shortcut, fs.existsSync(shortcut) ? 'replace' : 'create', details)) throw new Error('无法更新 LoNo 开始菜单图标');
  if (!isolated) {
    // Electron 45 creates a link named from the EXE's product metadata when its
    // presenter initializes. Warm it without displaying a toast, then archive
    // only our own alias so Explorer cannot choose "Electron" over "LoNo".
    const alias = path.join(linkDir, 'Electron.lnk');
    const archiveAlias = () => {
      const backups = path.join(app.getPath('userData'), 'shell-backups');
      fs.mkdirSync(backups, { recursive: true });
      fs.renameSync(alias, path.join(backups, `Electron-${Date.now()}.lnk`));
    };
    if (fs.existsSync(alias) && shell.readShortcutLink(alias).appUserModelId === WINDOWS_APP_ID) archiveAlias();
    if (initializeNotifications) {
    const warmup = new Notification({ title: 'LoNo' });
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      if (fs.existsSync(alias)) {
        const old = shell.readShortcutLink(alias);
        if (old.appUserModelId === WINDOWS_APP_ID && old.toastActivatorClsid?.toUpperCase() === WINDOWS_TOAST_CLSID) {
          archiveAlias();
          break;
        }
      }
      const nativeLink = shell.readShortcutLink(shortcut);
      if (nativeLink.target.toLowerCase() === process.execPath.toLowerCase() && nativeLink.toastActivatorClsid?.toUpperCase() === WINDOWS_TOAST_CLSID) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    warmup.close();
    }
    // Presenter initialization may rewrite LoNo.lnk using the current EXE and
    // drop its icon. Restore the chosen installed target and explicit icon last.
    if (!shell.writeShortcutLink(shortcut, 'replace', details)) throw new Error('无法恢复 LoNo 开始菜单图标');
    const desktop = path.join(app.getPath('desktop'), 'LoNo.lnk');
    if (fs.existsSync(desktop) && owned(desktop) && !shell.writeShortcutLink(desktop, 'replace', details)) throw new Error('无法更新 LoNo 桌面图标');
  }
  return { icon, notificationIcon, shortcut };
}
