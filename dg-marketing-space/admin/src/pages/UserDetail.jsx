import { useState } from 'react';
import { api, rangeQuery, fmtDuration, fmtPct, fmtNum, fmtAgo } from '../api.js';
import { usePoll } from '../hooks.js';
import { StatusPill, RangePicker, Updated, Stat, Empty } from '../components/ui.jsx';
import ActivityChart from '../components/ActivityChart.jsx';

const EVENT_LABEL = {
  'status:active': 'Back to active', 'status:idle': 'Went idle', 'status:locked': 'Screen locked',
  lock: 'Screen locked', unlock: 'Screen unlocked', suspend: 'Computer went to sleep', resume: 'Computer woke up',
  'display:added': 'Display connected', 'display:removed': 'Display disconnected',
  'session:start': 'Signed in', 'session:end': 'Signed out'
};

function DisplaySplit({ displays }) {
  const entries = Object.entries(displays || {});
  if (entries.length < 2) return <span className="muted">{entries[0]?.[0]?.split(' (')[0] || '—'}</span>;
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;
  return <span className="muted">{entries.map(([k, v]) => `${k.split(' (')[0]} ${Math.round((v / total) * 100)}%`).join(', ')}</span>;
}

export default function UserDetail({ id, range, setRange }) {
  const [chartMode, setChartMode] = useState('activity');
  const { data, error, updatedAt } = usePoll(() => api(`/metrics/user?id=${encodeURIComponent(id)}&${rangeQuery(range)}`), [id, range], 20000);

  if (!data) {
    return (
      <>
        <a className="back" href="#overview">Team activity</a>
        {error ? <p className="form-error">{error}</p> : <p className="muted">Loading report…</p>}
      </>
    );
  }

  const { user: u, metrics: m, apps, urls, displays, events, client } = data;
  const maxApp = apps[0]?.seconds || 1;
  const mouseShare = m.activeSeconds ? m.mouseActiveSeconds / m.activeSeconds : null;
  const clicksPerHour = m.activeSeconds ? (m.clicks / m.activeSeconds) * 3600 : 0;

  return (
    <>
      <a className="back" href="#overview">Team activity</a>
      <header className="page-head">
        <div>
          <h1>{u.display_name || u.username}</h1>
          <div className="head-meta">
            <StatusPill live={u.live} />
            {u.live !== 'offline' && u.last_app && <span>Using {u.last_app}</span>}
            {u.live === 'offline' && <span>Last seen {fmtAgo(u.last_seen_at).toLowerCase()}</span>}
            {client?.hostname && <span>on {client.hostname}</span>}
            <Updated at={updatedAt} error={error} />
          </div>
        </div>
        <RangePicker value={range} onChange={setRange} />
      </header>

      <section className="stats">
        <Stat label="Active time" value={fmtDuration(m.activeSeconds)} note={`${fmtDuration(m.idleSeconds)} idle · ${fmtDuration(m.lockedSeconds)} locked`} />
        <Stat label="Active ratio" value={fmtPct(m.activeRatio)} note="Active ÷ (active + idle)" />
        <Stat label="Workflow focus" value={fmtPct(m.workflowFocus)} note={`${fmtDuration(m.externalSeconds)} in other apps`} />
        <Stat label="Mouse" value={fmtNum(m.clicks)} note={`clicks · ${fmtNum(clicksPerHour)}/h · moving ${fmtPct(mouseShare)} of active time`} />
        <Stat label="Displays" value={m.maxDisplays || '—'} note={m.multiMonitorSeconds ? `${fmtDuration(m.multiMonitorSeconds)} with 2+ connected` : 'Single display'} />
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{chartMode === 'activity' ? 'Active and idle time' : 'Workflow apps vs other apps'}</h2>
          <div className="segmented small">
            <button className={chartMode === 'activity' ? 'on' : ''} onClick={() => setChartMode('activity')}>Activity</button>
            <button className={chartMode === 'focus' ? 'on' : ''} onClick={() => setChartMode('focus')}>Focus</button>
          </div>
        </div>
        <ActivityChart timeline={data.timeline} kind={data.range.bucket} mode={chartMode} />
      </section>

      <div className="grid-2">
        <section className="panel flush">
          <h2>Apps</h2>
          {!apps.length ? <Empty>No app usage recorded in this period.</Empty> : (
            <ul className="bars">
              {apps.map((a) => (
                <li key={a.name}>
                  <div className="bar-line">
                    <strong className="ellipsis">{a.name}</strong>
                    <span className={`tag ${a.workflow ? 'wf' : 'ext'}`}>{a.workflow ? 'Workflow' : 'Other'}</span>
                    <span className="num">{fmtDuration(a.seconds)}</span>
                  </div>
                  <span className="bar"><span className={a.workflow ? 'royal' : 'sky'} style={{ width: `${(a.seconds / maxApp) * 100}%` }} /></span>
                  <DisplaySplit displays={a.displays} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel flush">
          <h2>Displays</h2>
          {!displays.length ? <Empty>No display data yet.</Empty> : (
            <ul className="bars">
              {displays.map((d) => {
                const t = d.workflowSeconds + d.externalSeconds || 1;
                return (
                  <li key={d.display}>
                    <div className="bar-line">
                      <strong className="ellipsis">{d.display}</strong>
                      <span className="num">{fmtDuration(d.seconds)}</span>
                    </div>
                    <span className="bar split">
                      <span className="royal" style={{ width: `${(d.workflowSeconds / t) * 100}%` }} />
                      <span className="sky" style={{ width: `${(d.externalSeconds / t) * 100}%` }} />
                    </span>
                    <span className="muted">{fmtDuration(d.workflowSeconds)} workflow, {fmtDuration(d.externalSeconds)} other</span>
                  </li>
                );
              })}
            </ul>
          )}

          <h2 className="sub">Recent events</h2>
          {!events.length ? <Empty>No events in this period.</Empty> : (
            <ol className="events">
              {events.map((e, i) => (
                <li key={i}>
                  <time className="num">{new Date(e.at).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: range === 'today' ? undefined : 'numeric', month: range === 'today' ? undefined : 'short' })}</time>
                  <span>{EVENT_LABEL[e.type] || e.type}{e.detail ? ` (${e.detail})` : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <section className="panel flush">
        <h2>Web pages</h2>
        {!urls.length ? <Empty>No web pages recorded. Pages opened inside the workspace appear here.</Empty> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Page</th><th className="r">Time in front</th><th className="r">Visits</th></tr></thead>
              <tbody>
                {urls.map((u) => (
                  <tr key={u.url}>
                    <td className="url ellipsis" title={u.url}>{u.url.replace(/^https?:\/\//, '')}</td>
                    <td className="r num">{fmtDuration(u.seconds)}</td>
                    <td className="r num">{fmtNum(u.visits)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {client && (
        <p className="footnote">
          Desktop app {client.appVersion} on {client.platform}. App tracking: {client.appTracking === 'system-wide' ? 'all apps' : 'workspace apps only'}.
          Click counting: {client.clickTracking === 'system-wide' ? 'all apps' : 'workspace apps only'}.
        </p>
      )}
    </>
  );
}
