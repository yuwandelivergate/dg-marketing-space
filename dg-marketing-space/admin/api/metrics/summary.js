// Team overview: every employee with live status + aggregated metrics for the range.
import { db, check } from '../../server/db.js';
import { send, allow, handle } from '../../server/http.js';
import { requireUser } from '../../server/auth.js';
import { EMPLOYEE_FIELDS, withLiveStatus, shapeMetrics, shapeBucket, parseRange } from '../../server/metrics.js';

export default handle(async (req, res) => {
  if (!allow(req, res, ['GET'])) return;
  if (!(await requireUser(req, res, { role: 'admin' }))) return;
  const range = parseRange(req.query);

  const [employees, sums, timeline] = await Promise.all([
    db().from('employees').select(EMPLOYEE_FIELDS).order('display_name'),
    db().rpc('dg_summary', { p_from: range.from, p_to: range.to }),
    db().rpc('dg_timeline', { p_from: range.from, p_to: range.to, p_tz: range.tz, p_bucket: range.bucket, p_employee: null })
  ]);
  const byId = Object.fromEntries(check(sums).map((s) => [s.employee_id, s]));

  return send(res, 200, {
    range,
    users: check(employees).map((e) => ({ ...withLiveStatus(e), metrics: shapeMetrics(byId[e.id]) })),
    timeline: check(timeline).map(shapeBucket)
  });
});
