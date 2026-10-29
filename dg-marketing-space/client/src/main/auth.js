// Desktop sign-in. Credentials are always verified by the admin API; the desktop
// app never contains the admin password. Offline mode (for trying the shell before
// the backend is deployed) accepts only the test account.
const config = require('./config');
const store = require('./store');

const OFFLINE_ACCOUNTS = {
  test1: {
    password: 'test1',
    user: { id: 'offline-test1', username: 'test1', display_name: 'Test User (offline)', role: 'employee' }
  }
};

let current = null;

function tokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function login(rawUsername, password) {
  const username = String(rawUsername || '').trim().toLowerCase();
  if (!username || !password) throw new Error('Enter your username and password.');

  if (config.offlineMode) {
    const account = OFFLINE_ACCOUNTS[username];
    if (!account || account.password !== password) {
      throw new Error('Offline test mode only accepts the test1 account.');
    }
    current = { token: 'offline', user: account.user, offline: true };
    return current;
  }

  let res;
  try {
    res = await fetch(`${config.apiBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, client: 'desktop' }),
      signal: AbortSignal.timeout(15000)
    });
  } catch {
    throw new Error(`Can't reach the DG server at ${config.apiBase}. Check your internet connection.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Sign-in failed (HTTP ${res.status}).`);

  current = { token: data.token, user: data.user };
  store.setSecret('session', JSON.stringify(current));
  return current;
}

function restore() {
  if (config.offlineMode) return null;
  const raw = store.getSecret('session');
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw);
    const exp = tokenExpiry(saved.token);
    if (!exp || exp < Date.now() + 60_000) {
      store.setSecret('session', null);
      return null;
    }
    current = saved;
    return saved;
  } catch {
    return null;
  }
}

function logout() {
  current = null;
  store.setSecret('session', null);
}

const getSession = () => current;

module.exports = { login, restore, logout, getSession };
