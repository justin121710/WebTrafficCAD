import React from 'react';
import { History } from 'lucide-react';
import { CadElement } from '../types';
import { LAYERS, layerKeyOf, computeQuantities } from '../markings';
import { PALETTES } from '../renderPrimitives';

/* 共用小元件（顏色取自 .ui-* 變數） */
export function Toggle({ on, onClick, id }: { on: boolean; onClick: () => void; id?: string }) {
  return (
    <button
      id={id}
      onClick={onClick}
      className="w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0"
      style={{ background: on ? 'var(--ui-accent)' : 'var(--ui-border)' }}
    >
      <div className={`w-4 h-4 rounded-full transition-transform ${on ? 'translate-x-4' : ''}`} style={{ background: on ? 'var(--ui-accent-text)' : '#ffffff' }} />
    </button>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] font-bold tracking-wider uppercase mb-1.5" style={{ color: 'var(--ui-muted)' }}>{children}</div>;
}

/* ------------------------------------------------------------------ 圖層 */
export function LayerPanel({ elements, hidden, onToggle, onShowAll, extra }: { elements: CadElement[]; hidden: string[]; onToggle: (k: string) => void; onShowAll: () => void; extra?: React.ReactNode }) {
  const counts = new Map<string, number>();
  elements.forEach(el => { const k = layerKeyOf(el); counts.set(k, (counts.get(k) || 0) + 1); });
  hidden.forEach(k => { if (!counts.has(k)) counts.set(k, 0); });
  const keys = Array.from(counts.keys()).sort((a, b) => (LAYERS[a]?.desc || a).localeCompare(LAYERS[b]?.desc || b, 'zh-Hant'));
  return (
    <div style={{ color: 'var(--ui-text)' }}>
      {keys.length === 0 && <p className="text-xs py-4 text-center" style={{ color: 'var(--ui-muted)' }}>畫布上還沒有物件</p>}
      {hidden.length > 0 && (
        <div className="flex items-center justify-between px-1 pb-1 text-[11px]" style={{ color: 'var(--ui-muted)' }}>
          <span>{hidden.length} 個圖層隱藏中，不會匯出</span>
          <button onClick={onShowAll} className="px-2 py-0.5 cursor-pointer" style={{ border: '1px solid var(--ui-border)', color: 'var(--ui-text)' }}>全部顯示</button>
        </div>
      )}
      {keys.map(k => {
        const isHidden = hidden.includes(k);
        const def = LAYERS[k];
        const swatch = def ? PALETTES.screen[def.color] : '#888';
        return (
          <label key={k} className="flex items-center gap-2.5 px-1.5 py-[5px] text-xs cursor-pointer hover:bg-white/5" style={{ color: isHidden ? 'var(--ui-muted)' : 'var(--ui-text)' }}>
            <input id={`layer-toggle-${k}`} type="checkbox" checked={!isHidden} onChange={() => onToggle(k)} className="m-0 cursor-pointer" style={{ accentColor: 'var(--ui-accent)' }} />
            <span className="w-3 h-3 shrink-0" style={{ background: swatch, border: '1px solid var(--ui-border)', opacity: isHidden ? 0.3 : 1 }} />
            <span className="flex-1 truncate">{def?.desc || k}</span>
            <span className="font-mono text-[10px] truncate max-w-[45%]" style={{ color: 'var(--ui-muted)' }} title={def?.name}>{def?.name || k}</span>
            <span className="font-mono text-[10px] w-5 text-right" style={{ color: 'var(--ui-muted)' }}>{counts.get(k)}</span>
          </label>
        );
      })}
      {extra}
    </div>
  );
}

/* ------------------------------------------------------------------ 數量 */
export function QuantityPanel({ elements, onExport }: { elements: CadElement[]; onExport: () => void }) {
  const rows = computeQuantities(elements);
  const total = rows.reduce((s, r) => s + r.area, 0);
  return (
    <div style={{ color: 'var(--ui-text)' }}>
      <SectionTitle>標線數量（即時）</SectionTitle>
      {rows.length === 0 ? (
        <p className="text-xs py-6 text-center" style={{ color: 'var(--ui-muted)' }}>畫上標線後會自動統計長度與面積</p>
      ) : (
        <table className="w-full text-[11px]">
          <thead><tr style={{ color: 'var(--ui-muted)' }}><th className="text-left font-medium py-1">項目</th><th className="text-right font-medium">長度 m</th><th className="text-right font-medium">面積 m²</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} style={{ borderTop: '1px solid var(--ui-border)' }}>
                <td className="py-1 pr-1">{r.name}</td>
                <td className="text-right font-mono">{r.length > 0 ? r.length.toFixed(1) : '—'}</td>
                <td className="text-right font-mono">{r.area.toFixed(2)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '1px solid var(--ui-border)' }}><td className="py-1 font-bold">合計</td><td></td><td className="text-right font-mono font-bold">{total.toFixed(2)}</td></tr>
          </tbody>
        </table>
      )}
      <button onClick={onExport} className="mt-3 w-full py-1.5 text-xs rounded-md cursor-pointer" style={{ background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)', border: '1px solid var(--ui-border)' }}>匯出 CSV（Excel 可開啟）</button>
      <p className="text-[10.5px] mt-2" style={{ color: 'var(--ui-muted)' }}>虛線只計實線段；面積＝長度×線寬，區域標線以多邊形面積計。</p>
    </div>
  );
}

/* ------------------------------------------------------------------ 指向線樣式 */
export const ARROW_TYPES = [
  { type: 'straight', name: '直行' },
  { type: 'left', name: '左轉' },
  { type: 'right', name: '右轉' },
  { type: 'straight_left', name: '直左' },
  { type: 'straight_right', name: '直右' },
] as const;

export function ArrowTypeBar({ value, onChange, style }: { value: string; onChange: (t: string) => void; style?: React.CSSProperties }) {
  return (
    <div id="arrow-type-bar" className="absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 p-1 rounded-xl shadow-lg" style={{ background: 'var(--ui-surface)', border: '1px solid var(--ui-border)', backdropFilter: 'blur(12px)', ...style }}>
      <span className="text-[11px] px-2" style={{ color: 'var(--ui-muted)' }}>箭頭</span>
      {ARROW_TYPES.map(a => (
        <button key={a.type} onClick={() => onChange(a.type)} className="px-2.5 py-1 text-xs rounded-lg cursor-pointer"
          style={value === a.type ? { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)' } : { color: 'var(--ui-text)' }}>
          {a.name}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 對話框 */
export function ConfirmDialog({ dialog, onClose }: { dialog: { title: string; message: string; confirmLabel: string; onConfirm: () => void } | null; onClose: () => void }) {
  if (!dialog) return null;
  return (
    <div className="fixed inset-0 z-[400] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div id="confirm-dialog" className="w-full max-w-sm rounded-lg p-5 shadow-lg bg-[#14161c] border border-[#2d3039] text-slate-200" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold mb-2">{dialog.title}</h3>
        <p className="text-xs text-slate-400 leading-relaxed">{dialog.message}</p>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onClose} className="px-4 py-1.5 text-xs rounded-lg border border-[#2d3039] hover:bg-white/5 cursor-pointer">取消</button>
          <button id="confirm-dialog-ok" onClick={() => { dialog.onConfirm(); onClose(); }} className="px-4 py-1.5 text-xs rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold cursor-pointer">{dialog.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

export function AutosaveBanner({ offer, onRestore, onDiscard }: { offer: { savedAt: string; project: any } | null; onRestore: () => void; onDiscard: () => void }) {
  if (!offer) return null;
  const n = offer.project?.cad?.elements?.length ?? 0;
  const when = new Date(offer.savedAt).toLocaleString('zh-TW', { hour12: false });
  return (
    <div id="autosave-banner" className="fixed top-[164px] left-1/2 -translate-x-1/2 z-[350] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg bg-[#14161c] border border-amber-500/50 text-slate-200 text-xs max-w-xl">
      <History className="w-4 h-4 text-amber-400 shrink-0" />
      <span className="flex-1">找到上次自動儲存的內容（{when}，{n} 個物件）。要還原嗎？</span>
      <button id="autosave-restore-btn" onClick={onRestore} className="px-3 py-1 rounded-lg bg-amber-500 text-black font-bold cursor-pointer">還原</button>
      <button id="autosave-discard-btn" onClick={onDiscard} className="px-3 py-1 rounded-lg border border-[#2d3039] hover:bg-white/5 cursor-pointer">捨棄</button>
    </div>
  );
}
