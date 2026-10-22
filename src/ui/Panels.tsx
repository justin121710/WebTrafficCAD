import React from 'react';
import { Eye, EyeOff, Image as ImageIcon, FileCode2, Table, Upload, Ruler, Trash2, History } from 'lucide-react';
import { CadElement } from '../types';
import { LAYERS, layerKeyOf, computeQuantities } from '../markings';
import { PaletteName } from '../renderPrimitives';

/* 共用小元件（顏色取自 .ui-* 變數） */
export function Toggle({ on, onClick, id }: { on: boolean; onClick: () => void; id?: string }) {
  return (
    <button
      id={id}
      onClick={onClick}
      className="w-9 h-5 rounded-full p-0.5 transition-colors cursor-pointer shrink-0"
      style={{ background: on ? 'var(--ui-accent)' : 'var(--ui-border)' }}
    >
      <div className={`bg-white w-4 h-4 rounded-full transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[10.5px] font-bold tracking-wider uppercase mb-1.5" style={{ color: 'var(--ui-muted)' }}>{children}</div>;
}

const rowCls = 'flex items-center justify-between gap-3 py-1 text-xs';

/* ------------------------------------------------------------------ 匯出 */
export interface ExportOptions {
  palette: PaletteName;
  includeConstruction: boolean;
  includeAnnotations: boolean;
  titleBlock: boolean;
  /** 一併輸出軌跡模擬結果（掃掠範圍、輪跡、標註） */
  includeSimulation: boolean;
}

export function ExportPanel(props: {
  options: ExportOptions;
  setOptions: (o: ExportOptions) => void;
  projectName: string;
  setProjectName: (s: string) => void;
  onPng: () => void;
  onDxf: () => void;
  onCsv: () => void;
  hiddenCount: number;
}) {
  const { options: o, setOptions } = props;
  const btn = 'flex items-center gap-2 w-full px-3 py-2 text-xs rounded-lg cursor-pointer transition-colors text-left';
  return (
    <div className="space-y-3 text-[color:var(--ui-text)]" style={{ color: 'var(--ui-text)' }}>
      <div>
        <SectionTitle>圖名</SectionTitle>
        <input
          id="project-name-input"
          value={props.projectName}
          onChange={e => props.setProjectName(e.target.value)}
          className="w-full px-2 py-1.5 text-xs rounded-md outline-none"
          style={{ background: 'var(--ui-surface2)', border: '1px solid var(--ui-border)', color: 'var(--ui-text)' }}
        />
      </div>
      <div>
        <SectionTitle>出圖設定</SectionTitle>
        <div className="flex gap-1 p-0.5 rounded-lg mb-1.5" style={{ background: 'var(--ui-surface2)' }}>
          {([['print', '白底列印'], ['screen', '深色簡報']] as [PaletteName, string][]).map(([v, label]) => (
            <button
              key={v}
              id={`export-palette-${v}`}
              onClick={() => setOptions({ ...o, palette: v })}
              className="flex-1 py-1 text-[11px] rounded-md cursor-pointer"
              style={o.palette === v ? { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)' } : { color: 'var(--ui-muted)' }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={rowCls}><span>加上圖框、比例尺、指北針</span><Toggle on={o.titleBlock} onClick={() => setOptions({ ...o, titleBlock: !o.titleBlock })} /></div>
        <div className={rowCls}><span>包含尺寸標註</span><Toggle on={o.includeAnnotations} onClick={() => setOptions({ ...o, includeAnnotations: !o.includeAnnotations })} /></div>
        <div className={rowCls}><span>包含輔助線／輔助圓</span><Toggle on={o.includeConstruction} onClick={() => setOptions({ ...o, includeConstruction: !o.includeConstruction })} /></div>
        <div className={rowCls}><span>包含軌跡模擬（掃掠範圍、輪跡、標註）</span><Toggle id="export-include-sim" on={o.includeSimulation} onClick={() => setOptions({ ...o, includeSimulation: !o.includeSimulation })} /></div>
        {props.hiddenCount > 0 && <p className="text-[10.5px] mt-1" style={{ color: '#f59e0b' }}>有 {props.hiddenCount} 個圖層被隱藏，匯出時不會包含。</p>}
      </div>
      <div className="space-y-1 pt-1" style={{ borderTop: '1px solid var(--ui-border)' }}>
        <button id="export-png-btn" onClick={props.onPng} className={btn} style={{ color: 'var(--ui-text)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--ui-surface2)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <ImageIcon className="w-4 h-4" style={{ color: 'var(--ui-accent)' }} /> <span className="flex-1">工程圖 PNG</span><span className="text-[10px]" style={{ color: 'var(--ui-muted)' }}>簡報、公文</span>
        </button>
        <button id="export-dxf-btn" onClick={props.onDxf} className={btn} style={{ color: 'var(--ui-text)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--ui-surface2)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <FileCode2 className="w-4 h-4" style={{ color: 'var(--ui-accent)' }} /> <span className="flex-1">AutoCAD DXF</span><span className="text-[10px]" style={{ color: 'var(--ui-muted)' }}>分圖層、單位公尺</span>
        </button>
        <button id="export-csv-btn" onClick={props.onCsv} className={btn} style={{ color: 'var(--ui-text)' }} onMouseEnter={e => (e.currentTarget.style.background = 'var(--ui-surface2)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
          <Table className="w-4 h-4" style={{ color: 'var(--ui-accent)' }} /> <span className="flex-1">數量計算表 CSV</span><span className="text-[10px]" style={{ color: 'var(--ui-muted)' }}>長度、面積</span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 檢視設定（網格、鎖點、底圖） */
export interface ViewSettings {
  showGrid: boolean; setShowGrid: (b: boolean) => void;
  minorGridInterval: number; setMinorGridInterval: (n: number) => void;
  majorGridInterval: number; setMajorGridInterval: (n: number) => void;
  snapToGrid: boolean; setSnapToGrid: (b: boolean) => void;
  snapToEndpoint: boolean; setSnapToEndpoint: (b: boolean) => void;
  snapToMidpoint: boolean; setSnapToMidpoint: (b: boolean) => void;
  snapToNearest: boolean; setSnapToNearest: (b: boolean) => void;
  snapToIntersection: boolean; setSnapToIntersection: (b: boolean) => void;
  bgImage: any; setBgImage: (v: any) => void;
  onUploadBg: (file: File) => void;
  isCalibrating: boolean; onCalibrate: () => void;
}

export function SettingsPanel({ v, sections = ['grid', 'snap', 'bg'] }: { v: ViewSettings; sections?: ('grid' | 'snap' | 'bg')[] }) {
  const chip = (active: boolean) => ({
    background: active ? 'var(--ui-accent)' : 'var(--ui-surface2)',
    color: active ? 'var(--ui-accent-text)' : 'var(--ui-muted)',
    border: '1px solid var(--ui-border)',
  });
  return (
    <div className="space-y-4" style={{ color: 'var(--ui-text)' }}>
      {sections.includes('snap') && (
        <div>
          <SectionTitle>鎖點</SectionTitle>
          {[
            ['端點', v.snapToEndpoint, v.setSnapToEndpoint, 'snap-endpoint'],
            ['中點', v.snapToMidpoint, v.setSnapToMidpoint, 'snap-midpoint'],
            ['交點', v.snapToIntersection, v.setSnapToIntersection, 'snap-intersection'],
            ['最近點／垂足', v.snapToNearest, v.setSnapToNearest, 'snap-nearest'],
            ['網格', v.snapToGrid, v.setSnapToGrid, 'snap-grid'],
          ].map(([label, on, set, id]: any) => (
            <div key={label} className={rowCls}><span>{label}</span><Toggle id={id} on={on} onClick={() => set(!on)} /></div>
          ))}
          <p className="text-[10.5px] mt-1" style={{ color: 'var(--ui-muted)' }}>繪製時按住 Shift 可鎖定水平／垂直。</p>
        </div>
      )}
      {sections.includes('grid') && (
        <div>
          <SectionTitle>網格</SectionTitle>
          <div className={rowCls}><span>顯示網格</span><Toggle on={v.showGrid} onClick={() => v.setShowGrid(!v.showGrid)} /></div>
          {v.showGrid && (
            <>
              <div className="text-[11px] mt-1 mb-1" style={{ color: 'var(--ui-muted)' }}>細網格</div>
              <div className="grid grid-cols-5 gap-1">
                {[0, 0.2, 0.5, 1, 2].map(n => (
                  <button key={n} onClick={() => { v.setMinorGridInterval(n); if (n > 0 && n >= v.majorGridInterval) v.setMajorGridInterval(n * 5); }} className="py-1 text-[10px] rounded font-mono cursor-pointer" style={chip(v.minorGridInterval === n)}>{n === 0 ? '無' : `${n}m`}</button>
                ))}
              </div>
              <div className="text-[11px] mt-2 mb-1" style={{ color: 'var(--ui-muted)' }}>粗網格</div>
              <div className="grid grid-cols-5 gap-1">
                {[0, 2, 5, 10, 20].map(n => (
                  <button key={n} disabled={n !== 0 && v.minorGridInterval !== 0 && n <= v.minorGridInterval} onClick={() => v.setMajorGridInterval(n)} className="py-1 text-[10px] rounded font-mono cursor-pointer disabled:opacity-30" style={chip(v.majorGridInterval === n)}>{n === 0 ? '無' : `${n}m`}</button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {sections.includes('bg') && (
        <div>
          <SectionTitle>底圖</SectionTitle>
          {!v.bgImage ? (
            <label className="flex items-center justify-center gap-2 py-3 rounded-lg text-xs cursor-pointer" style={{ border: '1px dashed var(--ui-border)', color: 'var(--ui-muted)' }}>
              <Upload className="w-4 h-4" />
              <span>上傳航照或現況圖</span>
              <input id="bg-image-uploader" type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) v.onUploadBg(f); e.target.value = ''; }} />
            </label>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="truncate" style={{ color: 'var(--ui-muted)' }}>{v.bgImage.fileName || '底圖'}（{v.bgImage.widthMeters.toFixed(1)} × {v.bgImage.heightMeters.toFixed(1)} m）</div>
              <label className="flex items-center gap-2">
                <span className="shrink-0">不透明度</span>
                <input type="range" min="0.1" max="1" step="0.05" value={v.bgImage.opacity || 0.6} onChange={e => { const n = parseFloat(e.target.value); v.setBgImage((prev: any) => prev ? { ...prev, opacity: n } : null); }} />
                <span className="font-mono w-9 text-right">{Math.round((v.bgImage.opacity || 0.6) * 100)}%</span>
              </label>
              <div className="flex gap-2">
                <button onClick={v.onCalibrate} className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md cursor-pointer" style={{ background: v.isCalibrating ? '#7f1d1d' : 'var(--ui-surface2)', border: '1px solid var(--ui-border)' }}>
                  <Ruler className="w-3.5 h-3.5" />{v.isCalibrating ? '取消校正' : v.bgImage.isCalibrated ? '重新校正比例' : '校正比例尺'}
                </button>
                <button onClick={() => v.setBgImage(null)} className="px-2.5 rounded-md cursor-pointer" style={{ background: 'var(--ui-surface2)', border: '1px solid var(--ui-border)' }} title="移除底圖">
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 圖層 */
export function LayerPanel({ elements, hidden, onToggle, onShowAll, extra }: { elements: CadElement[]; hidden: string[]; onToggle: (k: string) => void; onShowAll: () => void; extra?: React.ReactNode }) {
  const counts = new Map<string, number>();
  elements.forEach(el => { const k = layerKeyOf(el); counts.set(k, (counts.get(k) || 0) + 1); });
  hidden.forEach(k => { if (!counts.has(k)) counts.set(k, 0); });
  const keys = Array.from(counts.keys()).sort((a, b) => (LAYERS[a]?.desc || a).localeCompare(LAYERS[b]?.desc || b, 'zh-Hant'));
  return (
    <div style={{ color: 'var(--ui-text)' }}>
      <div className="flex items-center justify-between mb-2">
        <SectionTitle>圖層（{keys.length}）</SectionTitle>
        {hidden.length > 0 && <button onClick={onShowAll} className="text-[11px] cursor-pointer" style={{ color: 'var(--ui-accent)' }}>全部顯示</button>}
      </div>
      {keys.length === 0 && <p className="text-xs py-6 text-center" style={{ color: 'var(--ui-muted)' }}>畫布上還沒有物件</p>}
      <div className="space-y-0.5">
        {keys.map(k => {
          const isHidden = hidden.includes(k);
          const def = LAYERS[k];
          return (
            <button key={k} id={`layer-toggle-${k}`} onClick={() => onToggle(k)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs cursor-pointer text-left" style={{ opacity: isHidden ? 0.45 : 1 }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--ui-surface2)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              {isHidden ? <EyeOff className="w-3.5 h-3.5 shrink-0" /> : <Eye className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--ui-accent)' }} />}
              <span className="flex-1 truncate">{def?.desc || k}</span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--ui-muted)' }}>{counts.get(k)}</span>
            </button>
          );
        })}
      </div>
      {extra}
      <p className="text-[10.5px] mt-3" style={{ color: 'var(--ui-muted)' }}>隱藏的圖層不會顯示、不能選取，也不會匯出。DXF 匯出時每個圖層有獨立名稱與顏色。</p>
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
    <div id="arrow-type-bar" className="absolute left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 p-1 rounded-xl shadow-2xl" style={{ background: 'var(--ui-surface)', border: '1px solid var(--ui-border)', backdropFilter: 'blur(12px)', ...style }}>
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
    <div className="fixed inset-0 z-[400] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div id="confirm-dialog" className="w-full max-w-sm rounded-2xl p-5 shadow-2xl bg-[#14161c] border border-[#2d3039] text-slate-200" onClick={e => e.stopPropagation()}>
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
    <div id="autosave-banner" className="fixed top-14 left-1/2 -translate-x-1/2 z-[350] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl bg-[#14161c] border border-amber-500/50 text-slate-200 text-xs max-w-xl">
      <History className="w-4 h-4 text-amber-400 shrink-0" />
      <span className="flex-1">找到上次自動儲存的內容（{when}，{n} 個物件）。要還原嗎？</span>
      <button id="autosave-restore-btn" onClick={onRestore} className="px-3 py-1 rounded-lg bg-amber-500 text-black font-bold cursor-pointer">還原</button>
      <button id="autosave-discard-btn" onClick={onDiscard} className="px-3 py-1 rounded-lg border border-[#2d3039] hover:bg-white/5 cursor-pointer">捨棄</button>
    </div>
  );
}
