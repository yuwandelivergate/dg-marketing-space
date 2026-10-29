import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { send } from './http.js';

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set to at least 32 characters');
  return new TextEncoder().encode(s);
}

// Test accounts requested for the pilot. They're written to the database (bcrypt-hashed) the
// first time someone signs in with them, so they behave like normal accounts afterwards and
// their passwords can be changed from the admin panel. These live only in server code — they
// are never shipped to the browser or the desktop app.
// Set DISABLE_BOOTSTRAP_ACCOUNTS=true once real admin accounts exist.
const BOOTSTRAP_ACCOUNTS = [
  { username: 'adm_kavin', password: 'K@vi@2211', role: 'admin', display_name: 'Kavin' },
  { username: 'test1', password: 'test1', role: 'employee', display_name: 'Test User' }
];

export async function ensureBootstrapAccount(username) {
  if (process.env.DISABLE_BOOTSTRAP_ACCOUNTS === 'true') return;
  const account = BOOTSTRAP_ACCOUNTS.find((a) => a.username === username);
  if (!account) return;
  const { data } = await db().from('employees').select('id').eq('username', account.username).maybeSingle();
  if (data) return;
  const { error } = await db().from('employees').insert({
    username: account.username,
    display_name: account.display_name,
    role: account.role,
    password_hash: await bcrypt.hash(account.password, 10)
  });
  if (error && error.code !== '23505') throw error; // ignore a concurrent insert
}

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);

export function signToken(user) {
  return new SignJWT({ username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(user.role === 'admin' ? '8h' : '12h')
    .sign(secret());
}

// Returns the caller's claims, or sends 401/403 and returns null.
export async function requireUser(req, res, { role } = {}) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) { send(res, 401, { error: 'Sign in to continue.' }); return null; }

  let claims;
  try {
    const { payload } = await jwtVerify(token, secret());
    claims = { id: payload.sub, username: payload.username, role: payload.role };
  } catch {
    send(res, 401, { error: 'Your session has expired. Sign in again.' });
    return null;
  }

  if (role === 'admin') {
    // Re-check the database so a disabled or demoted admin loses access immediately.
    const { data } = await db().from('employees').select('role, active').eq('id', claims.id).maybeSingle();
    if (!data || !data.active || data.role !== 'admin') {
      send(res, 403, { error: 'This page needs an administrator account.' });
      return null;
    }
  }
  return claims;
}
