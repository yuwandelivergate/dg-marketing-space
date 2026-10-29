// Tiny JSON key/value store in the user's profile folder (no extra dependency).
// Secrets (the session token) are encrypted with the OS keychain via safeStorage.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

let cache = null;
const file = () => path.join(app.getPath('userData'), 'dg-store.json');

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { cache = {}; }
  return cache;
}

function persist() {
  const target = file();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, target);
}

function get(key, fallback = null) {
  const value = load()[key];
  return value === undefined ? fallback : value;
}

function set(key, value) {
  load();
  if (value === null || value === undefined) delete cache[key];
  else cache[key] = value;
  persist();
}

function setSecret(key, value) {
  if (value == null) return set(key, null);
  if (safeStorage.isEncryptionAvailable()) {
    set(key, { enc: true, v: safeStorage.encryptString(value).toString('base64') });
  } else {
    set(key, { enc: false, v: value });
  }
}

function getSecret(key) {
  const record = get(key);
  if (!record) return null;
  try {
    return record.enc ? safeStorage.decryptString(Buffer.from(record.v, 'base64')) : record.v;
  } catch {
    return null;
  }
}

module.exports = { get, set, getSecret, setSecret };
