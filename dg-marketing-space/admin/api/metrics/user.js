// One employee's detailed report: timeline, apps (with display split), URLs, displays, events.
import { db, check } from '../../server/db.js';
import { send, allow, handle, isUuid } from '../../server/http.js';
import { requireUser } from '../../server/auth.js';
import { EMPLOYEE_FIELDS, withLiveStatus, shapeMetrics, shapeBucket, parseRange } from '../../server/metrics.js';

export default handle(async (req, res) => {
  if (!allow(req, res, ['GET'])) return;
  if (!(await requireUser(req, res, { role: 'admin' }))) return;
  const { id } = req.query;
  if (!isUuid(id)) return send(res, 400, { error: 'Unknown employee.' });
  const range = parseRange(req.query);
  const span = { p_employee: id, p_from: range.from, p_to: range.to };

  const [employee, sums, timeline, apps, urls, displays, events, lastClient] = await Promise.all([
    db().from('employees').select(EMPLOYEE_FIELDS).eq('id', id).maybeSingle(),
    db().rpc('dg_summary', { p_from: range.from, p_to: range.to }),
    db().rpc('dg_timeline', { p_from: range.from, p_to: range.to, p_tz: range.tz, p_bucket: range.bucket, p_employee: id }),
    db().rpc('dg_user_apps', span),
    db().rpc('dg_user_urls', { ...span, p_limit: 25 }),
    db().rpc('dg_user_displays', span),
    db().rpc('dg_user_events', { ...span, p_limit: 40 }),
    db().from('telemetry_reports').select('client, period_end').eq('employee_id', id)
      .order('period_start', { ascending: false }).limit(1).maybeSingle()
  ]);

  const emp = check(employee);
  if (!emp) return send(res, 404, { error: 'That employee no longer exists.' });

  // Fold app × display rows into one entry per app.
  const appMap = new Map();
  for (const row of check(apps)) {
    const a = appMap.get(row.name) || { name: row.name, workflow: false, seconds: 0, displays: {} };
    a.workflow = a.workflow || row.workflow;
    a.seconds += Number(row.seconds);
    a.displays[row.display] = (a.displays[row.display] || 0) + Number(row.seconds);
    appMap.set(row.name, a);
  }

  return send(res, 200, {
    range,
    user: withLiveStatus(emp),
    metrics: shapeMetrics(check(sums).find((s) => s.employee_id === id)),
    timeline: check(timeline).map(shapeBucket),
    apps: [...appMap.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 25),
    urls: check(urls).map((u) => ({ url: u.url, seconds: Number(u.seconds), visits: Number(u.visits) })),
    displays: check(displays).map((d) => ({
      display: d.display, seconds: Number(d.seconds),
      workflowSeconds: Number(d.workflow_seconds), externalSeconds: Number(d.external_seconds)
    })),
    events: check(events),
    client: check(lastClient)?.client || null
  });
});
