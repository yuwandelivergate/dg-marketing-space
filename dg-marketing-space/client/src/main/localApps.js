// Discovers installed desktop software and launches it.
//   Windows: Start Menu shortcuts (.lnk) for all users + current user
//   macOS:   *.app bundles in /Applications, /System/Applications, ~/Applications
//   Linux:   freedesktop .desktop entries (system, user, Flatpak, Snap)
// The renderer only ever passes an app *id*; paths are resolved here from the last scan
// or the user's pinned list, so the UI can't be used to run arbitrary commands.
const { app, shell } = require('electron');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const store = require('./store');

const SKIP = /(uninstall|uninst|readme|release notes|license|documentation|manual|website|repair|help)/i;
const idFor = (p) => crypto.createHash('sha1').update(p).digest('hex').slice(0, 16);

let lastScan = new Map();
const iconCache = new Map();

async function walk(dir, depth, match, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (match(entry)) out.push(full);
    else if (entry.isDirectory() && depth > 0) await walk(full, depth - 1, match, out);
  }
  return out;
}

async function scanWindows() {
  const roots = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  ];
  const files = [];
  for (const root of roots) await walk(root, 3, (e) => e.isFile() && e.name.toLowerCase().endsWith('.lnk'), files);

  const apps = [];
  for (const file of files) {
    const name = path.basename(file, path.extname(file));
    if (SKIP.test(name)) continue;
    let target = '';
    try { target = shell.readShortcutLink(file).target || ''; } catch { /* advertised MSI shortcut */ }
    if (target && !/\.exe$/i.test(target)) continue; // skip links to documents & web pages
    apps.push({ id: idFor(file), name, launchPath: file, targetPath: target, iconPath: target || file, source: 'Start menu' });
  }
  return apps;
}

async function scanMac() {
  const roots = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')];
  const bundles = [];
  for (const root of roots) await walk(root, 2, (e) => e.isDirectory() && e.name.endsWith('.app'), bundles);
  return bundles
    .map((p) => ({ id: idFor(p), name: path.basename(p, '.app'), launchPath: p, targetPath: p, iconPath: p, source: 'Applications' }))
    .filter((a) => !SKIP.test(a.name));
}

async function scanLinux() {
  const roots = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    path.join(os.homedir(), '.local/share/applications'),
    '/var/lib/flatpak/exports/share/applications',
    '/var/lib/snapd/desktop/applications'
  ];
  const files = [];
  for (const root of roots) await walk(root, 1, (e) => e.isFile() && e.name.endsWith('.desktop'), files);

  const apps = [];
  for (const file of files) {
    let text;
    try { text = await fsp.readFile(file, 'utf8'); } catch { continue; }
    const section = text.split(/^\[/m).find((s) => s.startsWith('Desktop Entry]'));
    if (!section) continue;
    const field = (key) => (section.match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1];
    if (field('NoDisplay') === 'true' || field('Hidden') === 'true') continue;
    if ((field('Type') || 'Application') !== 'Application') continue;
    const name = field('Name');
    const exec = field('Exec');
    if (!name || !exec || SKIP.test(name)) continue;
    apps.push({
      id: idFor(file), name, launchPath: file,
      exec: exec.replace(/%[fFuUdDnNickvm]/g, '').trim(),
      targetPath: exec.split(/\s+/)[0], iconPath: null, source: 'Applications'
    });
  }
  return apps;
}

async function scan() {
  const found = process.platform === 'win32' ? await scanWindows()
    : process.platform === 'darwin' ? await scanMac()
    : await scanLinux();

  const byName = new Map();
  for (const a of found) {
    const key = a.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, a);
  }
  const apps = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  lastScan = new Map(apps.map((a) => [a.id, a]));
  getPinned().forEach((p) => { if (!lastScan.has(p.id)) lastScan.set(p.id, p); });
  return apps.map(({ exec, ...pub }) => pub);
}

const getPinned = () => store.get('pinnedApps', []) || [];
const find = (id) => getPinned().find((a) => a.id === id) || lastScan.get(id);

function pin(id) {
  const entry = lastScan.get(id);
  if (!entry) throw new Error('That app is no longer available. Rescan and try again.');
  const list = getPinned();
  if (!list.some((a) => a.id === id)) {
    list.push(entry);
    store.set('pinnedApps', list);
  }
  return getPinned();
}

function unpin(id) {
  store.set('pinnedApps', getPinned().filter((a) => a.id !== id));
  return getPinned();
}

function addCustom(filePath) {
  const name = path.basename(filePath).replace(/\.(exe|lnk|app|desktop|appimage)$/i, '');
  const entry = { id: idFor(filePath), name, launchPath: filePath, targetPath: filePath, iconPath: filePath, source: 'Added manually' };
  lastScan.set(entry.id, entry);
  return pin(entry.id);
}

function spawnDetached(cmd, args, opts = {}) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts });
  child.unref();
  return child;
}

async function launch(id) {
  const entry = find(id);
  if (!entry) throw new Error('Unknown application.');

  if (process.platform === 'linux') {
    if (entry.launchPath.endsWith('.desktop')) {
      const child = spawnDetached('gtk-launch', [path.basename(entry.launchPath, '.desktop')]);
      child.on('error', () => { if (entry.exec) spawnDetached(entry.exec, [], { shell: true }); });
      return true;
    }
    spawnDetached(entry.launchPath, []); // AppImage / binary picked by the user
    return true;
  }

  const error = await shell.openPath(entry.launchPath);
  if (error) throw new Error(error);
  return true;
}

async function icon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  const entry = find(id);
  if (!entry || !entry.iconPath || process.platform === 'linux') return null;
  try {
    const img = await app.getFileIcon(entry.iconPath, { size: 'large' });
    const url = img.isEmpty() ? null : img.toDataURL();
    iconCache.set(id, url);
    return url;
  } catch {
    return null;
  }
}

module.exports = { scan, getPinned, pin, unpin, addCustom, launch, icon };
