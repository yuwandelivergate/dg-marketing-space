import { RANGES, fmtAgo } from '../api.js';

const STATUS_LABEL = { active: 'Active', idle: 'Idle', locked: 'Locked', offline: 'Offline' };

export function StatusPill({ live }) {
  return <span className={`pill pill-${live}`}><i />{STATUS_LABEL[live] || live}</span>;
}

export function RangePicker({ value, onChange }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Date range">
      {RANGES.map((r) => (
        <button key={r.key} role="radio" aria-checked={value === r.key} className={value === r.key ? 'on' : ''} onClick={() => onChange(r.key)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function Updated({ at, error }) {
  if (error) return <span className="updated err">{error}</span>;
  if (!at) return <span className="updated">Loading…</span>;
  return <span className="updated">Live · updated {fmtAgo(at.toISOString()).toLowerCase()}</span>;
}

export function Ratio({ value, tone = 'brand' }) {
  if (value == null) return <span className="muted">—</span>;
  const pct = Math.round(value * 100);
  return (
    <span className="ratio">
      <span className={`ratio-bar ${tone}`}><span style={{ width: `${pct}%` }} /></span>
      <span className="num">{pct}%</span>
    </span>
  );
}

export function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value num">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

export function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }) {
  return <p className="empty">{children}</p>;
}
