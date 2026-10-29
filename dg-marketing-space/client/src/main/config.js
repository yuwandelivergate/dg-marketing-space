// Runtime configuration. Values come from (highest priority first):
//   1. environment variables / CLI flags (DG_API_BASE, DG_OFFLINE=1, --offline)
//   2. <install dir>/resources/config.json  (lets IT change the server without rebuilding)
//   3. client/config.json bundled with the app
//   4. the defaults below
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  apiBase: 'http://localhost:3000',
  defaultAppUrl: 'https://dms.delivergate.com/login',
  // Offline mode lets you try the shell without a backend: only the test1 account works
  // and telemetry is appended to <userData>/telemetry-offline.jsonl instead of being sent.
  offlineMode: false,
  telemetry: {
    sampleIntervalMs: 2000,
    flushIntervalMs: 30000,
    idleThresholdSec: 120,
    captureWindowTitles: false,
    maxQueuedReports: 500
  }
};

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(base[key] || {}, value)
      : value;
  }
  return out;
}

function readJson(file) {
  try {
    if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('[config] could not read', file, err.message);
  }
  return null;
}

function loadConfig() {
  const bundled = readJson(path.join(__dirname, '../../config.json')) || {};
  const override = process.resourcesPath ? readJson(path.join(process.resourcesPath, 'config.json')) || {} : {};
  const cfg = deepMerge(deepMerge(DEFAULTS, bundled), override);

  if (process.env.DG_API_BASE) cfg.apiBase = process.env.DG_API_BASE;
  if (process.env.DG_OFFLINE === '1' || process.argv.includes('--offline')) cfg.offlineMode = true;
  cfg.apiBase = String(cfg.apiBase).replace(/\/+$/, '');
  return cfg;
}

module.exports = loadConfig();
