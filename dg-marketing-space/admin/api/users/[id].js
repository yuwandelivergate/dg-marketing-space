import { db } from '../../server/db.js';
import { send, allow, handle, isUuid } from '../../server/http.js';
import { requireUser, hashPassword } from '../../server/auth.js';
import { EMPLOYEE_FIELDS, withLiveStatus } from '../../server/metrics.js';

export default handle(async (req, res) => {
  if (!allow(req, res, ['PATCH', 'DELETE'])) return;
  const me = await requireUser(req, res, { role: 'admin' });
  if (!me) return;

  const { id } = req.query;
  if (!isUuid(id)) return send(res, 400, { error: 'Unknown employee.' });
  const self = id === me.id;

  if (req.method === 'DELETE') {
    if (self) return send(res, 400, { error: 'You can’t delete your own account.' });
    const { error } = await db().from('employees').delete().eq('id', id);
    if (error) throw error;
    return send(res, 200, { deleted: true });
  }

  const { password, display_name, role, active } = req.body || {};
  const patch = {};
  if (password !== undefined) {
    if (typeof password !== 'string' || password.length < 8) return send(res, 400, { error: 'Passwords need at least 8 characters.' });
    patch.password_hash = await hashPassword(password);
  }
  if (display_name !== undefined) patch.display_name = String(display_name).trim().slice(0, 80);
  if (role !== undefined) {
    if (!['admin', 'employee'].includes(role)) return send(res, 400, { error: 'Role must be admin or employee.' });
    if (self && role !== 'admin') return send(res, 400, { error: 'You can’t remove your own admin access.' });
    patch.role = role;
  }
  if (active !== undefined) {
    if (self && !active) return send(res, 400, { error: 'You can’t turn off your own account.' });
    patch.active = Boolean(active);
  }
  if (!Object.keys(patch).length) return send(res, 400, { error: 'Nothing to change.' });

  const { data, error } = await db().from('employees').update(patch).eq('id', id).select(EMPLOYEE_FIELDS).maybeSingle();
  if (error) throw error;
  if (!data) return send(res, 404, { error: 'That employee no longer exists.' });
  return send(res, 200, { user: withLiveStatus(data) });
});
