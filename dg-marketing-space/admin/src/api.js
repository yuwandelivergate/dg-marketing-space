const KEY = 'dg_admin_session';

export const session = {
  get() { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } },
  set(s) { sessionStorage.setItem(KEY, JSON.stringify(s)); },
  clear() { sessionStorage.removeItem(KEY); }
};

export async function api(path, { method = 'GET', body } = {}) {
  const s = session.get();
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(s?.token ? { Authorization: `Bearer ${s.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch {
    throw new Error('Can’t reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/auth/login') {
    session.clear();
    window.dispatchEvent(new Event('dg:logout'));
  }
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status}).`);
  return data;
}

// ---------- ranges ----------
export const RANGES = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' }
];

export function rangeQuery(key) {
  const to = new Date();
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  if (key === '7d') from.setDate(from.getDate() - 6);
  if (key === '30d') from.setDate(from.getDate() - 29);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), tz }).toString();
}

// ---------- formatting ----------
export function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export const fmtPct = (r) => (r == null ? '—' : `${Math.round(r * 100)}%`);
export const fmtNum = (n) => new Intl.NumberFormat().format(Math.round(n || 0));

export function fmtAgo(iso) {
  if (!iso) return 'Never';
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// Buckets come back as local "YYYY-MM-DDTHH:MM:SS" strings (already in the admin's zone).
export function bucketLabel(bucket, kind) {
  const [date, time = '00:00'] = String(bucket).split(/[T ]/);
  if (kind === 'hour') return time.slice(0, 5);
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}
