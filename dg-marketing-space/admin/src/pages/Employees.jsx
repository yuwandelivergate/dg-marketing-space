import { useState } from 'react';
import { api, fmtAgo } from '../api.js';
import { usePoll } from '../hooks.js';
import { StatusPill, Modal, Empty } from '../components/ui.jsx';

const EMPTY_FORM = { display_name: '', username: '', password: '', role: 'employee' };

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789@#%';
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export default function Employees({ me }) {
  const { data, error, reload } = usePoll(() => api('/users'), [], 30000);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [created, setCreated] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetFor, setResetFor] = useState(null);
  const [deleteFor, setDeleteFor] = useState(null);
  const [notice, setNotice] = useState('');

  const users = data?.users || [];
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const { user } = await api('/users', { method: 'POST', body: form });
      setCreated({ username: user.username, password: form.password });
      setForm(EMPTY_FORM);
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function patch(u, body, message) {
    try {
      await api(`/users/${u.id}`, { method: 'PATCH', body });
      setNotice(message);
      reload();
    } catch (err) {
      setNotice(err.message);
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Employees</h1>
          <span className="updated">{users.length} accounts</span>
        </div>
      </header>

      <section className="panel">
        <h2>Create an account</h2>
        <form className="create-form" onSubmit={create}>
          <label className="field"><span>Full name</span><input value={form.display_name} onChange={set('display_name')} placeholder="Nimali Perera" /></label>
          <label className="field"><span>Username</span><input value={form.username} onChange={set('username')} placeholder="nimali.p" autoComplete="off" required /></label>
          <label className="field">
            <span>Temporary password</span>
            <span className="with-action">
              <input value={form.password} onChange={set('password')} autoComplete="new-password" minLength={8} required />
              <button type="button" className="btn-link" onClick={() => setForm({ ...form, password: generatePassword() })}>Generate</button>
            </span>
          </label>
          <label className="field">
            <span>Role</span>
            <select value={form.role} onChange={set('role')}>
              <option value="employee">Employee</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button className="btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        {created && (
          <p className="form-ok" role="status">
            Account created. Share these sign-in details privately: <strong>{created.username}</strong> / <code>{created.password}</code>
          </p>
        )}
      </section>

      {notice && <p className="notice" role="status" onClick={() => setNotice('')}>{notice}</p>}
      {error && <p className="form-error">{error}</p>}

      <section className="panel flush">
        {!users.length ? <Empty>No accounts yet.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Employee</th><th>Role</th><th>Status</th><th>Last sign-in</th><th className="r">Actions</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={u.active ? '' : 'dim'}>
                    <td><a href={`#employee/${u.id}`} className="who"><strong>{u.display_name || u.username}</strong><span>{u.username}</span></a></td>
                    <td>{u.role === 'admin' ? 'Admin' : 'Employee'}</td>
                    <td>{u.active ? <StatusPill live={u.live} /> : <span className="tag ext">Turned off</span>}</td>
                    <td className="muted">{fmtAgo(u.last_login_at)}</td>
                    <td className="r actions">
                      <button className="btn-link" onClick={() => setResetFor(u)}>Reset password</button>
                      {u.id !== me.id && (
                        <>
                          <button className="btn-link" onClick={() => patch(u, { active: !u.active }, u.active ? `${u.username} can no longer sign in.` : `${u.username} can sign in again.`)}>
                            {u.active ? 'Turn off' : 'Turn on'}
                          </button>
                          <button className="btn-link danger" onClick={() => setDeleteFor(u)}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {resetFor && <ResetPassword user={resetFor} onClose={() => setResetFor(null)} onDone={(msg) => { setResetFor(null); setNotice(msg); }} />}
      {deleteFor && (
        <Modal title={`Delete ${deleteFor.display_name || deleteFor.username}?`} onClose={() => setDeleteFor(null)}>
          <p>This removes the account and all of its activity history. To keep the history, turn the account off instead.</p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDeleteFor(null)}>Keep account</button>
            <button className="btn danger" onClick={async () => {
              try { await api(`/users/${deleteFor.id}`, { method: 'DELETE' }); setNotice(`${deleteFor.username} deleted.`); reload(); }
              catch (err) { setNotice(err.message); }
              setDeleteFor(null);
            }}>Delete account</button>
          </div>
        </Modal>
      )}
    </>
  );
}

function ResetPassword({ user, onClose, onDone }) {
  const [password, setPassword] = useState(generatePassword());
  const [error, setError] = useState('');
  async function save(e) {
    e.preventDefault();
    try {
      await api(`/users/${user.id}`, { method: 'PATCH', body: { password } });
      onDone(`New password for ${user.username}: ${password}`);
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Modal title={`Reset password for ${user.username}`} onClose={onClose}>
      <form onSubmit={save}>
        <label className="field">
          <span>New password</span>
          <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoFocus />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary">Reset password</button>
        </div>
      </form>
    </Modal>
  );
}
