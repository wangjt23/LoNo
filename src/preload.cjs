const { contextBridge, ipcRenderer } = require('electron');
const channels = new Set(['snapshot', 'analyze', 'save-capture', 'update-task', 'save-settings', 'sync', 'capture', 'hide-capture', 'capture-layout', 'retry-shortcuts', 'test-notification', 'test-exchange', 'export', 'import', 'save-memory', 'delete-memory', 'extract-memories', 'memory-source', 'resume-mail', 'connect-exchange', 'test-model']);
if (process.argv.includes('--smoke')) channels.add('smoke');
contextBridge.exposeInMainWorld('reminder', {
  invoke: async (name, value) => {
    if (!channels.has(name)) throw new Error('Unsupported operation');
    const result = await ipcRenderer.invoke(name, value);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  },
  onChange: callback => { ipcRenderer.on('changed', () => callback()); },
  onCapture: callback => { ipcRenderer.on('capture-focus', () => callback()); },
});
