import React from 'react';
import { MousePointer2, Waypoints, Route, PenTool, Paintbrush } from 'lucide-react';
import { SimTool, useSimStore } from '../store';

export interface SimToolDef {
  id: SimTool;
  label: string;
  key: string;
  desc: string;
  recommended?: boolean;
  icon: React.ReactNode;
}

export const SIM_TOOLS: SimToolDef[] = [
  { id: 'polyline', label: '點選＋半徑', key: 'P', recommended: true, desc: '依序點節點，轉角以指定半徑圓弧（可加緩和曲線）連接，適合正式檢核', icon: <Waypoints className="w-4 h-4" /> },
  { id: 'intersection', label: '路口轉彎', key: 'I', recommended: true, desc: '指定進入與離開路口的位置和方向，自動產生轉彎曲線', icon: <Route className="w-4 h-4" /> },
  { id: 'pen', label: '鋼筆曲線', key: 'N', desc: '貝茲曲線自由造型，可拉切線與尖角', icon: <PenTool className="w-4 h-4" /> },
  { id: 'freehand', label: '筆刷手繪', key: 'B', desc: '快速手繪草擬，會自動去除抖動', icon: <Paintbrush className="w-4 h-4" /> },
];

const SELECT_DEF = { id: 'select' as SimTool, label: '選取與編輯', key: 'V', desc: '點選軌跡；拖曳節點、◆半徑把手或整條軌跡；雙擊線段插入節點', icon: <MousePointer2 className="w-4 h-4" /> };

/** B・直覺：與 CAD 工具列相同的帶文字側欄 */
export function GuidedSimSidebar() {
  const store = useSimStore();
  const tool = store.ui.tool;
  return (
    <div id="sim-tool-sidebar" className="w-60 h-full flex flex-col shrink-0" style={{ background: 'var(--ui-surface)', borderRight: '1px solid var(--ui-border)' }}>
      <div className="p-3 pb-2">
        <button
          id="sim-tool-select"
          onClick={() => store.setTool('select')}
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] cursor-pointer"
          style={tool === 'select' ? { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)', fontWeight: 700 } : { color: 'var(--ui-text)' }}
          title={SELECT_DEF.desc}
        >
          <MousePointer2 className="w-4 h-4" /> {SELECT_DEF.label} <span className="ml-auto text-[10px] opacity-70">V</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="px-1.5 py-1.5 text-[11px] font-bold" style={{ color: 'var(--ui-muted)' }}>繪製車輛軌跡</div>
        {SIM_TOOLS.map(t => {
          const active = tool === t.id;
          return (
            <button
              key={t.id}
              id={`sim-tool-${t.id}`}
              onClick={() => store.setTool(t.id)}
              title={t.desc}
              className="w-full flex items-start gap-2.5 px-2 py-1.5 rounded-lg text-left cursor-pointer transition-colors"
              style={active ? { background: 'var(--ui-accent-soft)', color: 'var(--ui-text)', boxShadow: 'inset 3px 0 0 var(--ui-accent)' } : { color: 'var(--ui-text)' }}
              onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--ui-surface2)'; }}
              onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
            >
              <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ color: active ? 'var(--ui-accent)' : 'var(--ui-muted)' }}>{t.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[12.5px] leading-tight">
                  {t.label}
                  {t.recommended && <span className="text-[9.5px] px-1 rounded" style={{ background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)' }}>建議</span>}
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--ui-muted)' }}>{t.key}</span>
                </span>
                {active && <span className="block text-[10.5px] leading-snug mt-0.5" style={{ color: 'var(--ui-muted)' }}>{t.desc}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <WorkflowCard />
    </div>
  );
}

/** 三步驟流程提示（側欄底部） */
export function WorkflowCard() {
  const store = useSimStore();
  const steps: [string, string, 'vehicle' | 'path' | 'result'][] = [
    ['1', '選車種', 'vehicle'],
    ['2', '畫路徑', 'path'],
    ['3', '看結果', 'result'],
  ];
  return (
    <div className="p-3" style={{ borderTop: '1px solid var(--ui-border)' }}>
      <div className="text-[10.5px] font-bold mb-1.5" style={{ color: 'var(--ui-muted)' }}>檢核流程</div>
      <div className="flex gap-1">
        {steps.map(([n, label, tab]) => (
          <button key={tab} onClick={() => store.setUi({ rightTab: tab })} className="flex-1 flex flex-col items-center py-1.5 rounded-lg cursor-pointer text-[11px]"
            style={store.ui.rightTab === tab ? { background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)' } : { background: 'var(--ui-surface2)', color: 'var(--ui-text)' }}>
            <span className="text-[10px] font-bold opacity-70">{n}</span>{label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A・簡潔：細窄圖示列 */
export function MinimalSimRail() {
  const store = useSimStore();
  const tool = store.ui.tool;
  const btn = (t: { id: SimTool; label: string; key: string; icon: React.ReactNode }) => {
    const active = tool === t.id;
    return (
      <div key={t.id} className="relative group">
        <button
          id={`sim-tool-${t.id}`}
          onClick={() => store.setTool(t.id)}
          className="w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer transition-colors"
          style={active ? { background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)', boxShadow: 'inset 0 0 0 1px var(--ui-accent)' } : { color: 'var(--ui-muted)' }}
          aria-label={t.label}
        >
          {t.icon}
        </button>
        <span className="ui-tip left-12 top-2">{t.label}（{t.key}）</span>
      </div>
    );
  };
  return (
    <div id="sim-tool-sidebar" className="relative w-14 h-full flex flex-col items-center py-2 gap-1 shrink-0" style={{ background: 'var(--ui-surface)', borderRight: '1px solid var(--ui-border)' }}>
      {btn(SELECT_DEF)}
      <div className="w-6 my-1" style={{ borderTop: '1px solid var(--ui-border)' }} />
      {SIM_TOOLS.map(btn)}
    </div>
  );
}

/** C・美觀：底部浮動 Dock */
export function PolishedSimDock() {
  const store = useSimStore();
  const tool = store.ui.tool;
  const all = [SELECT_DEF, ...SIM_TOOLS];
  const def = all.find(t => t.id === tool);
  return (
    <div id="sim-tool-sidebar" className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
      <div className="glass rounded-2xl px-2 py-1.5 flex items-center gap-1">
        {all.map((t, i) => {
          const active = tool === t.id;
          return (
            <React.Fragment key={t.id}>
              {i === 1 && <div className="w-px h-8 mx-1" style={{ background: 'var(--ui-border)' }} />}
              <button id={`sim-tool-${t.id}`} onClick={() => store.setTool(t.id)} title={t.desc}
                className={`h-11 px-3 rounded-xl flex items-center gap-2 cursor-pointer transition-all ${active ? 'accent-gradient shadow-lg' : 'hover:bg-white/10'}`}
                style={active ? {} : { color: 'var(--ui-text)' }}>
                {t.icon}
                <span className="text-[12px] font-medium whitespace-nowrap">{t.label}</span>
              </button>
            </React.Fragment>
          );
        })}
      </div>
      {def && def.id !== 'select' && (
        <div className="glass rounded-full px-3 py-1 text-[11px]" style={{ color: 'var(--ui-muted)' }}>{def.desc}</div>
      )}
    </div>
  );
}
