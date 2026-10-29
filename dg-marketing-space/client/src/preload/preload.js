// The only bridge between the shell UI and Node/Electron. Everything is explicit.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const on = (channel, cb) => {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('dg', {
  window: {
    minimize: () => invoke('window:minimize'),
    toggleMaximize: () => invoke('window:toggle-maximize'),
    close: () => invoke('window:close'),
    onState: (cb) => on('window:state', cb)
  },
  config: () => invoke('config:get'),
  settings: {
    get: (key) => invoke('settings:get', key),
    set: (key, value) => invoke('settings:set', key, value)
  },
  auth: {
    login: (username, password) => invoke('auth:login', { username, password }),
    restore: () => invoke('auth:restore'),
    logout: () => invoke('auth:logout'),
    onExpired: (cb) => on('auth:expired', cb)
  },
  apps: {
    scan: () => invoke('apps:scan'),
    pinned: () => invoke('apps:pinned'),
    pin: (id) => invoke('apps:pin', id),
    unpin: (id) => invoke('apps:unpin', id),
    launch: (id) => invoke('apps:launch', id),
    icon: (id) => invoke('apps:icon', id),
    browse: () => invoke('apps:browse')
  },
  telemetry: {
    focus: (info) => ipcRenderer.send('telemetry:focus', info),
    visit: (url) => ipcRenderer.send('telemetry:visit', url),
    status: () => invoke('telemetry:status'),
    onStatus: (cb) => on('telemetry:status', cb)
  },
  onOpenUrl: (cb) => on('shell:open-url', cb)
});
