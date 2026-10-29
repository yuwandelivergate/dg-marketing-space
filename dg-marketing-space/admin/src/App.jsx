import { useEffect, useState } from 'react';
import { session } from './api.js';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Employees from './pages/Employees.jsx';
import UserDetail from './pages/UserDetail.jsx';

function parseHash() {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h.startsWith('employee/')) return { name: 'employee', id: h.slice(9) };
  if (h === 'employees') return { name: 'employees' };
  return { name: 'overview' };
}

export default function App() {
  const [sess, setSess] = useState(session.get());
  const [route, setRoute] = useState(parseHash());
  const [range, setRange] = useState('today');

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    const onLogout = () => setSess(null);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('dg:logout', onLogout);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('dg:logout', onLogout);
    };
  }, []);

  if (!sess) return <Login onLogin={(s) => { session.set(s); setSess(s); }} />;

  const signOut = () => { session.clear(); setSess(null); window.location.hash = ''; };
  const nav = [
    { key: 'overview', href: '#overview', label: 'Team activity' },
    { key: 'employees', href: '#employees', label: 'Employees' }
  ];
  const current = route.name === 'employee' ? 'overview' : route.name;

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <img src="/logo.png" alt="" width="34" height="34" />
          <div>
            <strong>DG Admin</strong>
            <span>Marketing Space</span>
          </div>
        </div>
        <nav>
          {nav.map((n) => (
            <a key={n.key} href={n.href} className={current === n.key ? 'on' : ''} aria-current={current === n.key ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="me">
          <span>{sess.user.display_name || sess.user.username}</span>
          <button className="btn-link" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <main className="main">
        {route.name === 'employees' && <Employees me={sess.user} />}
        {route.name === 'employee' && <UserDetail id={route.id} range={range} setRange={setRange} />}
        {route.name === 'overview' && <Overview range={range} setRange={setRange} />}
      </main>
    </div>
  );
}
