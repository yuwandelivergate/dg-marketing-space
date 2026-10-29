import { db, check } from '../../server/db.js';
import { send, allow, handle } from '../../server/http.js';
import { requireUser, hashPassword } from '../../server/auth.js';
import { EMPLOYEE_FIELDS, withLiveStatus } from '../../server/metrics.js';

export default handle(async (req, res) => {
  if (!allow(req, res, ['GET', 'POST'])) return;
  const me = await requireUser(req, res, { role: 'admin' });
  if (!me) return;

  if (req.method === 'GET') {
    const users = check(await db().from('employees').select(EMPLOYEE_FIELDS).order('created_at'));
    return send(res, 200, { users: users.map(withLiveStatus) });
  }

  const { username, password, display_name, role = 'employee' } = req.body || {};
  const name = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) {
    return send(res, 400, { error: 'Usernames are 3–32 characters: letters, numbers, dots, dashes or underscores.' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return send(res, 400, { error: 'Passwords need at least 8 characters.' });
  }
  if (!['admin', 'employee'].includes(role)) return send(res, 400, { error: 'Role must be admin or employee.' });

  const { data, error } = await db()
    .from('employees')
    .insert({
      username: name,
      display_name: String(display_name || '').trim().slice(0, 80) || name,
      role,
      password_hash: await hashPassword(password)
    })
    .select(EMPLOYEE_FIELDS)
    .single();
  if (error?.code === '23505') return send(res, 409, { error: `The username “${name}” is already taken.` });
  if (error) throw error;
  return send(res, 201, { user: withLiveStatus(data) });
});
