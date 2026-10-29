import { api, rangeQuery, fmtDuration, fmtPct, fmtNum, fmtAgo } from '../api.js';
import { usePoll } from '../hooks.js';
import { StatusPill, RangePicker, Updated, Ratio, Stat, Empty } from '../components/ui.jsx';
import ActivityChart from '../components/ActivityChart.jsx';

const ORDER = { active: 0, idle: 1, locked: 2, offline: 3 };

export default function Overview({ range, setRange }) {
  const { data, error, updatedAt } = usePoll(() => api(`/metrics/summary?${rangeQuery(range)}`), [range], 15000);
  const users = (data?.users || []).filter((u) => u.active);
  const online = users.filter((u) => u.live !== 'offline').sort((a, b) => ORDER[a.live] - ORDER[b.live]);

  const total = users.reduce((t, u) => {
    t.active += u.metrics.activeSeconds;
    t.idle += u.metrics.idleSeconds;
    t.wf += u.metrics.workflowSeconds;
    t.ex += u.metrics.externalSeconds;
    if (u.metrics.maxDisplays > 1) t.multi++;
    return t;
  }, { active: 0, idle: 0, wf: 0, ex: 0, multi: 0 });

  const rows = [...users].sort((a, b) => ORDER[a.live] - ORDER[b.live] || b.metrics.activeSeconds - a.metrics.activeSeconds);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Team activity</h1>
          <Updated at={updatedAt} error={error} />
        </div>
        <RangePicker value={range} onChange={setRange} />
      </header>

      <section className="roster" aria-label="Who's working now">
        <div className="roster-count">
          <span className="num big">{online.length}</span>
          <span>of {users.length} signed in now</span>
        </div>
        <ul>
          {online.length === 0 && <li className="roster-empty">Nobody is signed in to the workspace right now.</li>}
          {online.map((u) => (
            <li key={u.id}>
              <a href={`#employee/${u.id}`}>
                <StatusPill live={u.live} />
                <strong>{u.display_name || u.username}</strong>
                <span className="muted ellipsis">{u.last_app || 'Desktop'}</span>
                {u.last_display_count > 1 && <span className="tag">{u.last_display_count} displays</span>}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="stats">
        <Stat label="Active time" value={fmtDuration(total.active)} note={`${fmtDuration(total.idle)} idle`} />
        <Stat label="Active ratio" value={fmtPct(total.active + total.idle ? total.active / (total.active + total.idle) : null)} note="Active ÷ (active + idle)" />
        <Stat label="Workflow focus" value={fmtPct(total.wf + total.ex ? total.wf / (total.wf + total.ex) : null)} note="Time in workspace & pinned apps" />
        <Stat label="Multi-monitor" value={fmtNum(total.multi)} note="People who used 2+ displays" />
      </section>

      <section className="panel">
        <h2>Activity across the team</h2>
        <ActivityChart timeline={data?.timeline} kind={data?.range?.bucket} />
      </section>

      <section className="panel flush">
        <h2>Employees</h2>
        {!rows.length ? <Empty>No employees yet. Create accounts on the Employees page.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee</th><th>Now</th><th className="r">Active</th><th className="r">Idle</th>
                  <th>Active ratio</th><th>Workflow focus</th><th className="r">Clicks</th><th className="r">Displays</th><th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} onClick={() => { window.location.hash = `employee/${u.id}`; }} className="clickable">
                    <td><a href={`#employee/${u.id}`} className="who"><strong>{u.display_name || u.username}</strong><span>{u.username}</span></a></td>
                    <td><StatusPill live={u.live} /></td>
                    <td className="r num">{fmtDuration(u.metrics.activeSeconds)}</td>
                    <td className="r num">{fmtDuration(u.metrics.idleSeconds)}</td>
                    <td><Ratio value={u.metrics.activeRatio} /></td>
                    <td><Ratio value={u.metrics.workflowFocus} tone="sky" /></td>
                    <td className="r num">{fmtNum(u.metrics.clicks)}</td>
                    <td className="r num">{u.metrics.maxDisplays || '—'}</td>
                    <td className="muted">{fmtAgo(u.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
