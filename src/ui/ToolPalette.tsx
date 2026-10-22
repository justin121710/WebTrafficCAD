import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, MousePointer2, LayoutGrid, ChevronDown, ChevronRight, X, Sparkles } from 'lucide-react';
import { CadTool } from '../types';
import { renderToolIcon } from '../components/Toolbar';
import { TOOL_CATEGORIES, ALL_TOOLS, ESSENTIAL_TOOLS, ToolDef } from './toolCatalog';

interface Props {
  activeTool: CadTool;
  setActiveTool: (t: CadTool) => void;
  onLoadTemplate: () => void;
}

const SelectIcon = () => <MousePointer2 className="w-5 h-5" />;

function matches(t: ToolDef, q: string) {
  if (!q) return true;
  const s = `${t.label}${t.desc}${t.keywords || ''}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every(w => s.includes(w));
}

/* ======================================================= A・簡潔：細窄工具列＋更多工具 */
export function MinimalToolRail({ activeTool, setActiveTool, onLoadTemplate }: Props) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [q, setQ] = useState('');
  const isEssential = ESSENTIAL_TOOLS.includes(activeTool) || activeTool === 'select';
  const activeDef = ALL_TOOLS.find(t => t.id === activeTool);
  const railBtn = (id: CadTool, label: string, icon: React.ReactNode) => {
    const active = activeTool === id;
    return (
      <div key={id} className="relative group">
        <button
          id={`tool-btn-${id}`}
          onClick={() => setActiveTool(id)}
          className="w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer transition-colors"
          style={active ? { background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)', boxShadow: 'inset 0 0 0 1px var(--ui-accent)' } : { color: 'var(--ui-muted)' }}
          aria-label={label}
        >
          <div className="scale-[0.85]">{icon}</div>
        </button>
        <span className="ui-tip left-12 top-2">{label}</span>
      </div>
    );
  };
  return (
    <div id="left-toolbar" className="relative w-14 h-full flex flex-col items-center py-2 gap-1 shrink-0" style={{ background: 'var(--ui-surface)', borderRight: '1px solid var(--ui-border)' }}>
      {railBtn('select', '選取（V）', <SelectIcon />)}
      <div className="w-6 my-1" style={{ borderTop: '1px solid var(--ui-border)' }} />
      {ESSENTIAL_TOOLS.map(id => railBtn(id, ALL_TOOLS.find(t => t.id === id)!.label, renderToolIcon(id)))}
      {!isEssential && activeDef && railBtn(activeDef.id, activeDef.label, renderToolIcon(activeDef.id))}
      <div className="flex-1" />
      <div className="relative group">
        <button id="more-tools-btn" onClick={() => setMoreOpen(!moreOpen)} className="w-10 h-10 rounded-lg flex items-center justify-center cursor-pointer" style={{ color: moreOpen ? 'var(--ui-accent)' : 'var(--ui-muted)', background: moreOpen ? 'var(--ui-accent-soft)' : 'transparent' }}>
          <LayoutGrid className="w-5 h-5" />
        </button>
        <span className="ui-tip left-12 top-2">更多工具</span>
      </div>
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
          <div id="more-tools-panel" className="absolute left-16 bottom-2 z-50 w-[420px] max-h-[80vh] overflow-y-auto rounded-xl p-3 shadow-2xl" style={{ background: 'var(--ui-surface)', border: '1px solid var(--ui-border)' }}>
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg mb-3" style={{ background: 'var(--ui-surface2)' }}>
              <Search className="w-3.5 h-3.5" style={{ color: 'var(--ui-muted)' }} />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="搜尋工具…" className="flex-1 bg-transparent text-xs outline-none" style={{ color: 'var(--ui-text)' }} />
            </div>
            {TOOL_CATEGORIES.map(cat => {
              const tools = cat.tools.filter(t => matches(t, q));
              if (!tools.length) return null;
              return (
                <div key={cat.key} className="mb-3">
                  <div className="text-[10.5px] font-bold mb-1.5 px-1" style={{ color: 'var(--ui-muted)' }}>{cat.title}</div>
                  <div className="grid grid-cols-4 gap-1">
                    {tools.map(t => (
                      <button key={t.id} id={`tool-btn-more-${t.id}`} title={t.desc} onClick={() => { setActiveTool(t.id); setMoreOpen(false); setQ(''); }}
                        className="flex flex-col items-center gap-1 py-2 rounded-lg cursor-pointer"
                        style={activeTool === t.id ? { background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)' } : { color: 'var(--ui-text)' }}>
                        <div className="scale-90">{renderToolIcon(t.id)}</div>
                        <span className="text-[10.5px] leading-tight text-center">{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <button onClick={() => { onLoadTemplate(); setMoreOpen(false); }} className="w-full py-2 text-xs rounded-lg cursor-pointer" style={{ border: '1px dashed var(--ui-border)', color: 'var(--ui-muted)' }}>載入十字路口範本</button>
          </div>
        </>
      )}
    </div>
  );
}

/* ======================================================= B・直覺：文字標籤＋分類＋搜尋 */
export function GuidedToolSidebar({ activeTool, setActiveTool, onLoadTemplate }: Props) {
  const [q, setQ] = useState('');
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const filtered = useMemo(() => TOOL_CATEGORIES.map(c => ({ ...c, tools: c.tools.filter(t => matches(t, q)) })).filter(c => c.tools.length), [q]);
  const pick = (id: CadTool) => { setActiveTool(id); };
  return (
    <div id="left-toolbar" className="w-60 h-full flex flex-col shrink-0" style={{ background: 'var(--ui-surface)', borderRight: '1px solid var(--ui-border)' }}>
      <div className="p-3 pb-2">
        <div className="flex items-center gap-2 px-2.5 py-2 rounded-lg" style={{ background: 'var(--ui-surface2)', border: '1px solid var(--ui-border)' }}>
          <Search className="w-4 h-4" style={{ color: 'var(--ui-muted)' }} />
          <input
            id="tool-search-input"
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { const first = filtered[0]?.tools[0]; if (first) { pick(first.id); setQ(''); (e.target as HTMLInputElement).blur(); } }
              if (e.key === 'Escape') { setQ(''); (e.target as HTMLInputElement).blur(); }
            }}
            placeholder="搜尋工具（例：停止線、機車）"
            className="flex-1 bg-transparent text-xs outline-none min-w-0"
            style={{ color: 'var(--ui-text)' }}
          />
          <kbd className="text-[10px] px-1 rounded" style={{ color: 'var(--ui-muted)', border: '1px solid var(--ui-border)' }}>Ctrl K</kbd>
        </div>
        <button
          id="tool-btn-select"
          onClick={() => pick('select')}
          className="mt-2 w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-[13px] cursor-pointer"
          style={activeTool === 'select' ? { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)', fontWeight: 700 } : { color: 'var(--ui-text)' }}
        >
          <MousePointer2 className="w-4 h-4" /> 選取與編輯 <span className="ml-auto text-[10px] opacity-70">V</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {filtered.map(cat => {
          const isCollapsed = collapsed.includes(cat.key) && !q;
          return (
            <div key={cat.key} className="mb-1">
              <button onClick={() => setCollapsed(c => c.includes(cat.key) ? c.filter(k => k !== cat.key) : [...c, cat.key])} className="w-full flex items-center gap-1 px-1.5 py-1.5 text-[11px] font-bold cursor-pointer" style={{ color: 'var(--ui-muted)' }}>
                {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {cat.title}
                <span className="ml-auto font-normal">{cat.tools.length}</span>
              </button>
              {!isCollapsed && cat.tools.map(t => {
                const active = activeTool === t.id;
                return (
                  <button
                    key={t.id}
                    id={`tool-btn-${t.id}`}
                    onClick={() => pick(t.id)}
                    title={t.desc}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left cursor-pointer transition-colors"
                    style={active ? { background: 'var(--ui-accent-soft)', color: 'var(--ui-text)', boxShadow: 'inset 3px 0 0 var(--ui-accent)' } : { color: 'var(--ui-text)' }}
                    onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--ui-surface2)'; }}
                    onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span className="w-7 h-7 rounded-md flex items-center justify-center shrink-0 scale-[0.8]" style={{ color: active ? 'var(--ui-accent)' : 'var(--ui-muted)' }}>{renderToolIcon(t.id)}</span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px] leading-tight">{t.label}</span>
                      {active && <span className="block text-[10.5px] leading-tight mt-0.5" style={{ color: 'var(--ui-muted)' }}>{t.desc}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          );
        })}
        {filtered.length === 0 && <p className="text-xs text-center py-6" style={{ color: 'var(--ui-muted)' }}>找不到「{q}」</p>}
      </div>
      <div className="p-3" style={{ borderTop: '1px solid var(--ui-border)' }}>
        <button id="load-template-btn" onClick={onLoadTemplate} className="w-full flex items-center justify-center gap-2 py-2 text-xs rounded-lg cursor-pointer" style={{ border: '1px dashed var(--ui-border)', color: 'var(--ui-muted)' }}>
          <Sparkles className="w-3.5 h-3.5" /> 從十字路口範本開始
        </button>
      </div>
    </div>
  );
}

/* ======================================================= C・美觀：底部浮動 Dock＋分類彈出 */
export function PolishedDock({ activeTool, setActiveTool, onLoadTemplate }: Props) {
  const [openCat, setOpenCat] = useState<string | null>(null);
  const activeCat = TOOL_CATEGORIES.find(c => c.tools.some(t => t.id === activeTool))?.key;
  const activeDef = ALL_TOOLS.find(t => t.id === activeTool);
  // Dock 有 transform，fixed 遮罩會被侷限，改用全域監聽關閉彈出面板
  useEffect(() => {
    if (!openCat) return;
    const onDown = (e: PointerEvent) => { if (!(e.target as HTMLElement).closest('#left-toolbar')) setOpenCat(null); };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [openCat]);
  const catIcon: Record<string, CadTool> = { longitudinal: 'yellow_double', transverse: 'stop_line', zones: 'channelization', parking: 'parking_space', symbols: 'road_arrow', tools: 'measurement' };
  return (
    <div id="left-toolbar" className="absolute bottom-5 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2">
      {openCat && (
        <>
          <div id="dock-popover" className="glass rounded-2xl p-2.5 flex gap-1.5 flex-wrap justify-center max-w-[640px]">
            {TOOL_CATEGORIES.find(c => c.key === openCat)!.tools.map(t => {
              const active = activeTool === t.id;
              return (
                <button key={t.id} id={`tool-btn-${t.id}`} title={t.desc} onClick={() => { setActiveTool(t.id); setOpenCat(null); }}
                  className={`w-[84px] flex flex-col items-center gap-1.5 py-2.5 rounded-xl cursor-pointer transition-all ${active ? 'accent-gradient shadow-lg' : 'hover:bg-white/10'}`}
                  style={active ? {} : { color: 'var(--ui-text)' }}>
                  {renderToolIcon(t.id)}
                  <span className="text-[11px] leading-tight text-center px-1">{t.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className="glass rounded-2xl px-2 py-1.5 flex items-center gap-1">
        <button id="tool-btn-select" onClick={() => { setActiveTool('select'); setOpenCat(null); }} title="選取（V）"
          className={`w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer transition-all ${activeTool === 'select' ? 'accent-gradient shadow-lg' : 'hover:bg-white/10'}`}
          style={activeTool === 'select' ? {} : { color: 'var(--ui-text)' }}>
          <MousePointer2 className="w-5 h-5" />
        </button>
        <div className="w-px h-8 mx-1" style={{ background: 'var(--ui-border)' }} />
        {TOOL_CATEGORIES.map(c => {
          const isActive = activeCat === c.key;
          const isOpen = openCat === c.key;
          return (
            <button key={c.key} id={`dock-cat-${c.key}`} onClick={() => setOpenCat(isOpen ? null : c.key)}
              className={`h-11 px-2.5 rounded-xl flex items-center gap-2 cursor-pointer transition-all ${isOpen ? 'bg-white/15' : 'hover:bg-white/10'}`}
              style={{ color: isActive ? 'var(--ui-accent)' : 'var(--ui-text)' }}>
              <span className="scale-90">{renderToolIcon(isActive && activeDef ? activeDef.id : catIcon[c.key])}</span>
              <span className="text-[12px] font-medium whitespace-nowrap">{c.title}</span>
            </button>
          );
        })}
        <div className="w-px h-8 mx-1" style={{ background: 'var(--ui-border)' }} />
        <button id="load-template-btn" onClick={onLoadTemplate} title="載入十字路口範本" className="w-11 h-11 rounded-xl flex items-center justify-center cursor-pointer hover:bg-white/10" style={{ color: 'var(--ui-muted)' }}>
          <Sparkles className="w-5 h-5" />
        </button>
      </div>
      {activeDef && (
        <div className="glass rounded-full px-3 py-1 text-[11px] flex items-center gap-2" style={{ color: 'var(--ui-text)' }}>
          <span className="font-bold">{activeDef.label}</span>
          <span style={{ color: 'var(--ui-muted)' }}>{activeDef.desc}</span>
          <button onClick={() => setActiveTool('select')} className="cursor-pointer" title="結束工具（Esc）"><X className="w-3 h-3" /></button>
        </div>
      )}
    </div>
  );
}
