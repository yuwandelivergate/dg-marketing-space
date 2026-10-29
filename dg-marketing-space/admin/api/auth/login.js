import { db } from '../../server/db.js';
import { send, allow, handle } from '../../server/http.js';
import { ensureBootstrapAccount, verifyPassword, signToken } from '../../server/auth.js';

export default handle(async (req, res) => {
  if (!allow(req, res, ['POST'])) return;
  const { username, password, client } = req.body || {};
  const name = String(username || '').trim().toLowerCase();
  if (!name || typeof password !== 'string' || !password) {
    return send(res, 400, { error: 'Enter your username and password.' });
  }

  await ensureBootstrapAccount(name);

  const { data: user, error } = await db()
    .from('employees')
    .select('id, username, display_name, role, active, password_hash')
    .eq('username', name)
    .maybeSingle();
  if (error) throw error;

  const ok = user && (await verifyPassword(password, user.password_hash));
  if (!ok) return send(res, 401, { error: 'That username and password don’t match an account.' });
  if (!user.active) return send(res, 403, { error: 'This account is turned off. Ask your admin to turn it back on.' });
  if (client === 'admin' && user.role !== 'admin') {
    return send(res, 403, { error: 'This dashboard needs an administrator account.' });
  }

  await db().from('employees').update({ last_login_at: new Date().toISOString() }).eq('id', user.id);
  const token = await signToken(user);
  return send(res, 200, {
    token,
    user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role }
  });
});
