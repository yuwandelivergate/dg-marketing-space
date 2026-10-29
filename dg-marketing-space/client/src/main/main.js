// DG Marketing Space – Electron main process.
const { app, BrowserWindow, ipcMain, screen, dialog, session } = require('electron');
const path = require('path');
const config = require('./config');
const auth = require('./auth');
const store = require('./store');
const telemetry = require('./telemetry');
const localApps = require('./localApps');

const isDev = process.argv.includes('--dev');
const PARTITION_PREFIX = 'persist:dg-';
const ALLOWED_PERMISSIONS = new Set(['notifications', 'media', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock']);

let mainWindow = null;
let quitting = false;
const configuredSessions = new Set();

// Google and Discord refuse sign-in from user agents that advertise Electron.
app.userAgentFallback = app.userAgentFallback.replace(/\s(Electron|dg-marketing-space)\/\S+/gi, '');
app.setAppUserModelId('com.delivergate.dgmarketingspace');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  mainWindow = new BrowserWindow({
    width: Math.min(1600, workArea.width),
    height: Math.min(1000, workArea.height),
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    show: false,
    backgroundColor: '#04123a',
    title: 'DG Marketing Space',
    icon: path.join(__dirname, '../../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      spellcheck: true
    }
  });

  mainWindow.once('ready-to-show', () => { mainWindow.maximize(); mainWindow.show(); });
  mainWindow.on('maximize', () => send('window:state', 'maximized'));
  mainWindow.on('unmaximize', () => send('window:state', 'normal'));
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault()); // the shell never navigates
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function configureSession(partition) {
  if (configuredSessions.has(partition)) return;
  configuredSessions.add(partition);
  const ses = session.fromPartition(partition);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED_PERMISSIONS.has(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

// Lock down every <webview> the shell creates and route their pop-ups.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    const partitionOk = typeof params.partition === 'string' && params.partition.startsWith(PARTITION_PREFIX);
    if (!/^https:\/\//i.test(params.src || '') || !partitionOk) {
      event.preventDefault();
      return;
    }
    configureSession(params.partition);
  });

  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url, disposition }) => {
      // window.open() pop-ups (OAuth, Google file pickers) need a real window with window.opener.
      if (disposition === 'new-window') {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520, height: 720, autoHideMenuBar: true, parent: mainWindow || undefined,
            webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
          }
        };
      }
      // Ordinary "open in new tab" links become a new window inside the workspace.
      if (/^https?:\/\//i.test(url)) send('shell:open-url', url);
      return { action: 'deny' };
    });
  }

  contents.on('input-event', (_e, input) => {
    if (input.type === 'mouseDown') telemetry.recordShellClick();
  });
});

function registerIpc() {
  // window chrome
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  });
  ipcMain.handle('window:close', () => mainWindow?.close());

  // config & settings
  ipcMain.handle('config:get', () => ({
    defaultAppUrl: config.defaultAppUrl,
    offlineMode: config.offlineMode,
    apiBase: config.apiBase,
    platform: process.platform,
    version: app.getVersion()
  }));
  ipcMain.handle('settings:get', (_e, key) => (/^[a-zA-Z]+$/.test(key) ? store.get(`settings.${key}`, null) : null));
  ipcMain.handle('settings:set', (_e, key, value) => {
    if (!/^[a-zA-Z]+$/.test(key)) return false;
    store.set(`settings.${key}`, value);
    return true;
  });

  // auth
  ipcMain.handle('auth:login', async (_e, creds) => {
    try {
      const s = await auth.login(creds?.username, creds?.password);
      await telemetry.start();
      return { ok: true, user: s.user, offline: !!s.offline };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('auth:restore', async () => {
    const s = auth.restore();
    if (!s) return null;
    await telemetry.start();
    return { user: s.user };
  });
  ipcMain.handle('auth:logout', async () => {
    await telemetry.stop();
    auth.logout();
    return true;
  });

  // local apps
  ipcMain.handle('apps:scan', () => localApps.scan());
  ipcMain.handle('apps:pinned', () => localApps.getPinned());
  ipcMain.handle('apps:pin', (_e, id) => {
    const list = localApps.pin(String(id));
    telemetry.setWorkflowApps(list);
    return list;
  });
  ipcMain.handle('apps:unpin', (_e, id) => {
    const list = localApps.unpin(String(id));
    telemetry.setWorkflowApps(list);
    return list;
  });
  ipcMain.handle('apps:launch', async (_e, id) => {
    try { await localApps.launch(String(id)); return { ok: true }; } catch (err) { return { ok: false, error: err.message }; }
  });
  ipcMain.handle('apps:icon', (_e, id) => localApps.icon(String(id)));
  ipcMain.handle('apps:browse', async () => {
    const filters = {
      win32: [{ name: 'Programs', extensions: ['exe', 'lnk'] }],
      darwin: [{ name: 'Applications', extensions: ['app'] }]
    }[process.platform];
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Add a program to your workspace',
      properties: ['openFile'],
      defaultPath: process.platform === 'darwin' ? '/Applications' : undefined,
      filters
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const list = localApps.addCustom(result.filePaths[0]);
    telemetry.setWorkflowApps(list);
    return list;
  });

  // telemetry
  ipcMain.on('telemetry:focus', (_e, info) => telemetry.setShellFocus(info));
  ipcMain.on('telemetry:visit', (_e, url) => telemetry.recordVisit(url));
  ipcMain.handle('telemetry:status', () => telemetry.getStatus());
  telemetry.onChange((s) => send('telemetry:status', s));
  telemetry.onAuthExpired(() => send('auth:expired'));
}

app.whenReady().then(() => {
  registerIpc();
  telemetry.init();
  telemetry.setWorkflowApps(localApps.getPinned());
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => app.quit());

// Send the last telemetry report before exiting (max 4 s).
app.on('before-quit', (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  Promise.race([telemetry.shutdown(), new Promise((r) => setTimeout(r, 4000))])
    .finally(() => app.quit());
});
