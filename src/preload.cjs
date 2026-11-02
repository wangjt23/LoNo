const { contextBridge, ipcRenderer } = require('electron');
const channels = new Set(['snapshot', 'analyze', 'save-capture', 'update-task', 'save-settings', 'clear-secret', 'test-mail', 'mail-records', 'sync-mail', 'sync', 'capture', 'hide-capture', 'capture-layout', 'retry-shortcuts', 'test-notification', 'test-exchange', 'export', 'import', 'save-memory', 'delete-memory', 'extract-memories', 'memory-source', 'resume-mail', 'connect-exchange', 'test-model', 'review-task', 'apply-task-review']);
for (const channel of ['chat-history', 'chat-send', 'chat-resolve', 'chat-source']) channels.add(channel);
if (process.argv.includes('--smoke')) channels.add('smoke');
contextBridge.exposeInMainWorld('reminder', {
  platform: process.platform,
  invoke: async (name, value) => {
    if (!channels.has(name)) throw new Error('Unsupported operation');
    const result = await ipcRenderer.invoke(name, value);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  onChange: callback => { ipcRenderer.on('changed', () => callback()); },
  onCapture: callback => { ipcRenderer.on('capture-focus', () => callback()); },
  onCaptureReset: callback => { ipcRenderer.on('capture-reset', () => callback()); },
});
