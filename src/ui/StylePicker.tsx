import { useState } from 'react';
import { Palette, Check, X } from 'lucide-react';
import { UI_STYLES, UiStyle } from './uiStyle';

/** 各風格的示意縮圖 */
function Thumb({ id }: { id: UiStyle }) {
  const bg = '#0f1115';
  const line = '#3b4252';
  const accent = id === 'minimal' ? '#4f8cff' : id === 'guided' ? '#4a86e8' : id === 'polished' ? '#7c8cf0' : '#3b82f6';
  return (
    <svg viewBox="0 0 160 96" className="w-full rounded-md" style={{ background: bg }}>
      {id === 'classic' && (
        <>
          <rect x="0" y="0" width="160" height="10" fill="#1b1e25" />
          <rect x="0" y="10" width="20" height="86" fill="#14161c" />
          {[0, 1, 2, 3, 4, 5].map(i => <rect key={i} x="4" y={16 + i * 12} width="12" height="8" rx="2" fill={line} />)}
          <rect x="124" y="10" width="36" height="86" fill="#14161c" />
          <rect x="128" y="16" width="28" height="22" rx="2" fill={line} />
        </>
      )}
      {id === 'minimal' && (
        <>
          <rect x="0" y="0" width="160" height="9" fill="#141518" />
          <rect x="120" y="2" width="16" height="5" rx="2" fill={line} />
          <rect x="140" y="2" width="16" height="5" rx="2" fill={line} />
          <rect x="0" y="9" width="12" height="87" fill="#141518" />
          {[0, 1, 2, 3, 4].map(i => <rect key={i} x="3" y={15 + i * 11} width="6" height="6" rx="1.5" fill={i === 1 ? accent : line} />)}
        </>
      )}
      {id === 'guided' && (
        <>
          <rect x="0" y="0" width="160" height="11" fill="#171b22" />
          {[0, 1, 2].map(i => <rect key={i} x={50 + i * 22} y="3" width="18" height="5" rx="2" fill={line} />)}
          <rect x="0" y="11" width="42" height="85" fill="#171b22" />
          <rect x="4" y="15" width="34" height="6" rx="2" fill="#262c36" />
          {[0, 1, 2, 3, 4, 5].map(i => (
            <g key={i}>
              <rect x="5" y={26 + i * 10} width="5" height="5" rx="1" fill={i === 2 ? accent : line} />
              <rect x="13" y={27 + i * 10} width="22" height="3" rx="1" fill={i === 2 ? accent : '#4b5563'} />
            </g>
          ))}
          <rect x="118" y="11" width="42" height="85" fill="#171b22" />
          {[0, 1, 2].map(i => <rect key={i} x={121 + i * 13} y="14" width="11" height="5" rx="2" fill={i === 0 ? accent : line} />)}
          <rect x="42" y="88" width="76" height="8" fill="#141820" />
        </>
      )}
      {id === 'polished' && (
        <>
          <rect x="45" y="4" width="70" height="9" rx="4.5" fill="#1e2433" stroke="#334155" strokeWidth="0.5" />
          <rect x="47" y="6" width="20" height="5" rx="2.5" fill={accent} />
          <rect x="35" y="80" width="90" height="12" rx="6" fill="#1e2433" stroke="#334155" strokeWidth="0.5" />
          {[0, 1, 2, 3, 4, 5].map(i => <circle key={i} cx={46 + i * 14} cy="86" r="3.2" fill={i === 1 ? accent : line} />)}
          <rect x="118" y="18" width="38" height="50" rx="5" fill="#1e2433" stroke="#334155" strokeWidth="0.5" />
        </>
      )}
      <line x1="30" y1="52" x2="115" y2="52" stroke="#f59e0b" strokeWidth="1.2" />
      <line x1="30" y1="44" x2="115" y2="44" stroke="#fff" strokeWidth="0.8" strokeDasharray="4 6" />
      <line x1="30" y1="60" x2="115" y2="60" stroke="#fff" strokeWidth="0.8" strokeDasharray="4 6" />
    </svg>
  );
}

interface Props {
  value: UiStyle;
  onChange: (s: UiStyle) => void;
  /** 觸發按鈕外觀 */
  buttonClassName?: string;
  compact?: boolean;
}

/** 介面風格切換：開啟後可比較四種版面並即時套用 */
export default function StylePicker({ value, onChange, buttonClassName, compact }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        id="ui-style-picker-btn"
        onClick={() => setOpen(true)}
        className={buttonClassName || 'flex items-center gap-1.5 h-8 px-3 text-xs rounded border border-[#2d3039] bg-[#1f2229] text-slate-300 hover:bg-slate-800 cursor-pointer shrink-0'}
        title="切換介面風格（經典／簡潔／直覺／美觀）"
      >
        <Palette className="w-3.5 h-3.5" />
        {!compact && <span className="hidden xl:inline">介面風格</span>}
      </button>
      {open && (
        <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div
            id="ui-style-picker-dialog"
            className="w-full max-w-4xl bg-[#14161c] border border-[#2d3039] rounded-lg shadow-lg p-5 text-slate-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-bold">選擇介面風格</h2>
              <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-white/5 cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-xs text-slate-400 mb-4">四種版面功能相同，切換不影響圖面。選擇會記在此瀏覽器。</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {UI_STYLES.map(s => {
                const active = s.id === value;
                return (
                  <button
                    key={s.id}
                    id={`ui-style-option-${s.id}`}
                    onClick={() => { onChange(s.id); setOpen(false); }}
                    className={`text-left rounded-lg border p-3 transition-all cursor-pointer ${active ? 'border-blue-500 bg-blue-500/10' : 'border-[#2d3039] hover:border-slate-500 bg-[#0f1115]'}`}
                  >
                    <Thumb id={s.id} />
                    <div className="flex items-center justify-between mt-2.5">
                      <span className="text-sm font-bold">{s.name}</span>
                      {active && <Check className="w-4 h-4 text-blue-300" />}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{s.tagline}</div>
                    <ul className="mt-2 space-y-0.5">
                      {s.points.map(pt => <li key={pt} className="text-[10.5px] text-slate-500">・{pt}</li>)}
                    </ul>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
