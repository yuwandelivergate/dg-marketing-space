// Receives batched activity reports from the desktop client.
import { db } from '../../server/db.js';
import { send, allow, handle } from '../../server/http.js';
import { requireUser } from '../../server/auth.js';

const num = (v, max = 86_400) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
};
const str = (v, max = 200) => (typeof v === 'string' && v ? v.slice(0, max) : null);
const iso = (v) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max).filter((x) => x && typeof x === 'object') : []);
const secondsMap = (obj) => Object.fromEntries(
  Object.entries(obj && typeof obj === 'object' ? obj : {}).slice(0, 8).map(([k, v]) => [String(k).slice(0, 80), num(v)])
);

function clean(r, employeeId) {
  const start = iso(r.periodStart);
  const end = iso(r.periodEnd);
  if (!start || !end) return null;
  const c = r.client && typeof r.client === 'object' ? r.client : {};
  return {
    employee_id: employeeId,
    period_start: start,
    period_end: end,
    active_seconds: num(r.activeSeconds),
    idle_seconds: num(r.idleSeconds),
    locked_seconds: num(r.lockedSeconds),
    clicks: num(r.clicks, 1_000_000),
    mouse_moves: num(r.mouseMoves, 1_000_000),
    mouse_active_seconds: num(r.mouseActiveSeconds),
    mouse_distance_px: num(r.mouseDistancePx, 1e10),
    display_count: Math.max(1, num(r.displayCount, 16)),
    multi_monitor_seconds: num(r.multiMonitorSeconds),
    workflow_seconds: num(r.workflowSeconds),
    external_seconds: num(r.externalSeconds),
    apps: list(r.apps, 40).map((a) => ({
      name: str(a.name, 120) || 'Unknown',
      seconds: num(a.seconds),
      workflow: Boolean(a.workflow),
      ...(str(a.title, 120) ? { title: str(a.title, 120) } : {}),
      displays: secondsMap(a.displays)
    })),
    urls: list(r.urls, 50)
      .map((u) => ({ url: str(u.url, 300), seconds: num(u.seconds), visits: num(u.visits, 100_000) }))
      .filter((u) => u.url && /^https?:\/\//.test(u.url)),
    displays: list(r.displays, 8).map((d) => ({
      display: str(d.display, 80) || 'Unknown',
      seconds: num(d.seconds),
      workflowSeconds: num(d.workflowSeconds),
      externalSeconds: num(d.externalSeconds)
    })),
    events: list(r.events, 50)
      .map((e) => ({ at: iso(e.at), type: str(e.type, 40), ...(str(e.detail, 80) ? { detail: str(e.detail, 80) } : {}) }))
      .filter((e) => e.at && e.type),
    client: {
      platform: str(c.platform, 20),
      hostname: str(c.hostname, 80),
      appVersion: str(c.appVersion, 20),
      clickTracking: str(c.clickTracking, 20),
      appTracking: str(c.appTracking, 20)
    }
  };
}

export default handle(async (req, res) => {
  if (!allow(req, res, ['POST'])) return;
  const me = await requireUser(req, res);
  if (!me) return;

  const body = req.body || {};
  const reports = Array.isArray(body.reports) ? body.reports.slice(0, 50) : [body];
  const rows = reports.map((r) => clean(r, me.id)).filter(Boolean);
  if (!rows.length) return send(res, 400, { error: 'No valid reports in the request.' });

  const latest = reports.reduce((a, b) => (String(b.periodEnd) > String(a.periodEnd) ? b : a));
  const status = ['active', 'idle', 'locked'].includes(latest.status) ? latest.status : 'active';

  // Updating the heartbeat first doubles as the "is this account still active?" check.
  const { data: alive, error: hbError } = await db()
    .from('employees')
    .update({
      last_seen_at: new Date().toISOString(),
      last_status: status,
      last_app: str(latest.currentApp, 120),
      last_display_count: Math.max(1, num(latest.displayCount, 16))
    })
    .eq('id', me.id)
    .eq('active', true)
    .select('id');
  if (hbError) throw hbError;
  if (!alive?.length) return send(res, 403, { error: 'This account is turned off.' });

  const { error } = await db().from('telemetry_reports').insert(rows);
  if (error) throw error;
  return send(res, 200, { accepted: rows.length });
});
