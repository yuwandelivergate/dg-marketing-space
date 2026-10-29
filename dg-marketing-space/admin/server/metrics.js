export const EMPLOYEE_FIELDS =
  'id, username, display_name, role, active, created_at, last_login_at, last_seen_at, last_status, last_app, last_display_count';

const ONLINE_WINDOW_MS = 90_000; // desktop clients report every 30 s

export function withLiveStatus(e) {
  const seen = e.last_seen_at ? Date.parse(e.last_seen_at) : 0;
  const online = seen && Date.now() - seen < ONLINE_WINDOW_MS;
  return { ...e, live: online ? e.last_status || 'active' : 'offline' };
}

export function shapeMetrics(m = {}) {
  const n = (k) => Number(m[k] || 0);
  const active = n('active_seconds');
  const idle = n('idle_seconds');
  const workflow = n('workflow_seconds');
  const external = n('external_seconds');
  return {
    activeSeconds: active,
    idleSeconds: idle,
    lockedSeconds: n('locked_seconds'),
    clicks: n('clicks'),
    mouseMoves: n('mouse_moves'),
    mouseActiveSeconds: n('mouse_active_seconds'),
    maxDisplays: n('max_displays'),
    multiMonitorSeconds: n('multi_monitor_seconds'),
    workflowSeconds: workflow,
    externalSeconds: external,
    activeRatio: active + idle ? active / (active + idle) : null,
    workflowFocus: workflow + external ? workflow / (workflow + external) : null,
    reports: n('reports')
  };
}

export const shapeBucket = (b) => ({
  bucket: b.bucket,
  activeSeconds: Number(b.active_seconds || 0),
  idleSeconds: Number(b.idle_seconds || 0),
  workflowSeconds: Number(b.workflow_seconds || 0),
  externalSeconds: Number(b.external_seconds || 0)
});

// from/to are ISO instants computed in the admin's browser; tz is their IANA zone for charts.
export function parseRange(q) {
  const now = new Date();
  let to = q.to ? new Date(q.to) : now;
  if (Number.isNaN(to.getTime())) to = now;
  let from = q.from ? new Date(q.from) : new Date(to.getTime() - 86_400_000);
  if (Number.isNaN(from.getTime())) from = new Date(to.getTime() - 86_400_000);
  if (from > to) [from, to] = [to, from];
  if (to - from > 31 * 86_400_000) from = new Date(to.getTime() - 31 * 86_400_000);

  let tz = typeof q.tz === 'string' ? q.tz : 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'UTC'; }
  const bucket = to - from > 2 * 86_400_000 ? 'day' : 'hour';
  return { from: from.toISOString(), to: to.toISOString(), tz, bucket };
}
