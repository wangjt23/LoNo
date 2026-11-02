export const captureKeys = [
  { accelerator: 'CommandOrControl+Shift+Space', label: 'Ctrl+Shift+Space' },
  { accelerator: 'CommandOrControl+Alt+Space', label: 'Ctrl+Alt+Space' },
];

export function registerCaptureKeys(globalShortcut, callback, platform = process.platform) {
  const keys = captureKeys.map(key => {
    if (globalShortcut.isRegistered(key.accelerator)) globalShortcut.unregister(key.accelerator);
    return { ...key, label: platform === 'darwin' ? key.label.replace('Ctrl', 'Command').replace('Alt', 'Option') : key.label, registered: globalShortcut.register(key.accelerator, callback) };
  });
  return { keys, active: keys.find(key => key.registered)?.label || null };
}
