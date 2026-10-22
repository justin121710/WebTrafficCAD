import React, { useState } from 'react';
import { Truck, Route, ListChecks } from 'lucide-react';

const KEY = 'webtrafficcad.simTourSeen';

export function simTourSeen(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
}

/** 第一次進入軌跡模擬時的三步驟導覽 */
export default function SimTour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const steps = [
    { icon: <Truck className="w-6 h-6" />, title: '① 選車種', body: '在右側「車輛」選擇設計車種（小客車、單體貨車、市區公車、半聯結車），可勾選多個車種套疊比較。修改尺寸會自動另存為自訂車種。' },
    { icon: <Route className="w-6 h-6" />, title: '② 畫路徑', body: '左側建議用「點選＋半徑」：依序點節點，轉角自動以指定半徑圓弧連接；或用「路口轉彎」指定進出路口的位置與方向。Enter 完成、Esc 取消、Ctrl+Z 復原。' },
    { icon: <ListChecks className="w-6 h-6" />, title: '③ 看結果', body: '掃掠範圍與淨距帶會立即完整顯示；右側「結果」列出轉角、迴轉半徑、內輪差、掃掠寬度與衝突位置，可匯出檢核表，DXF／PNG 也會一併輸出。' },
  ];
  const close = () => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } onClose(); };
  const s = steps[i];
  return (
    <div className="fixed inset-0 z-[300] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={close}>
      <div id="sim-tour" className="w-full max-w-md rounded-2xl p-5 shadow-2xl" style={{ background: 'var(--ui-surface, #14161c)', border: '1px solid var(--ui-border, #2d3039)', color: 'var(--ui-text, #e2e8f0)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <span className="w-11 h-11 rounded-xl flex items-center justify-center" style={{ background: 'var(--ui-accent-soft, rgba(59,130,246,.15))', color: 'var(--ui-accent, #3b82f6)' }}>{s.icon}</span>
          <div>
            <div className="text-[11px]" style={{ color: 'var(--ui-muted, #94a3b8)' }}>軌跡模擬快速導覽 {i + 1}／{steps.length}</div>
            <h3 className="text-base font-bold">{s.title}</h3>
          </div>
        </div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ui-muted, #94a3b8)' }}>{s.body}</p>
        <div className="flex items-center gap-2 mt-5">
          <div className="flex gap-1 flex-1">{steps.map((_, k) => <span key={k} className="w-2 h-2 rounded-full" style={{ background: k === i ? 'var(--ui-accent, #3b82f6)' : 'var(--ui-border, #2d3039)' }} />)}</div>
          <button onClick={close} className="px-3 py-1.5 text-xs rounded-lg cursor-pointer" style={{ color: 'var(--ui-muted, #94a3b8)' }}>略過</button>
          <button id="sim-tour-next" onClick={() => (i < steps.length - 1 ? setI(i + 1) : close())} className="px-4 py-1.5 text-xs rounded-lg font-bold cursor-pointer" style={{ background: 'var(--ui-accent, #3b82f6)', color: 'var(--ui-accent-text, #fff)' }}>
            {i < steps.length - 1 ? '下一步' : '開始使用'}
          </button>
        </div>
      </div>
    </div>
  );
}
