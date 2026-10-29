import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { bucketLabel, fmtDuration } from '../api.js';

export default function ActivityChart({ timeline, kind, mode = 'activity' }) {
  const data = (timeline || []).map((b) => ({
    label: bucketLabel(b.bucket, kind),
    a: (mode === 'focus' ? b.workflowSeconds : b.activeSeconds) / 60,
    b: (mode === 'focus' ? b.externalSeconds : b.idleSeconds) / 60
  }));
  // Plot in hours once bars pass two hours so the axis lands on round numbers.
  const peak = Math.max(0, ...data.map((d) => d.a + d.b));
  const unit = peak >= 120 ? 'h' : 'm';
  if (unit === 'h') data.forEach((d) => { d.a /= 60; d.b /= 60; });
  const toSeconds = (v) => (unit === 'h' ? v * 3600 : v * 60);
  const names = mode === 'focus' ? ['Workflow apps', 'Other apps'] : ['Active', 'Idle'];

  if (!data.length) return <p className="empty">No activity recorded in this period yet.</p>;
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 12 }} interval="preserveStartEnd" />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-3)', fontSize: 12 }} tickCount={5} allowDecimals={false} tickFormatter={(v) => `${v}${unit}`} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            contentStyle={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 10, color: 'var(--ink)' }}
            formatter={(v, name) => [fmtDuration(toSeconds(v)), name]}
          />
          <Bar dataKey="a" name={names[0]} stackId="s" fill="var(--royal)" radius={[0, 0, 0, 0]} />
          <Bar dataKey="b" name={names[1]} stackId="s" fill="var(--sky-soft)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <div className="legend">
        <span><i className="sw royal" />{names[0]}</span>
        <span><i className="sw sky" />{names[1]}</span>
      </div>
    </div>
  );
}
