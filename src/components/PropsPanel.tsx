import React, { useState } from 'react';
import { MARKING_SPEC, MARKING_NAMES, LAYERS, layerKeyOf, getMotoBoxCorners, roadTextSpan } from '../markings';
import { CadDesignVehicle, cadVehicle, cadMinPathRadius } from '../simulation/vehicles';
import { CadElement, ThreeCenterCurveElement, IslandElement, TextElement, Point2D } from '../types';
import { calculateWidening, distance, sampleCubicBezier, getMaxSteeringAngleForPath, generateParkingZoneSlots, offsetSegment, getPathOffsetCurves } from '../geometry';

/** 設計車種名稱（全介面統一） */
export const DESIGN_VEHICLE_LABELS: Record<string, string> = {
  passenger: '小型車',
  semi_trailer: '大型車（大客車／大貨車）',
  articulated: '聯結車',
};

/** 各分類實際用於檢核的車輛庫車種（尺寸與轉角與軌跡模擬一致） */
export const cadVehicleNote = (v: string) => {
  const veh = cadVehicle(v as CadDesignVehicle);
  return `${veh.name}：軸距 ${veh.L} m、最大轉角 ${veh.maxSteerDeg}°、最小引導線半徑 ${cadMinPathRadius(v as CadDesignVehicle)} m`;
};

/* ==================================================================
 * 性質表格（製圖桌介面）：區段標題列＋「名稱｜數值」兩欄列
 * ================================================================== */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="h-[22px] px-2.5 flex items-center text-[11px] font-bold" style={{ background: 'var(--ui-ribbon)', color: 'var(--ui-muted)', borderBottom: '1px solid var(--ui-border)' }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

function Row({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-center min-h-[26px]" style={{ borderBottom: '1px solid var(--ui-border-soft)' }} title={title}>
      <span className="px-2.5 text-xs truncate" style={{ color: 'var(--ui-muted)' }}>{label}</span>
      <div className="px-1.5 py-[2px] min-w-0 text-xs flex items-center gap-1" style={{ color: 'var(--ui-text)' }}>{children}</div>
    </div>
  );
}

const fieldStyle: React.CSSProperties = { background: 'var(--ui-field)', color: 'var(--ui-text)', border: '1px solid var(--ui-border)' };
const fieldCls = 'h-[21px] px-1.5 text-xs outline-none focus:border-[var(--ui-accent)] min-w-0';

/** 數值欄：輸入中不打斷，Enter／離開時套用並限制範圍；↑↓ 以步距調整 */
function Num({ value, onChange, min = -Infinity, max = Infinity, step = 0.1, unit, digits = 2, id }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; digits?: number; id?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const fmt = (v: number) => String(Number((isFinite(v) ? v : 0).toFixed(digits)));
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft);
    if (!isNaN(v) && clamp(v) !== value) onChange(clamp(v));
    setDraft(null);
  };
  return (
    <>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={draft ?? fmt(value)}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const base = draft !== null && !isNaN(parseFloat(draft)) ? parseFloat(draft) : value;
            const next = clamp(Number((base + (e.key === 'ArrowUp' ? step : -step)).toFixed(6)));
            setDraft(null);
            onChange(next);
          }
        }}
        className={`${fieldCls} flex-1 text-right font-mono`}
        style={fieldStyle}
      />
      {unit !== undefined && <span className="w-5 shrink-0 text-[11px]" style={{ color: 'var(--ui-muted)' }}>{unit}</span>}
    </>
  );
}

function Text({ value, onChange, id, placeholder }: { value: string; onChange: (v: string) => void; id?: string; placeholder?: string }) {
  return <input id={id} type="text" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className={`${fieldCls} flex-1`} style={fieldStyle} />;
}

function Select<T extends string>({ value, options, onChange, id }: { value: T; options: [T, string][]; onChange: (v: T) => void; id?: string }) {
  return (
    <select id={id} value={value} onChange={e => onChange(e.target.value as T)} className={`${fieldCls} flex-1 cursor-pointer`} style={fieldStyle}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-1" style={{ border: '1px solid var(--ui-border)' }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className="flex-1 h-[19px] px-1 text-[11px] cursor-pointer whitespace-nowrap"
          style={value === v ? { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)' } : { color: 'var(--ui-muted)' }}>
          {l}
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, id, label }: { checked: boolean; onChange: (v: boolean) => void; id?: string; label?: string }) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer text-xs">
      <input id={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="m-0 cursor-pointer" style={{ accentColor: 'var(--ui-accent)' }} />
      {label && <span>{label}</span>}
    </label>
  );
}

function Val({ children, tone }: { children: React.ReactNode; tone?: 'ok' | 'bad' }) {
  return <span className="font-mono px-1 truncate" style={{ color: tone === 'bad' ? '#f87171' : tone === 'ok' ? '#5ccf8a' : 'var(--ui-text)' }}>{children}</span>;
}

function Btn({ children, onClick, danger, primary, id, disabled }: { children: React.ReactNode; onClick: () => void; danger?: boolean; primary?: boolean; id?: string; disabled?: boolean; key?: React.Key }) {
  return (
    <button id={id} type="button" disabled={disabled} onClick={onClick} className="flex-1 h-[24px] px-2 text-xs cursor-pointer whitespace-nowrap disabled:opacity-35 enabled:hover:brightness-125"
      style={primary ? { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)', border: '1px solid var(--ui-accent)' }
        : { background: 'var(--ui-surface2)', color: danger ? '#f87171' : 'var(--ui-text)', border: '1px solid var(--ui-border)' }}>
      {children}
    </button>
  );
}

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex gap-1.5 px-2.5 py-2">{children}</div>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 py-1.5 text-[11px] leading-relaxed" style={{ color: 'var(--ui-muted)' }}>{children}</p>;
}

const deg = (rad: number) => ((Math.round((rad * 180) / Math.PI) % 360) + 540) % 360 - 180;
const rad = (d: number) => (d * Math.PI) / 180;
const m = (v: number, d = 2) => `${v.toFixed(d)} m`;

const LINE_TYPES = ['yellow_double', 'yellow_dashed', 'white_dashed', 'white_solid', 'white_double', 'reversible_lane', 'crossing_dashed', 'stop_line', 'yield_line', 'red_solid', 'yellow_solid', 'Sidewalk', 'BuildingLine', 'guideline'];
const LINE_LABELS: Record<string, string> = {
  guideline: '輔助線', yellow_double: '分向限制線', white_dashed: '車道線', yellow_dashed: '分向線', white_solid: '路面邊線',
  white_double: '雙白實線', reversible_lane: '調撥車道線', yield_line: '讓路線', stop_line: '停止線', crossing_dashed: '穿越虛線',
  Sidewalk: '人行道', BuildingLine: '建築線', red_solid: '禁止臨時停車線', yellow_solid: '禁止停車線',
};
const ARROW_LABELS: [string, string][] = [['straight', '直行'], ['left', '左轉'], ['right', '右轉'], ['straight_left', '直行左轉'], ['straight_right', '直行右轉']];
const SLOT_TYPES: ['car' | 'motorcycle', string][] = [['car', '汽車 2.5×5.5'], ['motorcycle', '機車 0.8×2.0']];
const slotPreset = (t: 'car' | 'motorcycle') => (t === 'car' ? { slotType: 'car', width: 2.5, length: 5.5 } : { slotType: 'motorcycle', width: 0.8, length: 2.0 });

interface PropsPanelProps {
  selectedElement: CadElement | null;
  R2: number;
  setR2: (r: number) => void;
  designVehicle: 'passenger' | 'semi_trailer' | 'articulated';
  setDesignVehicle: (v: 'passenger' | 'semi_trailer' | 'articulated') => void;
  onUpdateElement: (el: CadElement) => void;
  onDeleteElement: (id: string) => void;
  onGenerateIslandFromCurve: (curve: any) => void;
  /** 將車輛軌跡標線送到軌跡模擬做完整檢核 */
  onSimulatePath?: (el: any) => void;
  onAddElement?: (el: CadElement) => void;
  onSaveHistory?: () => void;
  selectedAnchorIndices?: number[];
  onTranslateSelectedAnchors?: (dx: number, dy: number) => void;
  onClearSelectedAnchors?: () => void;
  activeTool?: string;
  parkingStampConfig?: { slotType: 'car' | 'motorcycle', width: number, length: number, angle: number };
  setParkingStampConfig?: (cfg: any) => void;
  parkingZoneConfig?: { slotType: 'car' | 'motorcycle', width: number, length: number, angle: number, gap: number, side: 'left' | 'right' };
  setParkingZoneConfig?: (cfg: any) => void;
  roadArrowConfig?: { arrowType: 'straight' | 'left' | 'right' | 'straight_left' | 'straight_right', length: number, angle: number };
  setRoadArrowConfig?: (cfg: any) => void;
}

export default function PropsPanel({
  selectedElement,
  designVehicle,
  onUpdateElement,
  onDeleteElement,
  onGenerateIslandFromCurve,
  onSimulatePath,
  onAddElement,
  onSaveHistory,
  selectedAnchorIndices = [],
  onTranslateSelectedAnchors,
  onClearSelectedAnchors,
  activeTool,
  parkingStampConfig,
  setParkingStampConfig,
  parkingZoneConfig,
  setParkingZoneConfig,
  roadArrowConfig,
  setRoadArrowConfig,
}: PropsPanelProps) {
  const [nudgeStep, setNudgeStep] = useState<string>('0.1');
  const [offsetDistance, setOffsetDistance] = useState<number>(3.5);
  const [nudgeDx, setNudgeDx] = useState<number>(0);
  const [nudgeDy, setNudgeDy] = useState<number>(0);

  const update = (patch: Record<string, any>) => { if (selectedElement) onUpdateElement({ ...(selectedElement as any), ...patch }); };
  const del = (label = '刪除') => (
    <Btn danger id="delete-element-btn" onClick={() => { onSaveHistory?.(); if (selectedElement) onDeleteElement(selectedElement.id); }}>{label}</Btn>
  );

  /** 平行偏移複製（直線或貝茲路徑） */
  const handleOffsetCopy = (el: CadElement, distM: number) => {
    if (!onAddElement) return;
    onSaveHistory?.();
    const newId = `${el.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const line = el as any;
    if (line.p1 && line.p2 && (!line.points || line.points.length === 0)) {
      const offset = offsetSegment(line.p1, line.p2, distM);
      onAddElement({ ...line, id: newId, p1: offset.p1, p2: offset.p2 });
      return;
    }
    if (line.points && line.points.length >= 2) {
      const offsetPts = getPathOffsetCurves(line.points, line.cpLeft || line.points, line.cpRight || line.points, distM, 25);
      onAddElement({ ...line, id: newId, points: offsetPts, cpLeft: offsetPts, cpRight: offsetPts });
    }
  };
  const offsetSection = (el: CadElement) => onAddElement && (
    <Section title="平行偏移複製">
      <Row label="偏移距離"><Num value={offsetDistance} onChange={setOffsetDistance} min={0.1} max={50} step={0.5} unit="m" /></Row>
      <Actions>
        <Btn onClick={() => handleOffsetCopy(el, -offsetDistance)}>向左複製</Btn>
        <Btn onClick={() => handleOffsetCopy(el, offsetDistance)}>向右複製</Btn>
      </Actions>
    </Section>
  );

  /** 直線與多段貝茲路徑的長度 */
  const getLineElementLength = (line: any): number => {
    if (line.points && line.points.length > 0) {
      let len = 0;
      for (let i = 0; i < line.points.length - 1; i++) {
        const pS = line.points[i], pE = line.points[i + 1];
        const samples = sampleCubicBezier(pS, line.cpRight?.[i] || pS, line.cpLeft?.[i + 1] || pE, pE, 15);
        for (let j = 0; j < samples.length - 1; j++) len += distance(samples[j], samples[j + 1]);
      }
      return len;
    }
    if (line.p1 && line.p2) return distance(line.p1, line.p2);
    return 0;
  };

  const layerRow = (el: CadElement) => {
    const k = layerKeyOf(el);
    return <Row label="圖層"><Val>{LAYERS[k]?.name || k}</Val></Row>;
  };

  /* ---------------- 放置前的工具參數 ---------------- */
  const renderToolConfig = () => {
    if (activeTool === 'parking_space' && parkingStampConfig && setParkingStampConfig) {
      const c = parkingStampConfig;
      return (
        <Section title="停車格（放置參數）">
          <Row label="類型"><Seg value={c.slotType} options={SLOT_TYPES} onChange={t => setParkingStampConfig({ ...c, ...slotPreset(t) })} /></Row>
          <Row label="長度"><Num value={c.length} onChange={v => setParkingStampConfig({ ...c, length: v })} min={1} max={8} unit="m" /></Row>
          <Row label="寬度"><Num value={c.width} onChange={v => setParkingStampConfig({ ...c, width: v })} min={0.4} max={4} unit="m" /></Row>
          <Row label="角度"><Num value={deg(c.angle)} onChange={v => setParkingStampConfig({ ...c, angle: rad(v) })} min={-180} max={180} step={5} digits={0} unit="°" /></Row>
          <Note>點擊畫布放置；按住往車格長邊方向拖曳可旋轉（Shift 每 15°）。</Note>
        </Section>
      );
    }
    if (activeTool === 'parking_zone' && parkingZoneConfig && setParkingZoneConfig) {
      const c = parkingZoneConfig;
      return (
        <Section title="停車區（放置參數）">
          <Row label="類型"><Seg value={c.slotType} options={SLOT_TYPES} onChange={t => setParkingZoneConfig({ ...c, ...slotPreset(t) })} /></Row>
          <Row label="長度"><Num value={c.length} onChange={v => setParkingZoneConfig({ ...c, length: v })} min={1} max={8} unit="m" /></Row>
          <Row label="寬度"><Num value={c.width} onChange={v => setParkingZoneConfig({ ...c, width: v })} min={0.4} max={4} unit="m" /></Row>
          <Row label="相對切線角度"><Num value={c.angle} onChange={v => setParkingZoneConfig({ ...c, angle: v })} min={-180} max={180} step={5} digits={0} unit="°" /></Row>
          <Row label="車格間距"><Num value={c.gap} onChange={v => setParkingZoneConfig({ ...c, gap: v })} min={0} max={3} unit="m" /></Row>
          <Row label="配置側"><Seg value={c.side} options={[['right', '路徑右側'], ['left', '路徑左側']]} onChange={v => setParkingZoneConfig({ ...c, side: v })} /></Row>
          <Note>沿畫出的路徑自動排滿車格。</Note>
        </Section>
      );
    }
    if (activeTool === 'road_arrow' && roadArrowConfig && setRoadArrowConfig) {
      const c = roadArrowConfig;
      return (
        <Section title="指向線（放置參數）">
          <Row label="箭頭類型"><Select value={c.arrowType} options={ARROW_LABELS as any} onChange={v => setRoadArrowConfig({ ...c, arrowType: v })} /></Row>
          <Row label="長度"><Num value={c.length} onChange={v => setRoadArrowConfig({ ...c, length: v })} min={1} max={10} unit="m" /></Row>
          <Note>點擊車道中央即放置，會自動對齊行車方向；按住拖曳可自訂朝向。</Note>
        </Section>
      );
    }
    return <Note>在畫布上選取物件以調整其參數。</Note>;
  };

  /* ---------------- 選取的節點 ---------------- */
  const anchorsSection = selectedAnchorIndices.length > 0 && onTranslateSelectedAnchors ? (
    <Section title={`選取的節點（${selectedAnchorIndices.length}）`}>
      <Row label="步距"><Seg value={nudgeStep} options={[['0.1', '0.1 m'], ['0.5', '0.5 m'], ['1', '1 m']]} onChange={setNudgeStep} /></Row>
      <Row label="平移">
        <div className="flex flex-1 gap-1">
          {([['西', -1, 0, 'nudge-left'], ['北', 0, 1, 'nudge-up'], ['南', 0, -1, 'nudge-down'], ['東', 1, 0, 'nudge-right']] as const).map(([l, dx, dy, id]) => (
            <Btn key={id} id={id} onClick={() => onTranslateSelectedAnchors(dx * parseFloat(nudgeStep), dy * parseFloat(nudgeStep))}>{l}</Btn>
          ))}
        </div>
      </Row>
      <Row label="自訂 ΔX"><Num id="translate-custom-dx" value={nudgeDx} onChange={setNudgeDx} step={0.05} unit="m" /></Row>
      <Row label="自訂 ΔY"><Num id="translate-custom-dy" value={nudgeDy} onChange={setNudgeDy} step={0.05} unit="m" /></Row>
      <Actions>
        <Btn primary disabled={!nudgeDx && !nudgeDy} onClick={() => { onTranslateSelectedAnchors(nudgeDx, nudgeDy); setNudgeDx(0); setNudgeDy(0); }}>套用平移</Btn>
        <Btn onClick={() => onClearSelectedAnchors?.()}>取消選取節點</Btn>
      </Actions>
    </Section>
  ) : null;

  /* ---------------- 各類物件 ---------------- */
  const renderElement = (el: CadElement): React.ReactNode => {
    const e = el as any;
    switch (el.type) {
      case 'guideline': case 'yellow_double': case 'white_double': case 'white_dashed': case 'yellow_dashed':
      case 'white_solid': case 'reversible_lane': case 'yield_line': case 'stop_line': case 'crossing_dashed':
      case 'Sidewalk': case 'red_solid': case 'yellow_solid': case 'BuildingLine': {
        const isBezier = !!e.points;
        const widthDefaults: Record<string, number> = {
          white_solid: MARKING_SPEC.edgeLineWidth, stop_line: MARKING_SPEC.stopLineWidth,
          red_solid: MARKING_SPEC.curbLineWidth, yellow_solid: MARKING_SPEC.curbLineWidth,
          white_dashed: MARKING_SPEC.lineWidth, yellow_dashed: MARKING_SPEC.lineWidth,
        };
        const dashedType = el.type === 'white_dashed' || el.type === 'yellow_dashed';
        const hasWidth = el.type in widthDefaults && !e.isLeftTurnGuide;
        const isDashed = dashedType && !e.isLeftTurnGuide;
        // 移動節點時一併平移其控制把手，保持曲線形狀
        const moveAnchor = (idx: number, axis: 'x' | 'y', value: number) => {
          const d = value - e.points[idx][axis];
          const shift = (arr: any[] | undefined) => arr ? arr.map((p: any, i: number) => (i === idx ? { ...p, [axis]: p[axis] + d } : p)) : arr;
          onSaveHistory?.();
          update({ points: shift(e.points), cpLeft: shift(e.cpLeft), cpRight: shift(e.cpRight) });
        };
        const last = isBezier ? e.points.length - 1 : 0;
        return (
          <>
            <Section title="一般">
              <Row label="類型">
                <Select id="line-type-select" value={el.type as string} options={LINE_TYPES.map(t => [t, LINE_LABELS[t]] as [string, string])} onChange={t => { onSaveHistory?.(); update({ type: t }); }} />
              </Row>
              {layerRow(el)}
            </Section>
            <Section title="幾何">
              <Row label="長度"><Val>{m(getLineElementLength(e))}</Val></Row>
              {isBezier ? (
                <>
                  <Row label="節點數"><Val>{e.points.length}</Val></Row>
                  <Row label="起點 X"><Num value={e.points[0].x} onChange={v => moveAnchor(0, 'x', v)} digits={3} step={0.1} unit="m" /></Row>
                  <Row label="起點 Y"><Num value={e.points[0].y} onChange={v => moveAnchor(0, 'y', v)} digits={3} step={0.1} unit="m" /></Row>
                  <Row label="終點 X"><Num value={e.points[last].x} onChange={v => moveAnchor(last, 'x', v)} digits={3} step={0.1} unit="m" /></Row>
                  <Row label="終點 Y"><Num value={e.points[last].y} onChange={v => moveAnchor(last, 'y', v)} digits={3} step={0.1} unit="m" /></Row>
                </>
              ) : e.p1 && e.p2 && (
                <>
                  <Row label="起點"><Val>{e.p1.x.toFixed(3)}, {e.p1.y.toFixed(3)}</Val></Row>
                  <Row label="終點"><Val>{e.p2.x.toFixed(3)}, {e.p2.y.toFixed(3)}</Val></Row>
                </>
              )}
            </Section>
            {(hasWidth || dashedType) && (
              <Section title="標線規格">
                {hasWidth && <Row label="線寬"><Num value={e.lineWidth ?? widthDefaults[el.type]} onChange={v => update({ lineWidth: v })} min={0.01} max={1} step={0.01} unit="m" /></Row>}
                {isDashed && <Row label="實線段長"><Num value={e.dashLength ?? MARKING_SPEC.laneDash[0]} onChange={v => update({ dashLength: v, dashGap: e.dashGap ?? MARKING_SPEC.laneDash[1] })} min={0.1} step={0.5} unit="m" /></Row>}
                {isDashed && <Row label="間距"><Num value={e.dashGap ?? MARKING_SPEC.laneDash[1]} onChange={v => update({ dashGap: v, dashLength: e.dashLength ?? MARKING_SPEC.laneDash[0] })} min={0.1} step={0.5} unit="m" /></Row>}
                {dashedType && <Row label="左彎導引線" title="寬 30 cm、線段 1 m、間距 2 m"><Check id="toggle-left-turn-guide" checked={!!e.isLeftTurnGuide} onChange={v => { onSaveHistory?.(); update({ isLeftTurnGuide: v }); }} label="30 cm，1 m／2 m" /></Row>}
              </Section>
            )}
            {offsetSection(el)}
            <Actions>{del()}</Actions>
          </>
        );
      }

      case 'bicycle_lane':
        return (
          <>
            <Section title="自行車道">
              {layerRow(el)}
              <Row label="長度"><Val>{m(getLineElementLength(e))}</Val></Row>
              <Row label="寬度"><Num id="edit-bicycle-lane-width" value={e.width || 1.5} onChange={v => update({ width: v })} min={0.5} max={5} unit="m" /></Row>
            </Section>
            {offsetSection(el)}
            <Actions>{del()}</Actions>
          </>
        );

      case 'parking_space': {
        const width = e.width || 2.0, length = e.length || 5.0;
        const slotType: 'car' | 'motorcycle' = e.slotType === 'car' || !e.slotType ? 'car' : 'motorcycle';
        const angle = e.angle !== undefined ? e.angle : (e.p2 && e.p1 ? Math.atan2(e.p2.y - e.p1.y, e.p2.x - e.p1.x) : 0);
        // 修改時同步更新印章預設，下一格沿用
        const set = (patch: Record<string, any>) => {
          update(patch);
          if (setParkingStampConfig && parkingStampConfig) setParkingStampConfig({ ...parkingStampConfig, ...patch });
        };
        return (
          <>
            <Section title="停車格">
              {layerRow(el)}
              <Row label="類型"><Seg value={slotType} options={SLOT_TYPES} onChange={t => set(slotPreset(t))} /></Row>
              <Row label="長度"><Num id="edit-parking-length" value={length} onChange={v => set({ length: v })} min={1} max={8} unit="m" /></Row>
              <Row label="寬度"><Num id="edit-parking-width" value={width} onChange={v => set({ width: v })} min={0.4} max={4} unit="m" /></Row>
              <Row label="角度"><Num id="edit-parking-angle" value={deg(angle)} onChange={v => set({ angle: rad(v) })} min={-180} max={180} step={5} digits={0} unit="°" /></Row>
              <Row label="尺寸標籤"><Check checked={e.showSizeLabel !== false} onChange={v => update({ showSizeLabel: v })} label="顯示" /></Row>
            </Section>
            <Actions>{del()}</Actions>
          </>
        );
      }

      case 'parking_zone': {
        let slotCount = 0;
        try { slotCount = generateParkingZoneSlots(e).length; } catch { /* 路徑不完整時不計 */ }
        const slotType: 'car' | 'motorcycle' = e.slotType === 'motorcycle' ? 'motorcycle' : 'car';
        return (
          <>
            <Section title="停車區">
              {layerRow(el)}
              <Row label="路徑長度"><Val>{m(getLineElementLength(e))}</Val></Row>
              <Row label="車格數"><Val>{slotCount} 格</Val></Row>
              <Row label="類型"><Seg value={slotType} options={SLOT_TYPES} onChange={t => update(slotPreset(t))} /></Row>
              <Row label="車格長度"><Num value={e.length || 5} onChange={v => update({ length: v })} min={1} max={8} unit="m" /></Row>
              <Row label="車格寬度"><Num value={e.width || 2} onChange={v => update({ width: v })} min={0.4} max={4} unit="m" /></Row>
              <Row label="相對切線角度"><Num value={e.angle ?? 90} onChange={v => update({ angle: v })} min={-180} max={180} step={5} digits={0} unit="°" /></Row>
              <Row label="車格間距"><Num value={e.gap ?? 0.2} onChange={v => update({ gap: v })} min={0} max={3} unit="m" /></Row>
              <Row label="配置側"><Seg value={e.side || 'right'} options={[['right', '路徑右側'], ['left', '路徑左側']]} onChange={v => update({ side: v })} /></Row>
              <Row label="尺寸標籤"><Check checked={e.showSizeLabel !== false} onChange={v => update({ showSizeLabel: v })} label="顯示" /></Row>
            </Section>
            <Actions>{del()}</Actions>
          </>
        );
      }

      case 'sketch_circle':
        return (
          <>
            <Section title="輔助圓">
              <Row label="圓心"><Val>{e.center.x.toFixed(3)}, {e.center.y.toFixed(3)}</Val></Row>
              <Row label="半徑"><Num id="edit-circle-radius" value={e.radius} onChange={v => update({ radius: v })} min={0.1} max={200} step={0.5} unit="m" /></Row>
              <Row label="直徑"><Val>{m(e.radius * 2)}</Val></Row>
            </Section>
            <Note>輔助圓不會輸出到工程圖（除非勾選「輔助線／輔助圓」）。</Note>
            <Actions>{del()}</Actions>
          </>
        );

      case 'three_center_curve': {
        const curve = el as ThreeCenterCurveElement;
        return (
          <>
            <Section title="三心曲線">
              <Row label="主半徑 R2"><Val>{m(curve.R2, 1)}</Val></Row>
              <Row label="漸變 R1"><Val>{m(curve.R1, 1)}</Val></Row>
              <Row label="漸變 R3"><Val>{m(curve.R3, 1)}</Val></Row>
              <Row label="取樣點"><Val>{curve.points.length}</Val></Row>
            </Section>
            <Section title="導流路幅">
              <Row label="設計車種"><Val>{DESIGN_VEHICLE_LABELS[designVehicle]}</Val></Row>
              <Row label="建議路幅寬"><Val>{m(calculateWidening(curve.R2, designVehicle))}</Val></Row>
              <Note>加寬值取自內建參考表，送審前請依《公路路線設計規範》或《市區道路及附屬工程設計規範》核對。</Note>
            </Section>
            <Actions>
              <Btn primary id="btn-offset-island" onClick={() => { onSaveHistory?.(); onGenerateIslandFromCurve(curve); }}>產生導流島</Btn>
              {del()}
            </Actions>
          </>
        );
      }

      case 'island': {
        const island = el as IslandElement;
        const isGrid = island.hatchPattern === 'cross';
        return (
          <>
            <Section title={isGrid ? '網狀線' : '槽化線'}>
              {layerRow(el)}
              <Row label="節點數"><Val>{island.points.length}</Val></Row>
              {!isGrid && <Row label="顏色"><Seg value={(island.color || '#ffffff').toLowerCase() === '#ffffff' ? 'white' : 'yellow'} options={[['white', '白（同向分隔）'], ['yellow', '黃（對向分隔）']]} onChange={v => update({ color: v === 'white' ? '#ffffff' : '#FFCC00' })} /></Row>}
              {island.laneWidth ? <Row label="建議車道寬"><Val>{m(island.laneWidth)}</Val></Row> : null}
              {island.designVehicle && <Row label="設計車種"><Val>{DESIGN_VEHICLE_LABELS[island.designVehicle] || '—'}</Val></Row>}
            </Section>
            <Section title="斜紋">
              <Row label="填入斜紋"><Check id="toggle-hatching-btn" checked={island.hasHatching !== false} onChange={v => update({ hasHatching: v })} label="顯示" /></Row>
              {island.hasHatching !== false && (
                <>
                  <Row label="間距"><Num value={island.hatchSpacing ?? (isGrid ? MARKING_SPEC.gridSpacing : MARKING_SPEC.hatchSpacing)} onChange={v => update({ hatchSpacing: v })} min={0.1} max={10} step={0.05} unit="m" /></Row>
                  <Row label="角度"><Num value={island.hatchAngle ?? MARKING_SPEC.hatchAngle} onChange={v => update({ hatchAngle: v })} min={-180} max={180} step={5} digits={0} unit="°" /></Row>
                </>
              )}
            </Section>
            <Actions>{del()}</Actions>
          </>
        );
      }

      case 'text': {
        const txt = el as TextElement;
        return (
          <>
            <Section title="文字標註">
              {layerRow(el)}
              <Row label="內容"><Text id="edit-text-input" value={txt.text} onChange={v => update({ text: v })} /></Row>
              <Row label="字高"><Num id="edit-text-size" value={txt.fontSize} onChange={v => update({ fontSize: v })} min={0.2} max={20} unit="m" /></Row>
              <Row label="角度"><Num value={deg(txt.angle || 0)} onChange={v => update({ angle: rad(v) })} min={-180} max={180} step={15} digits={0} unit="°" /></Row>
              <Row label="位置"><Val>{txt.p.x.toFixed(3)}, {txt.p.y.toFixed(3)}</Val></Row>
            </Section>
            <Actions>{del()}</Actions>
          </>
        );
      }

      case 'smart_path': {
        const activeVeh = e.designVehicle || designVehicle;
        const pts: Point2D[] = [];
        for (let j = 0; j < (e.points?.length || 0) - 1; j++) {
          const s = sampleCubicBezier(e.points[j], e.cpRight[j] || e.points[j], e.cpLeft[j + 1] || e.points[j + 1], e.points[j + 1], 30);
          pts.push(...(j === 0 ? s : s.slice(1)));
        }
        const maxSteer = getMaxSteeringAngleForPath(pts, activeVeh) || 0;
        const limit = cadVehicle(activeVeh).maxSteerDeg;
        const ok = maxSteer <= limit;
        return (
          <>
            <Section title="車輛軌跡標線">
              <Row label="設計車種"><Seg value={activeVeh} options={[['passenger', '小型車'], ['semi_trailer', '大型車'], ['articulated', '聯結車']]} onChange={v => update({ designVehicle: v })} /></Row>
              <Row label="檢核車種"><Val>{cadVehicle(activeVeh).name}</Val></Row>
              <Row label="節點數"><Val>{e.points?.length || 0}</Val></Row>
              <Row label="最大轉角"><Val tone={ok ? 'ok' : 'bad'}>{maxSteer.toFixed(1)}°</Val></Row>
              <Row label="轉角上限"><Val>{limit.toFixed(1)}°</Val></Row>
              <Row label="轉角檢核"><Val tone={ok ? 'ok' : 'bad'}>{ok ? '通過' : '超過上限'}</Val></Row>
              <Note>{cadVehicleNote(activeVeh)}。完整掃掠範圍與淨距請用軌跡模擬。</Note>
            </Section>
            {onSimulatePath && <Actions><Btn primary id="cad-simulate-path-btn" onClick={() => onSimulatePath(e)}>送到軌跡模擬檢核</Btn></Actions>}
            {offsetSection(el)}
            <Actions>{del()}</Actions>
          </>
        );
      }

      case 'crosswalk':
        return (
          <>
            <Section title="行人穿越道線">
              {layerRow(el)}
              <Row label="起邊長度"><Val>{m(distance(e.pA1, e.pA2))}</Val></Row>
              <Row label="終邊長度"><Val>{m(distance(e.pB1, e.pB2))}</Val></Row>
              <Row label="線寬"><Num id="edit-crosswalk-width" value={e.stripeWidth ?? MARKING_SPEC.crosswalkStripeWidth} onChange={v => update({ stripeWidth: v })} min={0.2} max={1} step={0.05} unit="m" /></Row>
              <Row label="間隔"><Num id="edit-crosswalk-gap" value={e.stripeGap ?? MARKING_SPEC.crosswalkStripeGap} onChange={v => update({ stripeGap: v })} min={0.2} max={1.5} step={0.05} unit="m" /></Row>
            </Section>
            <Actions>{del()}</Actions>
          </>
        );

      case 'road_text':
        return (
          <>
            <Section title="路面標字">
              {layerRow(el)}
              <Row label="字樣"><Text id="road-text-input" value={e.text} onChange={v => update({ text: v })} /></Row>
              <Row label="常用字樣">
                <div className="flex flex-wrap gap-1 py-0.5">
                  {['慢', '停', '讓', '公車專用', '機慢車優先', '學校', '速限50'].map(t => (
                    <button key={t} type="button" onClick={() => update({ text: t })} className="px-1.5 h-[19px] text-[11px] cursor-pointer" style={{ border: '1px solid var(--ui-border)', color: 'var(--ui-text)' }}>{t}</button>
                  ))}
                </div>
              </Row>
              <Row label="字高"><Num value={e.charHeight ?? 2.5} onChange={v => update({ charHeight: v })} min={0.3} max={10} unit="m" /></Row>
              <Row label="寬高比"><Num value={e.widthFactor ?? 0.4} onChange={v => update({ widthFactor: v })} min={0.1} max={2} step={0.05} /></Row>
              <Row label="字距"><Num value={e.charGap ?? 0.6} onChange={v => update({ charGap: v })} min={0} max={10} unit="m" /></Row>
              <Row label="顏色"><Seg value={e.color === 'yellow' ? 'yellow' : 'white'} options={[['white', '白'], ['yellow', '黃']]} onChange={v => update({ color: v })} /></Row>
              <Row label="行車方向"><Val>{deg(e.angle || 0)}°</Val></Row>
              <Row label="插入點"><Val>{e.p.x.toFixed(3)}, {e.p.y.toFixed(3)}</Val></Row>
              <Note>順著字頭由上而下閱讀；插入點為最靠近駕駛人的一字。字寬＝字高 × 寬高比，連續英數字（如 50）合為一格。</Note>
            </Section>
            <Actions>
              <Btn onClick={() => {
                // 原地反向：最遠的一格變成插入點，標字位置不動
                const s = roadTextSpan(e), a = e.angle || 0;
                update({ angle: a + Math.PI, p: { x: e.p.x + Math.cos(a) * s, y: e.p.y + Math.sin(a) * s } });
              }}>原地反向</Btn>
              {del()}
            </Actions>
          </>
        );

      case 'moto_box':
      case 'moto_turn_box': {
        const c = getMotoBoxCorners(e);
        const width = distance(c[0], c[1]);
        return (
          <>
            <Section title={MARKING_NAMES[el.type]}>
              {layerRow(el)}
              <Row label="前緣寬度"><Val>{m(width)}</Val></Row>
              <Row label="深度"><Num value={e.depth} onChange={v => update({ depth: v })} min={0.5} max={20} unit="m" /></Row>
              <Row label="面積"><Val>{(width * e.depth).toFixed(2)} m²</Val></Row>
              <Row label="區內文字"><Text value={e.label ?? (el.type === 'moto_turn_box' ? '機車待轉' : '機車停等區')} onChange={v => update({ label: v })} /></Row>
              <Row label="底色填滿" title="部分縣市採用"><Check checked={!!e.fill} onChange={v => update({ fill: v })} label="填滿" /></Row>
            </Section>
            <Actions>{del()}</Actions>
          </>
        );
      }

      case 'road_arrow':
        return (
          <>
            <Section title="指向線">
              {layerRow(el)}
              <Row label="箭頭類型"><Select value={e.arrowType} options={ARROW_LABELS as any} onChange={v => update({ arrowType: v })} /></Row>
              <Row label="長度"><Num value={e.length} onChange={v => update({ length: v })} min={1} max={10} unit="m" /></Row>
              <Row label="旋轉角"><Num value={deg(e.angle)} onChange={v => update({ angle: rad(v) })} min={-180} max={180} step={5} digits={0} unit="°" /></Row>
              <Row label="位置"><Val>{e.p.x.toFixed(3)}, {e.p.y.toFixed(3)}</Val></Row>
            </Section>
            <Actions>
              <Btn id="arrow-flip-btn" onClick={() => { const a = e.angle + Math.PI; update({ angle: Math.atan2(Math.sin(a), Math.cos(a)) }); }}>反向 180°</Btn>
              {del()}
            </Actions>
          </>
        );

      case 'measurement':
        return (
          <>
            <Section title="測距">
              <Row label="距離"><Val>{m(getLineElementLength(e))}</Val></Row>
              {e.points?.[0] && <Row label="起點"><Val>{e.points[0].x.toFixed(3)}, {e.points[0].y.toFixed(3)}</Val></Row>}
              {e.points?.[1] && <Row label="終點"><Val>{e.points[1].x.toFixed(3)}, {e.points[1].y.toFixed(3)}</Val></Row>}
            </Section>
            <Actions>{del()}</Actions>
          </>
        );

      case 'angular_dimension':
        return (
          <>
            <Section title="角度標註">
              <Row label="夾角"><Val>{e.angleDeg.toFixed(1)}°</Val></Row>
              {e.center && <Row label="頂點"><Val>{e.center.x.toFixed(3)}, {e.center.y.toFixed(3)}</Val></Row>}
            </Section>
            <Actions>{del()}</Actions>
          </>
        );

      default:
        return <Note>此物件沒有可調整的參數。</Note>;
    }
  };

  return (
    <div
      id="props-grid"
      className="w-full select-none pb-2"
      // 開始修改任何欄位前先記錄一筆復原點（相同內容不會重複記錄）
      onFocusCapture={(ev) => { const t = ev.target as HTMLElement; if (t.matches('input, select, textarea')) onSaveHistory?.(); }}
      onPointerDownCapture={(ev) => { const t = ev.target as HTMLElement; if (t.matches('input[type="checkbox"], button')) onSaveHistory?.(); }}
    >
      {selectedElement ? (
        <>
          {anchorsSection}
          {/* key：切換物件時重設輸入中的暫存值 */}
          <React.Fragment key={selectedElement.id}>{renderElement(selectedElement)}</React.Fragment>
        </>
      ) : renderToolConfig()}
    </div>
  );
}
