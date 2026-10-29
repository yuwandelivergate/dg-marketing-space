// Productivity telemetry.
//
// Every `sampleIntervalMs` we take one sample:
//   • status: active / idle (no input for idleThresholdSec) / locked
//   • foreground app: the in-shell app when DG Marketing Space is focused, otherwise the
//     OS foreground window via `get-windows` (optional native dependency)
//   • the display that app is on, and whether it counts as "workflow" (the DG shell or a
//     desktop app the user pinned to the workspace) or "external"
//   • cursor movement (polled — no global mouse hook needed)
// Clicks are counted with `uiohook-napi` (optional). Keystrokes are never captured.
// Samples are aggregated into one report per `flushIntervalMs` and sent to the admin API.
// Reports that fail to send are queued on disk (per user) and retried.
const { app, powerMonitor, screen, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const store = require('./store');
const auth = require('./auth');

const T = config.telemetry;

let running = false;
let sampleTimer = null;
let flushTimer = null;
let bucket = null;
let lastSampleAt = 0;
let lastCursor = null;
let sampling = false;
let status = 'active';
let locked = false;
let shellFocus = null;
let currentApp = null;
let workflowMatchers = [];

let getActiveWindow = null;
let clickHook = null;
let nativeReady = false;

const changeListeners = new Set();
const expiredListeners = new Set();

// ---------- helpers ----------
const normalizeName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const round = (n) => Math.round(n);

function cleanUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return (u.origin + u.pathname).slice(0, 300); // query strings & fragments may hold tokens
  } catch {
    return null;
  }
}

function displayLabel(display, all) {
  const index = all.findIndex((d) => d.id === display.id);
  const isPrimary = screen.getPrimaryDisplay().id === display.id;
  const name = isPrimary ? 'Primary' : `Display ${index + 1}`;
  const label = display.label ? ` · ${display.label}` : '';
  return `${name} (${display.size.width}×${display.size.height})${label}`.slice(0, 80);
}

function newBucket() {
  return {
    periodStart: new Date().toISOString(),
    activeSeconds: 0,
    idleSeconds: 0,
    lockedSeconds: 0,
    clicks: 0,
    mouseMoves: 0,
    mouseActiveSeconds: 0,
    mouseDistancePx: 0,
    displayCount: screen.getAllDisplays().length,
    multiMonitorSeconds: 0,
    workflowSeconds: 0,
    externalSeconds: 0,
    apps: new Map(),
    urls: new Map(),
    displays: new Map(),
    events: []
  };
}

function pushEvent(type, detail) {
  if (bucket) bucket.events.push({ at: new Date().toISOString(), type, detail: detail ? String(detail).slice(0, 80) : undefined });
}

function emitChange() {
  const s = getStatus();
  changeListeners.forEach((fn) => fn(s));
}

function isWorkflowApp(owner) {
  if (!owner) return false;
  const name = normalizeName(owner.name);
  const exe = String(owner.path || '').toLowerCase();
  return workflowMatchers.some((m) => {
    if (m.path && exe) {
      if (exe === m.path) return true;
      if (m.path.endsWith('.app') && exe.startsWith(m.path + '/')) return true; // macOS bundles
    }
    return m.name.length >= 3 && name.length >= 3 && (name.includes(m.name) || m.name.includes(name));
  });
}

// ---------- native helpers (optional) ----------
async function initNative() {
  if (nativeReady) return;
  nativeReady = true;
  try {
    ({ activeWindow: getActiveWindow } = await import('get-windows'));
  } catch (err) {
    console.warn('[telemetry] get-windows unavailable; app tracking limited to the workspace:', err.message);
  }
  try {
    const { uIOhook } = require('uiohook-napi');
    uIOhook.on('mousedown', () => { if (bucket) bucket.clicks++; });
    uIOhook.start();
    clickHook = uIOhook;
  } catch (err) {
    console.warn('[telemetry] uiohook-napi unavailable; clicks counted inside the workspace only:', err.message);
  }
}

// ---------- sampling ----------
async function sample() {
  if (!running || sampling || !bucket) return;
  sampling = true;
  try {
    const now = Date.now();
    const dt = Math.min((now - lastSampleAt) / 1000, 10); // cap gaps (sleep, debugger)
    lastSampleAt = now;
    const b = bucket;

    const displays = screen.getAllDisplays();
    if (displays.length > b.displayCount) b.displayCount = displays.length;
    if (displays.length > 1) b.multiMonitorSeconds += dt;

    const cursor = screen.getCursorScreenPoint();
    if (lastCursor && (cursor.x !== lastCursor.x || cursor.y !== lastCursor.y)) {
      b.mouseMoves++;
      b.mouseActiveSeconds += dt;
      b.mouseDistancePx += Math.hypot(cursor.x - lastCursor.x, cursor.y - lastCursor.y);
    }
    lastCursor = cursor;

    const next = locked ? 'locked'
      : powerMonitor.getSystemIdleTime() >= T.idleThresholdSec ? 'idle' : 'active';
    if (next !== status) {
      status = next;
      pushEvent(`status:${next}`);
      emitChange();
    }
    if (status === 'locked') { b.lockedSeconds += dt; return; }
    if (status === 'idle') { b.idleSeconds += dt; return; }
    b.activeSeconds += dt;

    // Which app is in front?
    let appName = 'Unknown';
    let title = '';
    let url = null;
    let bounds = null;
    let workflow = false;
    const ownWindow = BrowserWindow.getFocusedWindow();
    if (ownWindow) {
      appName = shellFocus?.appName ? `DG Workspace › ${shellFocus.appName}` : 'DG Workspace';
      url = shellFocus?.url || null;
      bounds = ownWindow.getBounds();
      workflow = true;
    } else if (getActiveWindow) {
      const w = await getActiveWindow().catch(() => null);
      if (w) {
        appName = String(w.owner?.name || 'Unknown').slice(0, 120);
        title = T.captureWindowTitles ? String(w.title || '').slice(0, 120) : '';
        url = w.url || null; // provided for major browsers on macOS
        bounds = w.bounds;
        workflow = isWorkflowApp(w.owner);
      }
    }

    const display = bounds ? screen.getDisplayMatching(bounds) : screen.getDisplayNearestPoint(cursor);
    const dKey = displayLabel(display, displays);

    const appEntry = b.apps.get(appName) || { name: appName, seconds: 0, workflow, displays: {}, title: '' };
    appEntry.seconds += dt;
    appEntry.displays[dKey] = (appEntry.displays[dKey] || 0) + dt;
    if (title) appEntry.title = title;
    b.apps.set(appName, appEntry);

    const dEntry = b.displays.get(dKey) || { display: dKey, seconds: 0, workflowSeconds: 0, externalSeconds: 0 };
    dEntry.seconds += dt;
    if (workflow) dEntry.workflowSeconds += dt; else dEntry.externalSeconds += dt;
    b.displays.set(dKey, dEntry);

    if (workflow) b.workflowSeconds += dt; else b.externalSeconds += dt;

    const clean = url && cleanUrl(url);
    if (clean) {
      const u = b.urls.get(clean) || { url: clean, seconds: 0, visits: 0 };
      u.seconds += dt;
      b.urls.set(clean, u);
    }

    const changed = currentApp?.name !== appName || currentApp?.display !== dKey;
    currentApp = { name: appName, display: dKey, workflow };
    if (changed) emitChange();
  } catch (err) {
    console.warn('[telemetry] sample failed:', err.message);
  } finally {
    sampling = false;
  }
}

// ---------- reporting ----------
function serialize(b) {
  const roundMap = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, round(v)]));
  return {
    periodStart: b.periodStart,
    periodEnd: new Date().toISOString(),
    activeSeconds: round(b.activeSeconds),
    idleSeconds: round(b.idleSeconds),
    lockedSeconds: round(b.lockedSeconds),
    clicks: b.clicks,
    mouseMoves: b.mouseMoves,
    mouseActiveSeconds: round(b.mouseActiveSeconds),
    mouseDistancePx: round(b.mouseDistancePx),
    displayCount: b.displayCount,
    multiMonitorSeconds: round(b.multiMonitorSeconds),
    workflowSeconds: round(b.workflowSeconds),
    externalSeconds: round(b.externalSeconds),
    apps: [...b.apps.values()]
      .sort((x, y) => y.seconds - x.seconds)
      .slice(0, 40)
      .map((a) => ({ name: a.name, seconds: round(a.seconds), workflow: a.workflow, title: a.title || undefined, displays: roundMap(a.displays) })),
    urls: [...b.urls.values()]
      .sort((x, y) => y.seconds - x.seconds || y.visits - x.visits)
      .slice(0, 50)
      .map((u) => ({ url: u.url, seconds: round(u.seconds), visits: u.visits })),
    displays: [...b.displays.values()].map((d) => ({
      display: d.display, seconds: round(d.seconds), workflowSeconds: round(d.workflowSeconds), externalSeconds: round(d.externalSeconds)
    })),
    events: b.events.slice(-50),
    status,
    currentApp: currentApp?.name || null,
    client: {
      platform: process.platform,
      hostname: os.hostname(),
      appVersion: app.getVersion(),
      clickTracking: clickHook ? 'system-wide' : 'workspace-only',
      appTracking: getActiveWindow ? 'system-wide' : 'workspace-only'
    }
  };
}

const queueKey = (session) => `telemetryQueue:${session.user.id}`;

async function sendQueue(session, queue) {
  if (session.offline) {
    const file = path.join(app.getPath('userData'), 'telemetry-offline.jsonl');
    fs.appendFileSync(file, queue.map((r) => JSON.stringify(r)).join('\n') + '\n');
    store.set(queueKey(session), null);
    return;
  }
  let remaining = queue;
  while (remaining.length) {
    const batch = remaining.slice(0, 50);
    try {
      const res = await fetch(`${config.apiBase}/api/telemetry/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ reports: batch }),
        signal: AbortSignal.timeout(15000)
      });
      if (res.status === 401 || res.status === 403) {
        store.set(queueKey(session), remaining.slice(-T.maxQueuedReports));
        expiredListeners.forEach((fn) => fn());
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      remaining = remaining.slice(batch.length);
    } catch (err) {
      console.warn('[telemetry] send failed, will retry:', err.message);
      break;
    }
  }
  store.set(queueKey(session), remaining.length ? remaining.slice(-T.maxQueuedReports) : null);
}

async function flush() {
  const session = auth.getSession();
  if (!bucket || !session) return;
  const report = serialize(bucket);
  bucket = running ? newBucket() : null;
  const queue = store.get(queueKey(session), []) || [];
  queue.push(report);
  await sendQueue(session, queue);
}

// ---------- public API ----------
function init() {
  powerMonitor.on('lock-screen', () => { locked = true; pushEvent('lock'); });
  powerMonitor.on('unlock-screen', () => { locked = false; pushEvent('unlock'); });
  powerMonitor.on('suspend', () => { locked = true; pushEvent('suspend'); });
  powerMonitor.on('resume', () => { locked = false; lastSampleAt = Date.now(); pushEvent('resume'); });
  screen.on('display-added', () => { pushEvent('display:added', `${screen.getAllDisplays().length} displays`); emitChange(); });
  screen.on('display-removed', () => { pushEvent('display:removed', `${screen.getAllDisplays().length} displays`); emitChange(); });
}

async function start() {
  if (running) return;
  await initNative();
  running = true;
  status = 'active';
  bucket = newBucket();
  lastSampleAt = Date.now();
  lastCursor = null;
  pushEvent('session:start');
  sampleTimer = setInterval(sample, T.sampleIntervalMs);
  flushTimer = setInterval(() => flush().catch(() => {}), T.flushIntervalMs);
  emitChange();
}

async function stop() {
  if (!running) return;
  running = false;
  clearInterval(sampleTimer);
  clearInterval(flushTimer);
  pushEvent('session:end');
  await flush().catch(() => {});
  bucket = null;
  shellFocus = null;
  currentApp = null;
  emitChange();
}

async function shutdown() {
  await stop();
  try { clickHook?.stop(); } catch { /* ignore */ }
}

function setShellFocus(info) {
  if (!info || typeof info !== 'object') { shellFocus = null; return; }
  shellFocus = {
    appId: String(info.appId || '').slice(0, 60),
    appName: String(info.appName || '').slice(0, 80),
    url: typeof info.url === 'string' ? info.url : null
  };
}

function recordVisit(url) {
  const clean = bucket && cleanUrl(url);
  if (!clean) return;
  const u = bucket.urls.get(clean) || { url: clean, seconds: 0, visits: 0 };
  u.visits++;
  bucket.urls.set(clean, u);
}

// Fallback when the global hook isn't available: count clicks inside our own windows.
function recordShellClick() {
  if (!clickHook && bucket) bucket.clicks++;
}

function setWorkflowApps(pinned) {
  workflowMatchers = (pinned || []).map((p) => ({
    name: normalizeName(p.name),
    path: String(p.targetPath || p.launchPath || '').toLowerCase()
  }));
}

function getStatus() {
  return {
    monitoring: running,
    status: running ? status : 'off',
    displays: screen.getAllDisplays().length,
    currentApp: currentApp?.name || null,
    currentDisplay: currentApp?.display || null,
    clickTracking: clickHook ? 'system-wide' : 'workspace-only',
    appTracking: getActiveWindow ? 'system-wide' : 'workspace-only',
    idleThresholdSec: T.idleThresholdSec
  };
}

module.exports = {
  init, start, stop, shutdown, flush,
  setShellFocus, recordVisit, recordShellClick, setWorkflowApps, getStatus,
  onChange: (fn) => changeListeners.add(fn),
  onAuthExpired: (fn) => expiredListeners.add(fn)
};
