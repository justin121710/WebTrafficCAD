import React, { useEffect, useState } from 'react';

/** 數值輸入（含單位）：輸入有效數值即套用，失焦時還原為最後的有效值 */
export function NumberField({
  label, value, unit, step = 0.1, min = -Infinity, max = Infinity, digits = 2, onChange, disabled, id, title, width = 'w-20',
}: {
  label?: React.ReactNode; value: number; unit?: string; step?: number; min?: number; max?: number; digits?: number;
  onChange: (v: number) => void; disabled?: boolean; id?: string; title?: string; width?: string;
}) {
  const fmt = (v: number) => (isFinite(v) ? String(Math.round(v * 10 ** digits) / 10 ** digits) : '');
  const [text, setText] = useState(fmt(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(fmt(value)); }, [value, focused]);
  const invalid = (() => {
    const n = parseFloat(text);
    return text.trim() === '' || !isFinite(n) || n < min || n > max;
  })();
  return (
    <label className="flex items-center justify-between gap-2 py-0.5 text-xs" title={title}>
      {label !== undefined && <span className="min-w-0 truncate" style={{ color: 'var(--ui-text)' }}>{label}</span>}
      <span className="flex items-center gap-1 shrink-0">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={step}
          min={isFinite(min) ? min : undefined}
          max={isFinite(max) ? max : undefined}
          value={text}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setText(fmt(value)); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          onChange={e => {
            setText(e.target.value);
            const n = parseFloat(e.target.value);
            if (e.target.value.trim() !== '' && isFinite(n) && n >= min && n <= max) onChange(n);
          }}
          className={`sim-num ${width} px-1.5 py-1 rounded text-right font-mono text-[12px] outline-none disabled:opacity-50`}
          style={{ background: 'var(--ui-surface2)', border: `1px solid ${invalid && focused ? '#ef4444' : 'var(--ui-border)'}`, color: 'var(--ui-text)' }}
        />
        {unit && <span className="w-6 text-[11px]" style={{ color: 'var(--ui-muted)' }}>{unit}</span>}
      </span>
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, polished, id }: {
  value: T; options: { value: T; label: string; title?: string; disabled?: boolean }[]; onChange: (v: T) => void; polished?: boolean; id?: string;
}) {
  return (
    <div id={id} className="flex gap-1 p-0.5 rounded" style={{ background: 'var(--ui-surface2)' }}>
      {options.map(o => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`flex-1 py-1 text-[11.5px] rounded cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${active && polished ? 'accent-gradient' : ''}`}
            style={active ? (polished ? {} : { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)', fontWeight: 700 }) : { color: 'var(--ui-muted)' }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded p-3 ${className}`} style={{ background: 'var(--ui-surface2)', border: '1px solid var(--ui-border)' }}>
      {children}
    </div>
  );
}

export function Hint({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warn' | 'error' }) {
  const color = tone === 'warn' ? '#f59e0b' : tone === 'error' ? '#f87171' : 'var(--ui-muted)';
  return <p className="text-[11px] leading-relaxed mt-1" style={{ color }}>{children}</p>;
}

export function fmtM(v: number | null | undefined, digits = 2, inf = '∞'): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (!isFinite(v)) return inf;
  return v.toFixed(digits);
}
