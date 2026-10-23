import React, { useEffect, useRef, useState } from 'react';

/**
 * 製圖桌介面（Demo 1）的框架元件：選單列、功能區（Ribbon）、指令列、狀態列。
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
            className="h-[26px] px-2.5 text-xs cursor-pointer"
            style={{ color: 'var(--ui-text)', background: open === m.key ? 'var(--ui-surface2)' : 'transparent' }}
          >
            {m.label}
          </button>
          {open === m.key && (
            <div id={`menu-${m.key}`} className="absolute left-0 top-full mt-px min-w-[220px] py-1 shadow-lg z-50" style={{ background: 'var(--ui-surface)', border: '1px solid var(--ui-border)' }}>
              {m.items.map((it, i) => (
                <React.Fragment key={i}>
                  {it.separator && <div className="my-1" style={{ borderTop: '1px solid var(--ui-border)' }} />}
                  <button
                    id={it.id}
                    disabled={it.disabled}
                    onClick={() => { setOpen(null); it.onClick?.(); }}
                    className="w-full flex items-center justify-between gap-6 px-3 py-[5px] text-xs text-left cursor-pointer disabled:opacity-35 disabled:cursor-default enabled:hover:bg-[var(--ui-accent-soft)]"
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
            className="h-[24px] px-4 text-xs cursor-pointer -mb-px"
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

export function Ribbon({ children }: { children: React.ReactNode }) {
  return (
    <div id="ribbon" className="flex items-stretch shrink-0 overflow-x-auto px-1 pt-1" style={{ background: 'var(--ui-ribbon)', borderBottom: '1px solid var(--ui-border)' }}>
      {children}
    </div>
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
      className="row-span-3 flex flex-col items-center justify-center gap-1 w-[58px] px-1 text-xs cursor-pointer hover:bg-white/5 [&_svg]:w-6 [&_svg]:h-6"
      style={active ? { background: 'var(--ui-accent-soft)', outline: '1px solid var(--ui-accent)', outlineOffset: -1, color: 'var(--ui-strong)' } : { color: 'var(--ui-text)' }}
    >
      {icon}
      <span className="leading-tight text-center">{label}</span>
    </button>
  );
}

export function RibbonButton({ icon, label, active, onClick, title, disabled, id }: { icon?: React.ReactNode; label: string; active?: boolean; onClick: () => void; title?: string; disabled?: boolean; id?: string; key?: React.Key }) {
  return (
    <button
      id={id}
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="flex items-center gap-1.5 h-[24px] pl-1 pr-2 text-xs whitespace-nowrap cursor-pointer enabled:hover:bg-white/5 disabled:opacity-35 disabled:cursor-default [&_svg]:w-4 [&_svg]:h-4"
      style={active ? { background: 'var(--ui-accent-soft)', outline: '1px solid var(--ui-accent)', outlineOffset: -1, color: 'var(--ui-strong)' } : { color: 'var(--ui-text)' }}
    >
      {icon && <span className="w-4 h-4 flex items-center justify-center shrink-0">{icon}</span>}
      <span>{label}</span>
    </button>
  );
}

export function RibbonCheck({ label, checked, onChange, id }: { label: string; checked: boolean; onChange: () => void; id?: string }) {
  return (
    <label className="flex items-center gap-1.5 h-[24px] px-1.5 text-xs whitespace-nowrap cursor-pointer hover:bg-white/5" style={{ color: 'var(--ui-text)' }}>
      <input id={id} type="checkbox" checked={checked} onChange={onChange} className="m-0 cursor-pointer" style={{ accentColor: 'var(--ui-accent)' }} />
      {label}
    </label>
  );
}

/* ------------------------------------------------------------------ 指令列 */
export function CommandLine({ history, prompt, onSubmit, suggestions, typeToFocus }: {
  history: string[];
  prompt: string;
  onSubmit: (text: string) => void;
  suggestions: string[];
  /** 畫布有焦點時直接打字即進入指令列（類似 AutoCAD） */
  typeToFocus: boolean;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!typeToFocus) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || t?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      // V 保留給「選取」快捷鍵，空白鍵保留給平移
      if (!/^[a-uw-z]$/i.test(e.key)) return;
      e.preventDefault();
      setValue(v => v + e.key);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [typeToFocus]);
  return (
    <div id="command-line" className="shrink-0 px-2.5 pt-1 pb-0.5 font-mono text-[11px] leading-[17px]" style={{ background: 'var(--ui-cmd)', borderTop: '1px solid var(--ui-border)', color: 'var(--ui-muted)' }}>
      {history.slice(-2).map((h, i) => <div key={i} className="truncate">{h}</div>)}
      <form
        className="flex items-center gap-1.5"
        style={{ color: 'var(--ui-text)' }}
        onSubmit={e => { e.preventDefault(); const t = value.trim(); if (t) onSubmit(t); setValue(''); inputRef.current?.blur(); }}
      >
        <label htmlFor="command-input" className="whitespace-nowrap shrink-0 max-w-[60%] truncate">{prompt}</label>
        <input
          id="command-input"
          ref={inputRef}
          value={value}
          list="command-suggestions"
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape') { setValue(''); inputRef.current?.blur(); } e.stopPropagation(); }}
          placeholder="輸入指令或工具名稱，例如 停止線、STOP、Z"
          autoComplete="off"
          className="flex-1 min-w-0 bg-transparent outline-none border-0 py-px"
          style={{ color: 'var(--ui-text)', font: 'inherit' }}
        />
        <datalist id="command-suggestions">
          {suggestions.map(s => <option key={s} value={s} />)}
        </datalist>
      </form>
    </div>
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
          className="h-[20px] px-2 whitespace-nowrap cursor-pointer"
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
