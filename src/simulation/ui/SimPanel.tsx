import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Copy, Trash2, Crosshair, ChevronDown, ChevronRight, FileDown, Printer, Info } from 'lucide-react';
import { SectionTitle, Toggle } from '../../ui/Panels';
import { DRAFT_ID, ResultEntry, SimStore, useSimStore } from '../store';
import { PATH_KIND_LABEL, SimPath, azimuthToHeading, headingToAzimuth, newId, PathSource } from '../model';
import {
  CATEGORY_LABEL, VehicleSpec, outerWheelRadius, overallLength, steerFromOuterWheelRadius, minFrontAxleRadius,
} from '../vehicles';
import { VERDICT_LABEL, Verdict, verdictOf } from '../compute';
import { Card, Hint, NumberField, Segmented, fmtM } from './fields';
import { buildReportRows, reportCsv, reportHtml } from '../report';

const rowCls = 'flex items-center justify-between gap-3 py-1 text-xs';
const VERDICT_COLOR: Record<Verdict, string> = { pass: '#22c55e', clearance: '#f59e0b', conflict: '#ef4444', infeasible: '#ef4444' };

export function VerdictBadge({ v }: { v: Verdict }) {
  return (
    <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded" style={{ color: VERDICT_COLOR[v], background: `${VERDICT_COLOR[v]}1f`, border: `1px solid ${VERDICT_COLOR[v]}55` }}>
      {VERDICT_LABEL[v]}
    </span>
  );
}

/* ================================================================== 外框 */

export default function SimPanel({ polished, projectName }: { polished?: boolean; projectName: string }) {
  const store = useSimStore();
  const tab = store.ui.rightTab;
  return (
    <div id="sim-panel" className="flex flex-col h-full min-h-0" style={{ color: 'var(--ui-text)' }}>
      <div className="flex gap-1 p-1 m-3 mb-0 rounded shrink-0" style={{ background: 'var(--ui-surface2)' }}>
        {([['vehicle', '① 車輛'], ['path', '② 路徑'], ['result', '③ 結果']] as const).map(([k, label]) => (
          <button key={k} id={`sim-tab-${k}`} onClick={() => store.setUi({ rightTab: k })}
            className={`flex-1 py-1.5 text-xs cursor-pointer transition-all ${polished ? 'rounded' : 'rounded'} ${tab === k && polished ? 'accent-gradient' : ''}`}
            style={tab === k ? (polished ? {} : { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)', fontWeight: 700 }) : { color: 'var(--ui-muted)' }}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {tab === 'vehicle' && <VehicleTab store={store} />}
        {tab === 'path' && <PathTab store={store} polished={polished} />}
        {tab === 'result' && <ResultTab store={store} projectName={projectName} />}
      </div>
    </div>
  );
}

/* ================================================================== ① 車輛 */

function VehicleDiagram({ v, color }: { v: VehicleSpec; color: string }) {
  const total = overallLength(v);
  const front = v.trailer ? Math.max(v.L + v.Of, v.trailer.hitchOffset + v.trailer.Oft) : v.L + v.Of;
  const W = 240, H = 64, pad = 8;
  const k = Math.min((W - pad * 2) / total, (H - 22) / Math.max(v.W, v.trailer?.W ?? 0, 1));
  const X = (x: number) => pad + (front - x) * k; // 車頭在左
  const cy = 26;
  const rect = (x0: number, x1: number, w: number, fill: string, stroke: string) => (
    <rect x={X(x1)} y={cy - (w / 2) * k} width={(x1 - x0) * k} height={w * k} fill={fill} stroke={stroke} strokeWidth={1.2} rx={1.5} />
  );
  const wheel = (x: number, w: number) => (
    <g key={`${x}-${w}`}>
      <rect x={X(x) - 0.45 * k} y={cy - (w / 2) * k - 0.12 * k} width={0.9 * k} height={0.3 * k} fill="var(--ui-muted)" />
      <rect x={X(x) - 0.45 * k} y={cy + (w / 2) * k - 0.18 * k} width={0.9 * k} height={0.3 * k} fill="var(--ui-muted)" />
    </g>
  );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-label="車輛尺寸示意">
      {v.trailer && v.trailer2 && (() => {
        const a1 = v.trailer.hitchOffset - v.trailer.Lt; // 第一節後軸位置
        const h2 = a1 + v.trailer2.hitchOffset;
        return <>{rect(h2 - v.trailer2.Lt - v.trailer2.Ort, h2 + v.trailer2.Oft, v.trailer2.W, 'transparent', 'var(--ui-muted)')}{wheel(h2 - v.trailer2.Lt, v.trailer2.W - 0.3)}</>;
      })()}
      {v.trailer && rect(v.trailer.hitchOffset - v.trailer.Lt - v.trailer.Ort, v.trailer.hitchOffset + v.trailer.Oft, v.trailer.W, 'transparent', 'var(--ui-muted)')}
      {rect(-v.Or, v.L + v.Of, v.W, `${color}22`, color)}
      {wheel(v.L, v.W - 0.3)}
      {wheel(0, v.W - 0.3)}
      {v.trailer && wheel(v.trailer.hitchOffset - v.trailer.Lt, v.trailer.W - 0.3)}
      <line x1={X(v.L)} y1={H - 12} x2={X(0)} y2={H - 12} stroke="var(--ui-muted)" strokeWidth={1} />
      <text x={(X(v.L) + X(0)) / 2} y={H - 2} fontSize={9} textAnchor="middle" fill="var(--ui-muted)">軸距 {v.L.toFixed(1)} m</text>
      <text x={pad} y={9} fontSize={9} fill="var(--ui-muted)">車頭 ←　全長 {total.toFixed(1)} m</text>
    </svg>
  );
}

function VehicleTab({ store }: { store: SimStore }) {
  const [showLegacy, setShowLegacy] = useState(false);
  const target = store.activePath();
  const settings = store.doc.settings;
  const ids = target ? target.vehicleIds : [settings.defaultVehicleId];
  const focusId = (store.ui.activeVehicleId && ids.includes(store.ui.activeVehicleId)) ? store.ui.activeVehicleId : ids[0];
  const focus = store.vehicle(focusId);
  const all = store.vehicles();
  const groups: [string, VehicleSpec[]][] = [
    ['設計車種', all.filter(v => v.category !== 'legacy' && v.category !== 'custom' && v.category !== 'motorcycle')],
    ['參考車種（非規範值）', all.filter(v => v.category === 'motorcycle')],
    ['自訂車種', all.filter(v => v.category === 'custom')],
  ];
  const legacy = all.filter(v => v.category === 'legacy');

  const setIds = (next: string[]) => {
    if (!next.length) return;
    if (target) store.updatePath(target.id, p => ({ ...p, vehicleIds: next }));
    else store.setSettings({ defaultVehicleId: next[0] });
    store.setUi({ activeVehicleId: next.includes(store.ui.activeVehicleId ?? '') ? store.ui.activeVehicleId : next[0] });
  };

  /** 修改預設車種時自動複製為自訂車種，並改用該車種 */
  const editVehicle = (patch: Partial<VehicleSpec>, field: string) => {
    if (focus.category === 'custom') {
      store.updateCustomVehicle(focus.id, patch, `veh:${focus.id}:${field}`);
      return;
    }
    const nv: VehicleSpec = {
      ...JSON.parse(JSON.stringify(focus)), ...patch,
      id: newId('veh'), name: `${focus.short}（自訂）`, short: `${focus.short}（自訂）`, category: 'custom', baseId: focus.id,
      source: `以「${focus.name}」為基礎修改；原出處：${focus.source}`,
    };
    const tid = target?.id;
    if (tid === DRAFT_ID) {
      store.addCustomVehicle(nv);
      store.patchDraft({ vehicleIds: ids.map(x => (x === focus.id ? nv.id : x)) });
    } else {
      store.commit(d => {
        d.customVehicles.push(nv);
        if (tid) {
          const p = d.paths.find(x => x.id === tid);
          if (p) p.vehicleIds = p.vehicleIds.map(x => (x === focus.id ? nv.id : x));
        } else d.settings.defaultVehicleId = nv.id;
      });
    }
    store.setUi({ activeVehicleId: nv.id });
    store.onToast(`已建立自訂車種「${nv.name}」，原預設車種不受影響`, 'info');
  };

  const card = (v: VehicleSpec) => {
    const on = ids.includes(v.id);
    const isFocus = v.id === focusId;
    return (
      <div key={v.id} id={`sim-vehicle-${v.id}`} className="rounded px-2.5 py-2 cursor-pointer transition-colors"
        style={{ background: isFocus ? 'var(--ui-accent-soft)' : 'var(--ui-surface2)', border: `1px solid ${on ? 'var(--ui-accent)' : 'var(--ui-border)'}` }}
        onClick={() => { setIds([v.id]); store.setUi({ activeVehicleId: v.id }); }}
        title={v.source}>
        <div className="flex items-center gap-2">
          <span className="text-[12.5px] font-bold flex-1 truncate">{v.name}</span>
          {target && (
            <label className="flex items-center gap-1 text-[10.5px] cursor-pointer" style={{ color: 'var(--ui-muted)' }} onClick={e => e.stopPropagation()} title="同一路徑套疊多個車種比較">
              <input type="checkbox" checked={on} onChange={() => setIds(on ? ids.filter(x => x !== v.id) : [...ids, v.id])} disabled={on && ids.length === 1} />
              套疊
            </label>
          )}
        </div>
        <div className="text-[10.5px] font-mono mt-0.5" style={{ color: 'var(--ui-muted)' }}>
          全長 {overallLength(v).toFixed(1)}・寬 {v.W.toFixed(1)}・軸距 {v.L.toFixed(1)}{v.trailer ? `＋${v.trailer.Lt.toFixed(1)}` : ''}{v.trailer2 ? `＋${v.trailer2.Lt.toFixed(1)}` : ''} m・δmax {v.maxSteerDeg.toFixed(1)}°
        </div>
      </div>
    );
  };

  return (
    <>
      <div>
        <SectionTitle>{target ? `套用到「${target.name}」` : '新路徑的預設車種'}</SectionTitle>
        <Hint>點選車種即套用；勾選「套疊」可在同一路徑比較多個車種。</Hint>
      </div>
      {groups.map(([title, list]) => list.length > 0 && (
        <div key={title} className="space-y-1.5">
          <div className="text-[11px] font-bold" style={{ color: 'var(--ui-muted)' }}>{title}</div>
          {list.map(card)}
        </div>
      ))}
      <div>
        <button onClick={() => setShowLegacy(!showLegacy)} className="flex items-center gap-1 text-[11px] font-bold cursor-pointer" style={{ color: 'var(--ui-muted)' }}>
          {showLegacy ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} 舊版預設（相容舊檔，未標示出處）
        </button>
        {showLegacy && <div className="space-y-1.5 mt-1.5">{legacy.map(card)}</div>}
      </div>

      <Card>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-bold flex-1 truncate">{focus.name}</span>
          <span className="text-[10px] px-1.5 rounded" style={{ background: 'var(--ui-surface)', color: 'var(--ui-muted)' }}>{CATEGORY_LABEL[focus.category]}</span>
        </div>
        <VehicleDiagram v={focus} color={target?.color ?? '#14b8a6'} />
        {focus.category === 'custom' && (
          <label className={rowCls}><span>名稱</span>
            <input value={focus.name} onChange={e => store.updateCustomVehicle(focus.id, { name: e.target.value, short: e.target.value }, `veh:${focus.id}:name`)}
              className="w-40 px-1.5 py-1 rounded text-[12px] outline-none" style={{ background: 'var(--ui-surface)', border: '1px solid var(--ui-border)', color: 'var(--ui-text)' }} />
          </label>
        )}
        {focus.category !== 'custom' && <Hint>修改任何數值會自動另存為自訂車種，原設計車種不變。</Hint>}
        <div className="mt-1">
          <NumberField id="veh-L" label="軸距 L（等效）" unit="m" value={focus.L} min={0.5} max={20} onChange={v => editVehicle({ L: v }, 'L')} />
          <NumberField id="veh-W" label="車寬 W" unit="m" value={focus.W} min={0.5} max={4} onChange={v => editVehicle({ W: v }, 'W')} />
          <NumberField id="veh-Of" label="前懸 Of" unit="m" value={focus.Of} min={0} max={6} onChange={v => editVehicle({ Of: v }, 'Of')} />
          <NumberField id="veh-Or" label="後懸 Or" unit="m" value={focus.Or} min={0} max={8} onChange={v => editVehicle({ Or: v }, 'Or')} />
          <NumberField id="veh-mirror" label="後照鏡單側外凸" unit="m" value={focus.mirror} min={0} max={0.6} onChange={v => editVehicle({ mirror: v }, 'mirror')} />
          <NumberField id="veh-steer" label="最大前輪轉角" unit="°" value={focus.maxSteerDeg} min={5} max={60} digits={1} onChange={v => editVehicle({ maxSteerDeg: v }, 'steer')} />
          <NumberField id="veh-rmin" label="最小轉彎半徑（外前輪）" unit="m" value={outerWheelRadius(focus)} min={focus.L + 0.5} max={60}
            title="最大轉角時外側前輪的軌跡半徑；修改會換算為最大前輪轉角"
            onChange={v => editVehicle({ maxSteerDeg: Math.round(steerFromOuterWheelRadius(focus.L, focus.W, v) * 100) / 100 }, 'steer')} />
          <div className="text-[10.5px] mt-1 font-mono" style={{ color: 'var(--ui-muted)' }}>前軸中心最小迴轉半徑 {minFrontAxleRadius(focus).toFixed(2)} m</div>
        </div>
        <div className={rowCls + ' mt-2'}>
          <span>半聯結車（拖車）</span>
          <Toggle on={!!focus.trailer} onClick={() => editVehicle(focus.trailer ? { trailer: undefined, trailer2: undefined } : { trailer: { hitchOffset: 0, Lt: 8.4, W: focus.W, Oft: 0.9, Ort: 0.8, maxArticulationDeg: 70 } }, 'trailer')} />
        </div>
        {focus.trailer && (
          <div className="pl-2" style={{ borderLeft: '2px solid var(--ui-border)' }}>
            <NumberField label="聯結點位置（後軸前為正）" unit="m" value={focus.trailer.hitchOffset} min={-3} max={3} onChange={v => editVehicle({ trailer: { ...focus.trailer!, hitchOffset: v } }, 'tHitch')} />
            <NumberField label="聯結點至拖車後軸 Lt" unit="m" value={focus.trailer.Lt} min={1} max={20} onChange={v => editVehicle({ trailer: { ...focus.trailer!, Lt: v } }, 'tLt')} />
            <NumberField label="拖車寬" unit="m" value={focus.trailer.W} min={0.5} max={4} onChange={v => editVehicle({ trailer: { ...focus.trailer!, W: v } }, 'tW')} />
            <NumberField label="拖車前懸（聯結點前）" unit="m" value={focus.trailer.Oft} min={0} max={5} onChange={v => editVehicle({ trailer: { ...focus.trailer!, Oft: v } }, 'tOft')} />
            <NumberField label="拖車後懸" unit="m" value={focus.trailer.Ort} min={0} max={8} onChange={v => editVehicle({ trailer: { ...focus.trailer!, Ort: v } }, 'tOrt')} />
            <NumberField label="最大折角" unit="°" value={focus.trailer.maxArticulationDeg} min={20} max={90} digits={0} onChange={v => editVehicle({ trailer: { ...focus.trailer!, maxArticulationDeg: v } }, 'tArt')} />
          </div>
        )}
        {focus.trailer && (
          <div className={rowCls + ' mt-1'}>
            <span title="雙節聯結車或拖桿式全拖車的後車">第二節拖車</span>
            <Toggle id="veh-trailer2" on={!!focus.trailer2} onClick={() => editVehicle({ trailer2: focus.trailer2 ? undefined : { hitchOffset: -0.9, Lt: 7.0, W: focus.trailer!.W, Oft: 0.6, Ort: 0.9, maxArticulationDeg: 70 } }, 'trailer2')} />
          </div>
        )}
        {focus.trailer && focus.trailer2 && (
          <div className="pl-2" style={{ borderLeft: '2px solid var(--ui-border)' }}>
            <NumberField label="聯結點位置（第一節後軸前為正）" unit="m" value={focus.trailer2.hitchOffset} min={-5} max={3} onChange={v => editVehicle({ trailer2: { ...focus.trailer2!, hitchOffset: v } }, 't2Hitch')} title="拖桿式的聯結點通常在第一節後軸後方（負值）" />
            <NumberField label="聯結點至後軸" unit="m" value={focus.trailer2.Lt} min={1} max={20} onChange={v => editVehicle({ trailer2: { ...focus.trailer2!, Lt: v } }, 't2Lt')} />
            <NumberField label="車寬" unit="m" value={focus.trailer2.W} min={0.5} max={4} onChange={v => editVehicle({ trailer2: { ...focus.trailer2!, W: v } }, 't2W')} />
            <NumberField label="前懸（聯結點前）" unit="m" value={focus.trailer2.Oft} min={0} max={5} onChange={v => editVehicle({ trailer2: { ...focus.trailer2!, Oft: v } }, 't2Oft')} />
            <NumberField label="後懸" unit="m" value={focus.trailer2.Ort} min={0} max={8} onChange={v => editVehicle({ trailer2: { ...focus.trailer2!, Ort: v } }, 't2Ort')} />
            <NumberField label="最大折角" unit="°" value={focus.trailer2.maxArticulationDeg} min={20} max={90} digits={0} onChange={v => editVehicle({ trailer2: { ...focus.trailer2!, maxArticulationDeg: v } }, 't2Art')} />
            <Hint>預設值僅為示意，請依實際車型輸入。</Hint>
          </div>
        )}
        <details className="mt-2">
          <summary className="text-[11px] cursor-pointer" style={{ color: 'var(--ui-muted)' }}>數值出處</summary>
          <p className="text-[10.5px] leading-relaxed mt-1" style={{ color: 'var(--ui-muted)' }}>{focus.source}{focus.note ? `。${focus.note}` : ''}</p>
        </details>
        {focus.category === 'custom' && (
          <button onClick={() => store.deleteCustomVehicle(focus.id)} className="mt-2 w-full py-1.5 text-[11.5px] rounded cursor-pointer" style={{ border: '1px solid var(--ui-border)', color: '#f87171' }}>刪除此自訂車種</button>
        )}
      </Card>
      <Hint>預設尺寸請依交通部《公路路線設計規範》等主管機關最新公告版本核對後再用於送審。</Hint>
    </>
  );
}

/* ================================================================== ② 路徑 */

function PathRow({ store, p, active }: { store: SimStore; p: SimPath; active: boolean }) {
  const [editing, setEditing] = useState(false);
  const entries = store.getResults().filter(r => r.pathId === p.id);
  const verdicts = entries.filter(e => !e.partial).map(e => verdictOf(e.result));
  const worst: Verdict | null = verdicts.length ? (['infeasible', 'conflict', 'clearance', 'pass'] as Verdict[]).find(v => verdicts.includes(v))! : null;
  const iconBtn = (title: string, onClick: () => void, icon: React.ReactNode, disabled = false, id?: string) => (
    <button id={id} title={title} disabled={disabled} onClick={e => { e.stopPropagation(); onClick(); }} className="p-1 rounded cursor-pointer hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed" style={{ color: 'var(--ui-muted)' }}>{icon}</button>
  );
  return (
    <div id={`sim-path-row-${p.id}`} onClick={() => store.selectPath(p.id)} className="flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer"
      style={active ? { background: 'var(--ui-accent-soft)', boxShadow: 'inset 3px 0 0 var(--ui-accent)' } : { opacity: p.visible ? 1 : 0.5 }}>
      <label className="relative w-4 h-4 rounded-full shrink-0 cursor-pointer" style={{ background: p.color, border: '1px solid var(--ui-border)' }} title="變更顏色" onClick={e => e.stopPropagation()}>
        <input type="color" value={p.color} onChange={e => store.updatePath(p.id, x => ({ ...x, color: e.target.value }), `color:${p.id}`)} className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
      </label>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input autoFocus defaultValue={p.name} onClick={e => e.stopPropagation()}
            onBlur={e => { const v = e.target.value.trim(); if (v) store.updatePath(p.id, x => ({ ...x, name: v })); setEditing(false); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); }}
            className="w-full px-1 py-0.5 text-xs rounded outline-none" style={{ background: 'var(--ui-surface)', border: '1px solid var(--ui-accent)', color: 'var(--ui-text)' }} />
        ) : (
          <div className="text-[12.5px] truncate" onDoubleClick={e => { e.stopPropagation(); setEditing(true); }} title="雙擊改名">{p.name}</div>
        )}
        <div className="text-[10.5px] truncate" style={{ color: 'var(--ui-muted)' }}>
          {p.chainFrom ? `↳ 接續「${store.getPath(p.chainFrom)?.name ?? '?'}」・` : ''}{PATH_KIND_LABEL[p.source.kind]}・{p.vehicleIds.map(id => store.vehicle(id).short).join('、')}
        </div>
      </div>
      {worst && <VerdictBadge v={worst} />}
      {iconBtn(p.visible ? '隱藏' : '顯示', () => store.updatePath(p.id, x => ({ ...x, visible: !x.visible })), p.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />)}
      {iconBtn(p.locked ? '已鎖定（防止誤改），點擊解除' : '鎖定以防誤改', () => store.updatePath(p.id, x => ({ ...x, locked: !x.locked })), p.locked ? <Lock className="w-3.5 h-3.5" style={{ color: 'var(--ui-accent)' }} /> : <Unlock className="w-3.5 h-3.5" />)}
      {iconBtn('複製', () => store.duplicatePath(p.id), <Copy className="w-3.5 h-3.5" />)}
      {iconBtn(p.locked ? '已鎖定，無法刪除' : '刪除', () => store.deletePath(p.id), <Trash2 className="w-3.5 h-3.5" />, p.locked, `sim-path-delete-${p.id}`)}
    </div>
  );
}

function PathTab({ store, polished }: { store: SimStore; polished?: boolean }) {
  const paths = store.doc.paths;
  const active = store.activePath();
  const settings = store.doc.settings;
  return (
    <>
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <SectionTitle>軌跡（{paths.length}{store.draft ? '＋繪製中' : ''}）</SectionTitle>
          {paths.length > 0 && <button onClick={() => store.clearAll()} className="text-[11px] cursor-pointer" style={{ color: '#f87171' }}>全部清除</button>}
        </div>
        {store.draft && (
          <div className="flex items-center gap-2 px-2 py-1.5 rounded mb-1" style={{ background: 'var(--ui-accent-soft)', boxShadow: 'inset 3px 0 0 var(--ui-accent)' }}>
            <span className="w-4 h-4 rounded-full" style={{ background: store.draft.color }} />
            <span className="text-[12.5px] flex-1">{store.draft.name}（繪製中）</span>
            <button id="sim-draft-finish" onClick={() => store.finishDraft()} className="text-[11px] px-2 py-0.5 rounded cursor-pointer" style={{ background: 'var(--ui-accent)', color: 'var(--ui-accent-text)' }}>完成 Enter</button>
            <button onClick={() => store.cancelDraft()} className="text-[11px] px-1.5 py-0.5 rounded cursor-pointer" style={{ color: 'var(--ui-muted)' }}>取消</button>
          </div>
        )}
        <div className="space-y-0.5">
          {paths.map(p => <React.Fragment key={p.id}><PathRow store={store} p={p} active={active?.id === p.id} /></React.Fragment>)}
        </div>
        {!paths.length && !store.draft && (
          <p className="text-xs py-5 text-center leading-relaxed" style={{ color: 'var(--ui-muted)' }}>
            還沒有軌跡。從上方功能區選一種繪製方式開始，<br />建議用「點選＋半徑」或「路口轉彎」。
          </p>
        )}
      </div>

      {active ? <PathEditor store={store} path={active} polished={polished} /> : (
        <Card>
          <SectionTitle>新路徑預設</SectionTitle>
          <NumberField label="轉角半徑（點選＋半徑）" unit="m" value={settings.defaultRadius} min={0} max={200} digits={1} onChange={v => store.setSettings({ defaultRadius: v })} />
          <Hint>預設車種：{store.vehicle(settings.defaultVehicleId).name}（可在「① 車輛」變更）。</Hint>
        </Card>
      )}
    </>
  );
}

function PathEditor({ store, path, polished }: { store: SimStore; path: SimPath; polished?: boolean }) {
  const isDraft = path.id === DRAFT_ID;
  const upd = (fn: (p: SimPath) => SimPath, key?: string) => store.updatePath(path.id, fn, key);
  const setSource = (src: PathSource, key?: string) => upd(p => ({ ...p, source: src }), key);
  const d = path.drive;
  const reverse = d.direction === 'reverse';
  const entry = store.getResults().find(r => r.pathId === path.id);
  const warnings = entry ? entry.result.messages : [];
  const locked = path.locked;
  return (
    <>
      <Card>
        <SectionTitle>行駛設定</SectionTitle>
        <div className="space-y-2">
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--ui-muted)' }}>路徑代表</div>
            <Segmented polished={polished} value={reverse ? 'rear' : d.guide} onChange={v => upd(p => ({ ...p, drive: { ...p.drive, guide: v } }))}
              options={[{ value: 'front', label: '前軸中心', disabled: reverse }, { value: 'rear', label: '後軸中心' }]} />
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--ui-muted)' }}>行駛方向</div>
            <Segmented polished={polished} value={d.direction} onChange={v => upd(p => ({ ...p, drive: { ...p.drive, direction: v, guide: v === 'reverse' ? 'rear' : p.drive.guide } }))}
              options={[{ value: 'forward', label: '前進' }, { value: 'reverse', label: '倒車（後軸沿路徑）' }]} />
          </div>
          <div>
            <div className="text-[11px] mb-1" style={{ color: 'var(--ui-muted)' }}>轉向模式</div>
            <Segmented polished={polished} value={d.controller} onChange={v => upd(p => ({ ...p, drive: { ...p.drive, controller: v } }))}
              options={[
                { value: 'exact', label: '精確跟隨', title: '前軸精確沿路徑；超過最大轉角的路段以紅色標示為不可行' },
                { value: 'limited', label: '轉角受限', title: '轉角不超過上限，車輛盡量追隨路徑，顯示實際可行的軌跡與偏離量', disabled: reverse || d.guide === 'rear' },
              ]} />
            <Hint>{d.controller === 'exact' ? '精確跟隨：檢查這條路徑本身能不能開；紅色粗線段代表需要超過最大轉角。' : '轉角受限：模擬駕駛在轉角上限內盡量貼著路徑，結果代表車輛實際會掃過的範圍。'}</Hint>
          </div>
          {d.controller === 'limited' && !reverse && d.guide === 'front' && (
            <>
              <NumberField label="前視距離" unit="m" value={d.lookahead} min={0.3} max={20} digits={1} onChange={v => upd(p => ({ ...p, drive: { ...p.drive, lookahead: v } }), `look:${path.id}`)} />
              <NumberField label="轉向速率上限（0 = 不限）" unit="°/m" value={d.maxSteerRateDegPerM} min={0} max={90} digits={1} onChange={v => upd(p => ({ ...p, drive: { ...p.drive, maxSteerRateDegPerM: v } }), `rate:${path.id}`)} />
            </>
          )}
        </div>
      </Card>

      <ChainCard store={store} path={path} />

      <Card>
        <div className="flex items-center justify-between">
          <SectionTitle>{PATH_KIND_LABEL[path.source.kind]}幾何</SectionTitle>
          {locked && <span className="text-[10.5px]" style={{ color: 'var(--ui-muted)' }}>已鎖定</span>}
        </div>
        <fieldset disabled={locked} className="space-y-1 min-w-0 border-0 p-0 m-0">
          <SourceEditor store={store} path={path} setSource={setSource} isDraft={isDraft} />
        </fieldset>
        {warnings.map((w, i) => <React.Fragment key={i}><Hint tone="warn">⚠ {w}</Hint></React.Fragment>)}
      </Card>
    </>
  );
}

/** 多段操作：接續前一段終點（例如前進進場後倒車入位） */
function ChainCard({ store, path }: { store: SimStore; path: SimPath }) {
  const isDraft = path.id === DRAFT_ID;
  const others = store.doc.paths.filter(p => p.id !== path.id);
  // 排除自己的後續段，避免循環
  const descendants = new Set<string>();
  const collect = (id: string) => store.doc.paths.filter(p => p.chainFrom === id).forEach(c => { if (!descendants.has(c.id)) { descendants.add(c.id); collect(c.id); } });
  collect(path.id);
  const options = others.filter(p => !descendants.has(p.id));
  const children = store.doc.paths.filter(p => p.chainFrom === path.id);
  return (
    <Card>
      <SectionTitle>多段操作</SectionTitle>
      <label className={rowCls}>
        <span>接續自</span>
        <select id="sim-chain-from" value={path.chainFrom ?? ''} onChange={e => store.updatePath(path.id, p => ({ ...p, chainFrom: e.target.value || null }))}
          className="max-w-[60%] text-[12px] rounded px-1.5 py-1 outline-none cursor-pointer" style={{ background: 'var(--ui-surface)', color: 'var(--ui-text)', border: '1px solid var(--ui-border)' }}>
          <option value="">（獨立軌跡）</option>
          {options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      {path.chainFrom && <Hint>以「{store.getPath(path.chainFrom)?.name}」終點的車身與拖車方向作為起始狀態；播放到該段終點會自動接著播放這一段。</Hint>}
      {children.length > 0 && <Hint>後續：{children.map(c => c.name).join('、')}</Hint>}
      {!isDraft && (
        <div className="flex gap-2 mt-2">
          <button id="sim-continue-forward" onClick={() => store.continueFrom(path.id, 'forward')} className="flex-1 py-1.5 text-[11.5px] rounded cursor-pointer" style={{ background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)', border: '1px solid var(--ui-border)' }}>從終點接續前進</button>
          <button id="sim-continue-reverse" onClick={() => store.continueFrom(path.id, 'reverse')} className="flex-1 py-1.5 text-[11.5px] rounded cursor-pointer" style={{ background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)', border: '1px solid var(--ui-border)' }}>從終點接續倒車</button>
        </div>
      )}
      <Hint>例：大貨車前進進入裝卸區後倒車入位、停車場出入口的前進＋倒車調整。倒車段以後軸沿路徑計算。</Hint>
    </Card>
  );
}

function SourceEditor({ store, path, setSource, isDraft }: { store: SimStore; path: SimPath; setSource: (s: PathSource, key?: string) => void; isDraft: boolean }) {
  const s = path.source;
  const sel = store.ui.selectedNode;
  const cell = 'sim-num w-full px-1 py-0.5 rounded text-right font-mono text-[11px] outline-none';
  const cellStyle = { background: 'var(--ui-surface)', border: '1px solid var(--ui-border)', color: 'var(--ui-text)' };
  const numInput = (value: number, onChange: (v: number) => void, key: string, digits = 2, min = -1e6) => (
    <input type="number" step={0.1} defaultValue={Math.round(value * 10 ** digits) / 10 ** digits} key={`${key}:${value.toFixed(digits)}`}
      onChange={e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= min) onChange(v); }} className={cell} style={cellStyle} />
  );
  if (s.kind === 'polyline') {
    const [bulkR, setBulkR] = [store.doc.settings.defaultRadius, (v: number) => store.setSettings({ defaultRadius: v })];
    return (
      <>
        <table className="w-full text-[11px] table-fixed">
          <colgroup><col style={{ width: 16 }} /><col /><col /><col style={{ width: '19%' }} /><col style={{ width: '16%' }} /><col style={{ width: 18 }} /></colgroup>
          <thead><tr style={{ color: 'var(--ui-muted)' }}><th className="text-left font-medium">#</th><th className="font-medium">X m</th><th className="font-medium">Y m</th><th className="font-medium">R m</th><th className="font-medium">Ls m</th><th /></tr></thead>
          <tbody>
            {s.nodes.map((n, i) => {
              const mid = i > 0 && i < s.nodes.length - 1;
              const set = (patch: Partial<typeof n>, field: string) => setSource({ kind: 'polyline', nodes: s.nodes.map((m, k) => (k === i ? { ...m, ...patch } : m)) }, `poly:${path.id}:${i}:${field}`);
              return (
                <tr key={i} style={sel === i ? { background: 'var(--ui-accent-soft)' } : {}} onClick={() => store.setUi({ selectedNode: i })}>
                  <td className="py-0.5" style={{ color: 'var(--ui-muted)' }}>{i + 1}</td>
                  <td className="px-0.5">{numInput(n.p.x, v => set({ p: { ...n.p, x: v } }, 'x'), `x${i}`)}</td>
                  <td className="px-0.5">{numInput(n.p.y, v => set({ p: { ...n.p, y: v } }, 'y'), `y${i}`)}</td>
                  <td className="px-0.5 text-center">{mid ? numInput(n.R, v => set({ R: v }, 'R'), `R${i}`, 1, 0) : <span style={{ color: 'var(--ui-muted)' }}>—</span>}</td>
                  <td className="px-0.5 text-center">{mid ? numInput(n.Ls, v => set({ Ls: v }, 'Ls'), `L${i}`, 1, 0) : <span style={{ color: 'var(--ui-muted)' }}>—</span>}</td>
                  <td>{s.nodes.length > 2 && <button title="刪除節點" onClick={e => { e.stopPropagation(); setSource({ kind: 'polyline', nodes: s.nodes.filter((_, k) => k !== i) }); }} className="p-0.5 cursor-pointer" style={{ color: 'var(--ui-muted)' }}><Trash2 className="w-3 h-3" /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] flex-1" style={{ color: 'var(--ui-muted)' }}>全部轉角套用半徑</span>
          <input type="number" defaultValue={bulkR} key={bulkR} onChange={e => { const v = parseFloat(e.target.value); if (isFinite(v) && v >= 0) setBulkR(v); }} className="w-16 px-1 py-0.5 rounded text-right font-mono text-[11.5px] outline-none" style={cellStyle} />
          <button onClick={() => setSource({ kind: 'polyline', nodes: s.nodes.map(n => ({ ...n, R: store.doc.settings.defaultRadius })) })} className="text-[11px] px-2 py-0.5 rounded cursor-pointer" style={{ background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)' }}>套用</button>
        </div>
        <Hint>R：轉角圓弧半徑；Ls：回旋曲線緩和段長度（0 = 純圓弧）。直線段不足時半徑會自動縮小並提示。{isDraft ? '' : '雙擊線段可插入節點。'}</Hint>
      </>
    );
  }
  if (s.kind === 'pen') {
    return (
      <>
        <table className="w-full text-[11px] table-fixed">
          <colgroup><col style={{ width: 16 }} /><col /><col /><col style={{ width: 36 }} /><col style={{ width: 18 }} /></colgroup>
          <thead><tr style={{ color: 'var(--ui-muted)' }}><th className="text-left font-medium">#</th><th className="font-medium">X m</th><th className="font-medium">Y m</th><th className="font-medium">平滑</th><th /></tr></thead>
          <tbody>
            {s.nodes.map((n, i) => {
              const set = (patch: Partial<typeof n>, field: string) => setSource({ kind: 'pen', nodes: s.nodes.map((m, k) => (k === i ? { ...m, ...patch } : m)) }, `pen:${path.id}:${i}:${field}`);
              return (
                <tr key={i} style={sel === i ? { background: 'var(--ui-accent-soft)' } : {}} onClick={() => store.setUi({ selectedNode: i })}>
                  <td style={{ color: 'var(--ui-muted)' }}>{i + 1}</td>
                  <td className="px-0.5">{numInput(n.p.x, v => set({ p: { ...n.p, x: v } }, 'x'), `x${i}`)}</td>
                  <td className="px-0.5">{numInput(n.p.y, v => set({ p: { ...n.p, y: v } }, 'y'), `y${i}`)}</td>
                  <td className="text-center"><input type="checkbox" checked={n.smooth} onChange={() => set({ smooth: !n.smooth }, 'smooth')} /></td>
                  <td>{s.nodes.length > 2 && <button title="刪除節點" onClick={e => { e.stopPropagation(); setSource({ kind: 'pen', nodes: s.nodes.filter((_, k) => k !== i) }); }} className="p-0.5 cursor-pointer" style={{ color: 'var(--ui-muted)' }}><Trash2 className="w-3 h-3" /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Hint>拖曳圓點調整切線；Alt＋拖曳手柄可做尖角，Alt＋點節點切換平滑。</Hint>
      </>
    );
  }
  if (s.kind === 'freehand') {
    return <Hint>手繪路徑共 {s.points.length} 個取樣點（已自動簡化與平滑）。只能整條拖曳移動；需要精確控制時建議改用「點選＋半徑」重畫。</Hint>;
  }
  // 路口
  const pr = s.params;
  const step = isDraft ? store.ui.intersectionStep : 'done';
  const setP = (patch: Partial<typeof pr>, key: string) => setSource({ kind: 'intersection', params: { ...pr, ...patch } }, `int:${path.id}:${key}`);
  const stepChip = (k: string, label: string, done: boolean, cur: boolean) => (
    <div key={k} className="flex-1 text-center py-1 rounded text-[11px]" style={cur ? { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)', fontWeight: 700 } : done ? { background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)' } : { background: 'var(--ui-surface)', color: 'var(--ui-muted)' }}>{label}</div>
  );
  return (
    <>
      <div className="flex gap-1 mb-1">
        {stepChip('p0', '1 起點', !!pr.p0, step === 'p0')}
        {stepChip('p3', '2 終點', !!pr.p3, step === 'p3')}
        {stepChip('done', '3 微調', step === 'done', step === 'done')}
      </div>
      {pr.p0 && (
        <div className="grid gap-1 items-center text-[11px]" style={{ gridTemplateColumns: '1fr 72px 72px' }}>
          <span style={{ color: 'var(--ui-muted)' }}>起點 X / Y（m）</span>{numInput(pr.p0.x, v => setP({ p0: { ...pr.p0!, x: v } }, 'p0x'), 'p0x')}{numInput(pr.p0.y, v => setP({ p0: { ...pr.p0!, y: v } }, 'p0y'), 'p0y')}
        </div>
      )}
      {pr.p0 && <NumberField label="起點行駛方位角（北 0°，順時針）" unit="°" digits={1} value={headingToAzimuth(pr.h0)} min={0} max={360} onChange={v => setP({ h0: azimuthToHeading(v) }, 'h0')} />}
      {pr.p3 && (
        <div className="grid gap-1 items-center text-[11px]" style={{ gridTemplateColumns: '1fr 72px 72px' }}>
          <span style={{ color: 'var(--ui-muted)' }}>終點 X / Y（m）</span>{numInput(pr.p3.x, v => setP({ p3: { ...pr.p3!, x: v } }, 'p3x'), 'p3x')}{numInput(pr.p3.y, v => setP({ p3: { ...pr.p3!, y: v } }, 'p3y'), 'p3y')}
        </div>
      )}
      {pr.p3 && <NumberField label="終點行駛方位角" unit="°" digits={1} value={headingToAzimuth(pr.h3)} min={0} max={360} onChange={v => setP({ h3: azimuthToHeading(v) }, 'h3')} />}
      <NumberField label="入口控制比例" value={pr.r1} min={0.05} max={1} step={0.05} onChange={v => setP({ r1: v }, 'r1')} title="控制點由起點往虛擬交點的位置；越大曲線越晚轉、越急" />
      <NumberField label="出口控制比例" value={pr.r2} min={0.05} max={1} step={0.05} onChange={v => setP({ r2: v }, 'r2')} />
      <NumberField label="起點前延伸" unit="m" digits={1} value={pr.extStart} min={0} max={100} onChange={v => setP({ extStart: v }, 'es')} />
      <NumberField label="終點後延伸" unit="m" digits={1} value={pr.extEnd} min={0} max={100} onChange={v => setP({ extEnd: v }, 'ee')} />
      <div className={rowCls}><span>外擺（大車先往外再轉入）</span><Toggle on={pr.outswing} onClick={() => setP({ outswing: !pr.outswing }, 'os')} /></div>
      {pr.outswing && (
        <div className="pl-2" style={{ borderLeft: '2px solid var(--ui-border)' }}>
          <NumberField label="入口反曲點位置" value={pr.i1Pos} min={0} max={1} step={0.05} onChange={v => setP({ i1Pos: v }, 'i1p')} />
          <NumberField label="入口向外偏移" unit="m" value={pr.i1Off} min={-10} max={10} onChange={v => setP({ i1Off: v }, 'i1o')} />
          <NumberField label="出口反曲點位置" value={pr.i2Pos} min={0} max={1} step={0.05} onChange={v => setP({ i2Pos: v }, 'i2p')} />
          <NumberField label="出口向外偏移" unit="m" value={pr.i2Off} min={-10} max={10} onChange={v => setP({ i2Off: v }, 'i2o')} />
          <Hint>偏移量正值朝轉彎外側、負值朝內側。</Hint>
        </div>
      )}
    </>
  );
}

/* ================================================================== ③ 結果 */

function MetricRow({ label, value, unit, tone, title }: { label: string; value: string; unit?: string; tone?: 'bad' | 'warn'; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5 text-[12px]" title={title}>
      <span style={{ color: 'var(--ui-muted)' }}>{label}</span>
      <span className="font-mono" style={{ color: tone === 'bad' ? '#f87171' : tone === 'warn' ? '#fbbf24' : 'var(--ui-text)' }}>{value}{unit ? <span className="text-[10.5px] ml-0.5" style={{ color: 'var(--ui-muted)' }}>{unit}</span> : null}</span>
    </div>
  );
}

function ResultCard({ store, e }: { store: SimStore; e: ResultEntry }) {
  const r = e.result;
  const m = r.metrics;
  const v = verdictOf(r);
  const over = m.maxSteerDeg > m.steerLimitDeg + 0.05;
  const SEV = { intrusion: '侵入', clearance: '淨距不足', crossing: '越線' } as const;
  const jump = (pt: { x: number; y: number }, pose: number) => {
    store.requestFocus(pt);
    const p = r.traj.poses[Math.min(pose, r.traj.poses.length - 1)];
    store.setUi({ activeVehicleId: e.vehicleId });
    if (p) store.setPlayS(p.s);
  };
  return (
    <Card>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-bold flex-1 truncate">{r.vehicle.name}</span>
        {e.partial ? <span className="text-[10.5px]" style={{ color: 'var(--ui-muted)' }}>計算中…</span> : <VerdictBadge v={v} />}
      </div>
      <MetricRow label="路徑長度" value={fmtM(m.length, 1)} unit="m" />
      <MetricRow label="最大前輪轉角／上限" value={`${fmtM(m.maxSteerDeg, 1)} / ${fmtM(m.steerLimitDeg, 1)}`} unit="°" tone={over ? 'bad' : undefined} />
      {m.infeasibleLength > 0 && <MetricRow label="不可行路段" value={fmtM(m.infeasibleLength, 1)} unit="m" tone="bad" />}
      <MetricRow label="最急處 前軸／後軸中心半徑" value={`${fmtM(m.minFrontRadius, 1)} / ${fmtM(m.minRearRadius, 1)}`} unit="m" />
      <MetricRow label="外側前角迴轉半徑" value={fmtM(m.outerCornerRadius, 2)} unit="m" title="最大轉角處，車頭外側角（含後照鏡）到瞬心的距離" />
      <MetricRow label="內側後輪迴轉半徑" value={fmtM(m.innerRearRadius, 2)} unit="m" />
      <MetricRow label="內輪差（同側前後輪最大偏移）" value={fmtM(m.wheelOfftracking, 2)} unit="m" />
      <MetricRow label={r.vehicle.trailer ? '拖車軸相對前軸偏移' : '後軸相對前軸偏移'} value={fmtM(m.offtracking, 2)} unit="m" />
      <MetricRow label="最大掃掠寬度" value={fmtM(m.sweptWidth, 2)} unit="m" title="垂直於引導線量測的掃掠範圍寬度最大值" />
      <MetricRow label="最小淨距（硬障礙）" value={m.minClearance === null ? (e.partial ? '—' : '> 3') : fmtM(m.minClearance, 2)} unit="m" tone={m.minClearance !== null && m.minClearance < store.doc.settings.bufferM ? (m.minClearance <= 0 ? 'bad' : 'warn') : undefined} />
      {r.vehicle.trailer && <MetricRow label="拖車最大折角" value={fmtM(m.maxArticulationDeg, 1)} unit="°" tone={m.jackknife ? 'bad' : undefined} />}
      {e.path.drive.controller === 'limited' && <MetricRow label="最大偏離路徑" value={fmtM(m.maxDeviation, 2)} unit="m" tone={m.maxDeviation > 0.5 ? 'warn' : undefined} />}
      {r.conflicts.length > 0 && (
        <div className="mt-2 space-y-1">
          <div className="text-[11px] font-bold" style={{ color: 'var(--ui-muted)' }}>衝突（點擊定位）</div>
          {r.conflicts.map(c => (
            <button key={c.obstacleId} onClick={() => jump(c.at, c.pose)} className="w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11.5px] cursor-pointer hover:bg-white/10" style={{ border: '1px solid var(--ui-border)' }}>
              <Crosshair className="w-3.5 h-3.5 shrink-0" style={{ color: c.severity === 'intrusion' ? '#ef4444' : '#f59e0b' }} />
              <span className="flex-1 truncate">{c.label} {SEV[c.severity]}</span>
              <span className="font-mono text-[10.5px]" style={{ color: 'var(--ui-muted)' }}>{c.severity === 'intrusion' ? `深 ${c.depth.toFixed(2)} m` : c.severity === 'clearance' ? `${c.minDist.toFixed(2)} m` : ''}</span>
            </button>
          ))}
        </div>
      )}
      {r.messages.map((msg, i) => <React.Fragment key={i}><Hint tone={r.status === 'infeasible' || r.status === 'diverged' ? 'error' : 'warn'}>⚠ {msg}</Hint></React.Fragment>)}
    </Card>
  );
}

function download(name: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function ResultTab({ store, projectName }: { store: SimStore; projectName: string }) {
  const results = store.getResults();
  const active = store.activePath();
  const mine = active ? results.filter(r => r.pathId === active.id) : [];
  const settings = store.doc.settings;
  const disp = settings.display;
  const committed = results.filter(r => r.pathId !== DRAFT_ID);
  const base = `${(projectName || 'WebTrafficCAD').replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(0, 10)}`;
  const toggles: [keyof typeof disp, string][] = [
    ['swept', '掃掠範圍'], ['buffer', `淨距帶（${settings.bufferM.toFixed(2)} m）`], ['wheelTracks', '輪胎軌跡'], ['cornerTracks', '車角軌跡'],
    ['axleTracks', '後軸／拖車軸軌跡'], ['poses', '車體骨架'], ['helpers', '路口輔助線'], ['showInCad', '在 CAD 繪圖模式顯示（唯讀參考）'],
  ];
  return (
    <>
      {active ? (
        <div className="space-y-2">
          <SectionTitle>「{active.name}」檢核結果</SectionTitle>
          {mine.length ? mine.map(e => <React.Fragment key={e.key}><ResultCard store={store} e={e} /></React.Fragment>) : <Hint>路徑尚未完成，至少需要兩個節點（路口需起點與終點）。</Hint>}
        </div>
      ) : (
        <Hint>選取一條軌跡以查看詳細檢核結果。</Hint>
      )}

      {committed.length > 0 && (
        <div>
          <SectionTitle>全部軌跡</SectionTitle>
          <table className="w-full text-[11.5px]">
            <tbody>
              {committed.map(e => (
                <tr key={e.key} className="cursor-pointer hover:bg-white/5" onClick={() => { store.selectPath(e.pathId); store.setUi({ activeVehicleId: e.vehicleId }); }} style={{ borderTop: '1px solid var(--ui-border)' }}>
                  <td className="py-1 pr-1"><span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 align-middle" style={{ background: e.path.color }} />{e.path.name}</td>
                  <td className="truncate" style={{ color: 'var(--ui-muted)' }}>{e.result.vehicle.short}</td>
                  <td className="text-right">{e.partial ? '…' : <VerdictBadge v={verdictOf(e.result)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex gap-2 mt-2">
            <button id="sim-export-csv" onClick={() => download(`${base}_轉彎檢核表.csv`, reportCsv(buildReportRows(committed)), 'text/csv;charset=utf-8')} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11.5px] rounded cursor-pointer" style={{ background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)', border: '1px solid var(--ui-border)' }}>
              <FileDown className="w-3.5 h-3.5" /> 檢核表 CSV
            </button>
            <button id="sim-print-report" onClick={() => {
              const w = window.open('', '_blank');
              if (!w) { store.onToast('瀏覽器封鎖了彈出視窗，請允許後再試', 'error'); return; }
              w.document.write(reportHtml(buildReportRows(committed), projectName || '未命名', { bufferM: settings.bufferM }));
              w.document.close();
            }} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[11.5px] rounded cursor-pointer" style={{ border: '1px solid var(--ui-border)', color: 'var(--ui-text)' }}>
              <Printer className="w-3.5 h-3.5" /> 列印／PDF
            </button>
          </div>
          <Hint>DXF／PNG 匯出會一併輸出可見軌跡的掃掠範圍、輪跡與標註（可在匯出選單關閉）。</Hint>
        </div>
      )}

      <div>
        <SectionTitle>顯示</SectionTitle>
        {toggles.map(([k, label]) => (
          <div key={k} className={rowCls}><span>{label}</span><Toggle id={`sim-disp-${k}`} on={disp[k]} onClick={() => store.setDisplay({ [k]: !disp[k] })} /></div>
        ))}
        <label className={rowCls}>
          <span>掃掠範圍不透明度</span>
          <span className="flex items-center gap-2">
            <input type="range" min={0.05} max={0.9} step={0.05} value={settings.sweptOpacity} onChange={e => store.setSettings({ sweptOpacity: parseFloat(e.target.value) })} />
            <span className="font-mono w-9 text-right">{Math.round(settings.sweptOpacity * 100)}%</span>
          </span>
        </label>
        <NumberField label="車體骨架間距" unit="m" value={settings.poseIntervalM} min={0.5} max={50} digits={1} onChange={v => store.setSettings({ poseIntervalM: v })} />
      </div>

      <div>
        <SectionTitle>檢核設定</SectionTitle>
        <NumberField id="sim-buffer" label="淨距帶寬度（0 = 不檢核）" unit="m" value={settings.bufferM} min={0} max={5} onChange={v => store.setSettings({ bufferM: v })} />
        <div className={rowCls}><span>槽化線視為實體槽化島（硬障礙）</span><Toggle on={settings.islandIsHard} onClick={() => store.setSettings({ islandIsHard: !settings.islandIsHard })} /></div>
        <Hint>硬障礙：建築線、人行道（及設定為實體島的槽化線），檢核侵入與淨距。軟侵入：分向限制線、雙白線、路面邊線、紅黃實線、槽化線，只回報越線。停止線、行人穿越道、車道虛線不列入（正常轉彎本來就會越過）。</Hint>
      </div>

      <div className="flex gap-2 text-[11px] leading-relaxed p-2.5 rounded" style={{ background: 'var(--ui-surface2)', color: 'var(--ui-muted)' }}>
        <Info className="w-4 h-4 shrink-0 mt-0.5" />
        <span>本模擬採低速運動學（單軌模型），不考慮輪胎側滑，適用於路口轉彎、迴轉等低速（約 15 km/h 以下）情境；播放速度只影響動畫，不影響軌跡。</span>
      </div>
    </>
  );
}

