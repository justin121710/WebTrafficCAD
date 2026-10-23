import React, { createContext, useContext, useEffect, useRef, useState } from 'react';

/**
 * 製圖桌介面的框架元件：選單列、功能區（Ribbon）、狀態列。
 * 顏色取自 .ui-drafting 的 CSS 變數，內容與動作由 App 傳入。
 */

/* ------------------------------------------------------------------ 選單列 */
export interface MenuItem {
  label: string;
  onClick?: () => void;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  /** 在此項目前加分隔線 */
  separator?: boolean;
  id?: string;
}

export interface MenuDef {
  key: string;
  label: string;
  items: MenuItem[];
}

export function MenuBar({ logoSrc, menus, right }: { logoSrc: string; menus: MenuDef[]; right?: React.ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div ref={rootRef} className="flex items-center gap-0.5 h-[30px] px-2 shrink-0 select-none z-40" style={{ background: 'var(--ui-menubar)', borderBottom: '1px solid var(--ui-border)' }}>
      <img src={logoSrc} alt="" className="w-[18px] h-[18px] mr-1.5" />
      <span className="text-xs font-bold mr-3 whitespace-nowrap" style={{ color: 'var(--ui-strong)' }}>WebTrafficCAD</span>
      {menus.map(m => (
        <div key={m.key} className="relative">
          <button
            id={`menu-${m.key}-btn`}
            onClick={() => setOpen(open === m.key ? null : m.key)}
            onMouseEnter={() => { if (open && open !== m.key) setOpen(m.key); }}
            className="h-[24px] px-2.5 text-xs rounded cursor-pointer"
            style={{ color: 'var(--ui-text)', background: open === m.key ? 'var(--ui-surface2)' : 'transparent' }}
          >
            {m.label}
          </button>
          {open === m.key && (
            <div id={`menu-${m.key}`} className="absolute left-0 top-full mt-1 min-w-[220px] p-1 rounded shadow-lg z-50" style={{ background: 'var(--ui-surface)', border: '1px solid var(--ui-border)' }}>
              {m.items.map((it, i) => (
                <React.Fragment key={i}>
                  {it.separator && <div className="my-1" style={{ borderTop: '1px solid var(--ui-border)' }} />}
                  <button
                    id={it.id}
                    disabled={it.disabled}
                    onClick={() => { setOpen(null); it.onClick?.(); }}
                    className="w-full flex items-center justify-between gap-6 px-2.5 py-[5px] rounded-sm text-xs text-left cursor-pointer disabled:opacity-35 disabled:cursor-default enabled:hover:bg-[var(--ui-accent-soft)]"
                    style={{ color: it.danger ? '#f87171' : 'var(--ui-text)' }}
                  >
                    <span>{it.label}</span>
                    {it.shortcut && <span className="font-mono text-[10.5px]" style={{ color: 'var(--ui-muted)' }}>{it.shortcut}</span>}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="flex-1" />
      {right}
    </div>
  );
}

/* ------------------------------------------------------------------ 功能區 */
export function RibbonTabs({ tabs, value, onChange }: { tabs: [string, string][]; value: string; onChange: (k: string) => void }) {
  return (
    <div className="flex items-end h-[26px] px-2 shrink-0" style={{ background: 'var(--ui-bg)', borderBottom: '1px solid var(--ui-border)' }}>
      {tabs.map(([k, label]) => {
        const active = k === value;
        return (
          <button
            key={k}
            id={`ribbon-tab-${k}`}
            onClick={() => onChange(k)}
            className="h-[24px] px-4 text-xs rounded-t cursor-pointer -mb-px"
            style={active
              ? { background: 'var(--ui-ribbon)', color: 'var(--ui-strong)', border: '1px solid var(--ui-border)', borderBottomColor: 'var(--ui-ribbon)' }
              : { color: 'var(--ui-muted)', border: '1px solid transparent' }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** 功能區寬度不足時改為只顯示圖示（滑鼠停留顯示名稱） */
const RibbonCompact = createContext(false);

export function Ribbon({ children, compactBelow = 1360 }: { children: React.ReactNode; compactBelow?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setCompact(el.clientWidth < compactBelow));
    ro.observe(el);
    return () => ro.disconnect();
  }, [compactBelow]);
  return (
    <RibbonCompact.Provider value={compact}>
      <div ref={ref} id="ribbon" className="flex items-stretch shrink-0 overflow-x-auto px-1 pt-1" style={{ background: 'var(--ui-ribbon)', borderBottom: '1px solid var(--ui-border)' }}>
        {children}
      </div>
    </RibbonCompact.Provider>
  );
}

export function RibbonGroup({ title, children, rows = 3 }: { title: string; children: React.ReactNode; rows?: number; key?: React.Key }) {
  return (
    <div className="flex flex-col shrink-0 px-1.5" style={{ borderRight: '1px solid var(--ui-border)' }}>
      <div className="grid grid-flow-col gap-x-0.5 gap-y-px flex-1" style={{ gridTemplateRows: `repeat(${rows}, 24px)` }}>
        {children}
      </div>
      <span className="text-[10.5px] text-center py-[3px] whitespace-nowrap" style={{ color: 'var(--ui-muted)' }}>{title}</span>
    </div>
  );
}

/** 跨三列的大按鈕（選取、匯出等主要動作） */
export function RibbonBigButton({ icon, label, active, onClick, title, id }: { icon: React.ReactNode; label: string; active?: boolean; onClick: () => void; title?: string; id?: string }) {
  return (
    <button
      id={id}
      onClick={onClick}
      title={title}
      className="row-span-3 flex flex-col items-center justify-center gap-1 w-[58px] px-1 text-xs rounded cursor-pointer hover:bg-white/5 [&_svg]:w-6 [&_svg]:h-6"
      style={active ? { background: 'var(--ui-accent-soft)', outline: '1px solid var(--ui-accent)', outlineOffset: -1, color: 'var(--ui-strong)' } : { color: 'var(--ui-text)' }}
    >
      {icon}
      <span className="leading-tight text-center">{label}</span>
    </button>
  );
}

export function RibbonButton({ icon, label, active, onClick, title, disabled, id }: { icon?: React.ReactNode; label: string; active?: boolean; onClick: () => void; title?: string; disabled?: boolean; id?: string; key?: React.Key }) {
  const compact = useContext(RibbonCompact) && !!icon;
  return (
    <button
      id={id}
      onClick={onClick}
      title={compact ? (title ? `${label}：${title}` : label) : title}
      aria-label={label}
      disabled={disabled}
      className={`flex items-center gap-1.5 h-[24px] ${compact ? 'w-[26px] justify-center' : 'pl-1 pr-2'} text-xs whitespace-nowrap rounded cursor-pointer enabled:hover:bg-white/5 disabled:opacity-35 disabled:cursor-default [&_svg]:w-4 [&_svg]:h-4`}
      style={active ? { background: 'var(--ui-accent-soft)', outline: '1px solid var(--ui-accent)', outlineOffset: -1, color: 'var(--ui-strong)' } : { color: 'var(--ui-text)' }}
    >
      {icon && <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>}
      {!compact && <span>{label}</span>}
    </button>
  );
}

export function RibbonCheck({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: () => void; id?: string }) {
  return (
    <label className="flex items-center gap-1.5 h-[24px] px-1.5 text-xs whitespace-nowrap rounded cursor-pointer hover:bg-white/5" style={{ color: 'var(--ui-text)' }}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} className="m-0 cursor-pointer" style={{ accentColor: 'var(--ui-accent)' }} />
      {label}
    </label>
  );
}

/* ------------------------------------------------------------------ 狀態列 */
export interface StatusToggle {
  label: string;
  on: boolean;
  onClick: () => void;
  title?: string;
  id?: string;
}

export function StatusBar({ coordRef, scaleRef, toggles, right }: {
  coordRef: React.RefObject<HTMLSpanElement | null>;
  scaleRef: React.RefObject<HTMLSpanElement | null>;
  toggles: StatusToggle[];
  right?: React.ReactNode;
}) {
  return (
    <div id="status-bar" className="flex items-center gap-0.5 h-[26px] px-2 shrink-0 text-[11px] overflow-x-auto select-none" style={{ background: 'var(--ui-menubar)', borderTop: '1px solid var(--ui-border)', color: 'var(--ui-muted)' }}>
      <span ref={coordRef} className="font-mono mr-3 whitespace-nowrap min-w-[150px]" style={{ color: 'var(--ui-text)' }}>0.000, 0.000</span>
      {toggles.map(t => (
        <button
          key={t.label}
          id={t.id}
          aria-pressed={t.on}
          onClick={t.onClick}
          title={t.title}
          className="h-[20px] px-2 whitespace-nowrap rounded cursor-pointer"
          style={t.on ? { background: 'var(--ui-accent-soft)', color: 'var(--ui-strong)' } : { color: 'var(--ui-muted)' }}
        >
          {t.label}
        </button>
      ))}
      <div className="flex-1" />
      <span ref={scaleRef} className="whitespace-nowrap mr-3" title="以 96 dpi 螢幕估算的出圖比例" />
      {right}
    </div>
  );
}

/* ------------------------------------------------------------- 功能區欄位 */
export const fieldStyle: React.CSSProperties = { background: 'var(--ui-bg)', color: 'var(--ui-text)', border: '1px solid var(--ui-border)' };

/** 欄名＋輸入元件（下拉、文字、數字），欄名固定寬度讓同欄對齊 */
export function RibbonField({ label, children, labelW = 28 }: { label: string; children: React.ReactNode; labelW?: number; key?: React.Key }) {
  return (
    <label className="flex items-center gap-1.5 h-[24px] px-1.5 text-xs whitespace-nowrap">
      <span className="shrink-0" style={{ color: 'var(--ui-muted)', width: labelW }}>{label}</span>
      {children}
    </label>
  );
}
