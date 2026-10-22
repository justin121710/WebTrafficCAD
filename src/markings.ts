/**
 * 標線規格表與幾何原語產生器（單一真實來源）
 *
 * 畫布、PNG 匯出、DXF 匯出全部由 getElementPrimitives() 取得同一份幾何，
 * 避免三套繪圖程式各自寫死數值而互相不一致。
 *
 * 數值依《道路交通標誌標線號誌設置規則》通行內容與本軟體原有預設整理，
 * 條文可能修正，使用前請以主管機關最新公告版本核對；可調整者皆已設為元件屬性。
 */
import { Point2D, CadElement } from './types';
import {
  getPathOffsetCurves,
  getLineBezierRepresentation,
  sampleClosedBezierLoop,
  generateHatchingLines,
  generateCrosswalkStripes,
  generateParkingZoneSlots,
  getRoadArrowOutlinePoints,
  distance,
} from './geometry';

/** 邏輯色：實際顏色由調色盤（畫面深色 / 列印白底）決定，DXF 依此決定圖層顏色 */
export type MarkColor =
  | 'white' | 'yellow' | 'red' | 'pink' | 'gray' | 'cyan'
  | 'guide' | 'annot' | 'angle' | 'curve' | 'text' | 'moto';

export const MARKING_SPEC = {
  /** 一般標線線寬（m） */
  lineWidth: 0.10,
  /** 路面邊線線寬（m） */
  edgeLineWidth: 0.15,
  /** 雙線（雙黃／雙白／調撥）各線中心距道路中心線之偏移（m）：線寬 10 cm、淨距 10 cm */
  doubleLineOffset: 0.10,
  /** 車道線虛線：線段 4 m、間距 6 m */
  laneDash: [4, 6] as [number, number],
  /** 穿越虛線／左轉導引線：寬 30 cm、線段 1 m、間距 2 m */
  crossingWidth: 0.30,
  crossingDash: [1, 2] as [number, number],
  /** 停止線線寬（規則範圍 30～40 cm） */
  stopLineWidth: 0.35,
  /** 槽化線外框與斜紋 */
  islandBorderWidth: 0.10,
  hatchLineWidth: 0.12,
  hatchSpacing: 0.45,
  hatchAngle: 45,
  /** 行人穿越道線（枕木紋）：線寬 40 cm、間隔 40～80 cm */
  crosswalkStripeWidth: 0.40,
  crosswalkStripeGap: 0.40,
  /** 禁止臨時停車線（紅實線）、禁止停車線（黃實線）線寬 */
  curbLineWidth: 0.10,
  /** 網狀線斜紋間距與線寬 */
  gridSpacing: 1.5,
  gridLineWidth: 0.10,
  /** 機車停等區／待轉區外框線寬 */
  motoBoxBorderWidth: 0.15,
  /** 停車格線寬 */
  parkingLineWidth: 0.10,
  /** 自行車道外框線寬 */
  bicycleBorderWidth: 0.05,
} as const;

/** 每一種邏輯色對應的 DXF 圖層顏色（AutoCAD Color Index） */
export const ACI: Record<MarkColor, number> = {
  white: 7, yellow: 2, red: 1, pink: 6, gray: 8, cyan: 4,
  guide: 5, annot: 30, angle: 6, curve: 5, text: 7, moto: 7,
};

export type Primitive =
  | {
      kind: 'line';
      pts: Point2D[];
      /** 實際線寬（m）；0 表示細線（以螢幕像素 minPx 繪製） */
      width: number;
      color: MarkColor;
      layer: string;
      /** 實體虛線（m）：[線段, 間距] */
      dash?: [number, number];
      /** 螢幕虛線（px），僅輔助線使用，DXF 輸出為實線 */
      dashPx?: [number, number];
      minPx?: number;
      closed?: boolean;
    }
  | {
      kind: 'poly';
      pts: Point2D[];
      /** evenodd 挖空的內環 */
      holes?: Point2D[][];
      fill: MarkColor | null;
      fillAlpha?: number;
      stroke?: MarkColor;
      strokeWidth?: number;
      layer: string;
    }
  | {
      kind: 'text';
      p: Point2D;
      text: string;
      /** 字高（m） */
      size: number;
      color: MarkColor;
      layer: string;
      /** 旋轉角（rad，逆時針，0 = 文字基線朝東） */
      angle?: number;
      /** 寬度比例（路面標字為縱長字體） */
      widthFactor?: number;
      /** 最小螢幕字高（px），避免縮小後看不見 */
      minPx?: number;
      /** 文字在螢幕像素下的固定大小（標註用），設定時忽略 size */
      fixedPx?: number;
    }
  | {
      kind: 'circle';
      c: Point2D;
      r: number;
      color: MarkColor;
      layer: string;
      dashPx?: [number, number];
    }
  | {
      kind: 'arc';
      c: Point2D;
      r: number;
      /** 起訖角（rad，逆時針） */
      a0: number;
      a1: number;
      color: MarkColor;
      layer: string;
    };

/** 正式名稱（工具列、提示、屬性面板、圖層說明共用） */
export const MARKING_NAMES: Record<string, string> = {
  yellow_double: '分向限制線（雙黃實線）',
  white_double: '雙白實線',
  white_solid: '路面邊線（白實線）',
  white_dashed: '車道線（白虛線）',
  yellow_dashed: '分向線（黃虛線）',
  crossing_dashed: '穿越虛線／路口指示線',
  stop_line: '停止線',
  yield_line: '讓路線',
  BuildingLine: '建築線',
  reversible_lane: '調撥車道線（雙白虛線）',
  red_solid: '禁止臨時停車線（紅實線）',
  yellow_solid: '禁止停車線（黃實線）',
  Sidewalk: '人行道鋪面',
  island: '槽化線',
  channelization: '槽化線',
  grid_box: '網狀線',
  crosswalk: '行人穿越道線（枕木紋）',
  bicycle_lane: '自行車道',
  parking_space: '停車格',
  parking_zone: '停車區（沿線排列車格）',
  road_arrow: '指向線',
  moto_box: '機車停等區',
  moto_turn_box: '機車待轉區',
  road_text: '路面標字',
  text: '文字標註',
  text_label: '文字標註',
  guideline: '輔助線',
  sketch_circle: '輔助圓',
  measurement: '測距標註',
  angular_dimension: '角度標註',
  arc_3point: '三點圓弧',
  three_center_curve: '三心曲線',
  smart_path: '車輛軌跡',
};

/** DXF 圖層（名稱須為 ASCII 以相容 DXF R12；desc 為中文說明） */
export const LAYERS: Record<string, { name: string; desc: string; color: MarkColor }> = {
  yellow_double: { name: 'MARK-CENTER-NOPASS', desc: '分向限制線（雙黃實線）', color: 'yellow' },
  white_double: { name: 'MARK-DOUBLE-WHITE', desc: '雙白實線', color: 'white' },
  white_solid: { name: 'MARK-EDGE', desc: '路面邊線', color: 'white' },
  white_dashed: { name: 'MARK-LANE', desc: '車道線', color: 'white' },
  yellow_dashed: { name: 'MARK-CENTER', desc: '分向線', color: 'yellow' },
  crossing_dashed: { name: 'MARK-CROSSING-DASH', desc: '穿越虛線', color: 'white' },
  stop_line: { name: 'MARK-STOP', desc: '停止線', color: 'white' },
  yield_line: { name: 'MARK-YIELD', desc: '讓路線', color: 'white' },
  reversible_lane: { name: 'MARK-REVERSIBLE', desc: '調撥車道線', color: 'white' },
  red_solid: { name: 'MARK-NO-STOPPING-RED', desc: '禁止臨時停車線', color: 'red' },
  yellow_solid: { name: 'MARK-NO-PARKING-YELLOW', desc: '禁止停車線', color: 'yellow' },
  island: { name: 'MARK-CHANNELIZATION', desc: '槽化線', color: 'white' },
  grid_box: { name: 'MARK-YELLOW-GRID', desc: '網狀線', color: 'yellow' },
  crosswalk: { name: 'MARK-CROSSWALK', desc: '行人穿越道線', color: 'white' },
  road_arrow: { name: 'MARK-ARROW', desc: '指向線', color: 'white' },
  road_text: { name: 'MARK-WORD', desc: '路面標字', color: 'white' },
  moto_box: { name: 'MARK-MOTO-BOX', desc: '機車停等區／待轉區', color: 'white' },
  parking: { name: 'MARK-PARKING', desc: '停車格', color: 'white' },
  bicycle_lane: { name: 'PAVE-BICYCLE', desc: '自行車道', color: 'pink' },
  Sidewalk: { name: 'PAVE-SIDEWALK', desc: '人行道', color: 'gray' },
  BuildingLine: { name: 'REF-BUILDING-LINE', desc: '建築線', color: 'cyan' },
  guide: { name: 'CONSTRUCTION', desc: '輔助線', color: 'guide' },
  curve: { name: 'DESIGN-CURVE', desc: '設計曲線', color: 'curve' },
  annot: { name: 'ANNO-DIM', desc: '尺寸標註', color: 'annot' },
  text: { name: 'ANNO-TEXT', desc: '文字標註', color: 'text' },
  path: { name: 'SIM-VEHICLE-PATH', desc: '車輛軌跡', color: 'curve' },
};

const L = (k: string) => LAYERS[k].name;

/** 依弧長將折線切成虛線段（第一段從起點開始） */
export function dashPolyline(pts: Point2D[], dash: number, gap: number, phase = 0): Point2D[][] {
  const out: Point2D[][] = [];
  if (pts.length < 2 || dash <= 0) return out;
  const cycle = dash + gap;
  let s = -phase; // 目前累積弧長（相對週期起點）
  let cur: Point2D[] | null = null;
  const inDash = (v: number) => {
    const m = ((v % cycle) + cycle) % cycle;
    return m < dash - 1e-9;
  };
  if (inDash(s)) cur = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const segLen = distance(a, b);
    if (segLen < 1e-12) continue;
    let t = 0;
    while (t < segLen - 1e-9) {
      const m = ((s + t) % cycle + cycle) % cycle;
      const nextBoundary = m < dash ? dash - m : cycle - m;
      const step = Math.min(nextBoundary, segLen - t);
      t += step;
      const p = { x: a.x + (b.x - a.x) * (t / segLen), y: a.y + (b.y - a.y) * (t / segLen) };
      if (cur) cur.push(p);
      if (step === nextBoundary) {
        // 抵達邊界：切換狀態
        const nowInDash = inDash(s + t + 1e-9);
        if (cur && !nowInDash) {
          if (cur.length >= 2) out.push(cur);
          cur = null;
        } else if (!cur && nowInDash) {
          cur = [p];
        }
      }
    }
    s += segLen;
  }
  if (cur && cur.length >= 2) out.push(cur);
  return out;
}

/** 計算折線長度 */
export function polylineLength(pts: Point2D[]): number {
  let s = 0;
  for (let i = 0; i < pts.length - 1; i++) s += distance(pts[i], pts[i + 1]);
  return s;
}

/** 將中心線轉成具寬度的封閉多邊形（供數量計算、DXF 外框） */
export function strokeOutline(pts: Point2D[], width: number): Point2D[] {
  if (pts.length < 2) return [];
  const left = offsetPolyline(pts, width / 2);
  const right = offsetPolyline(pts, -width / 2);
  return [...left, ...right.reverse()];
}

function offsetPolyline(pts: Point2D[], d: number): Point2D[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: p.x - ((b.y - a.y) / len) * d, y: p.y + ((b.x - a.x) / len) * d };
  });
}

function centerline(el: any, sub = 30): Point2D[] {
  const ref = getLineBezierRepresentation(el);
  if (!ref) return [];
  return getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, sub);
}

function offsetLine(el: any, d: number, sub = 30): Point2D[] {
  const ref = getLineBezierRepresentation(el);
  if (!ref) return [];
  return getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, d, sub);
}

/** 讓路線幾何：兩排方塊＋倒三角形（與原畫布繪製邏輯一致） */
export function getYieldLinePolygons(el: any): Point2D[][] & { triangleHoles?: Point2D[] } {
  const ref = getLineBezierRepresentation(el);
  const result: Point2D[][] = [];
  if (!ref) return result;
  const sgn: number = el.sgn ?? 1;
  const center = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 60);
  if (center.length < 2) return result;

  // 弧長參數化的偏移取樣
  const offsetAt = (pts: Point2D[], s: number): { p: Point2D; t: Point2D; n: Point2D } => {
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = distance(pts[i], pts[i + 1]);
      if (acc + d >= s || i === pts.length - 2) {
        const r = d > 0 ? Math.min(1, Math.max(0, (s - acc) / d)) : 0;
        const tx = (pts[i + 1].x - pts[i].x) / (d || 1);
        const ty = (pts[i + 1].y - pts[i].y) / (d || 1);
        return {
          p: { x: pts[i].x + (pts[i + 1].x - pts[i].x) * r, y: pts[i].y + (pts[i + 1].y - pts[i].y) * r },
          t: { x: tx, y: ty },
          n: { x: -ty, y: tx },
        };
      }
      acc += d;
    }
    return { p: pts[0], t: { x: 1, y: 0 }, n: { x: 0, y: 1 } };
  };

  const rowOuter = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0.85 * sgn, 60);
  const rowInner = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0.15 * sgn, 60);
  const Lo = polylineLength(rowOuter);
  const Li = polylineLength(rowInner);
  const outerIsRow2 = Lo >= Li;
  const Lmax = Math.max(Lo, Li);
  const N = Math.max(1, Math.round(Lmax / 0.9));
  const C = Lmax / N;
  let gap = 0.3;
  let width = C - gap;
  if (width < 0.1) { width = (C * 2) / 3; gap = C / 3; }

  const Lc = polylineLength(center);
  const ratio = Lc / (outerIsRow2 ? Lo : Li || 1);
  const block = (s0: number, s1: number, d0: number, d1: number) => {
    const pts: Point2D[] = [];
    const lower: Point2D[] = [], upper: Point2D[] = [];
    for (let k = 0; k <= 4; k++) {
      const s = (s0 + ((s1 - s0) * k) / 4) * ratio;
      const f = offsetAt(center, s);
      lower.push({ x: f.p.x + f.n.x * d0, y: f.p.y + f.n.y * d0 });
      upper.push({ x: f.p.x + f.n.x * d1, y: f.p.y + f.n.y * d1 });
    }
    pts.push(...lower, ...upper.reverse());
    return pts;
  };
  for (let j = 0; j < N; j++) {
    const s0 = j * C, s1 = s0 + width;
    result.push(block(s0, s1, 0, 0.30 * sgn));
    result.push(block(s0, s1, 0.70 * sgn, 1.00 * sgn));
  }

  // 倒三角形（置於中心線中點、距線 3 m）
  const mid = offsetAt(center, Lc / 2);
  const n = { x: mid.n.x * sgn, y: mid.n.y * sgn };
  const u = mid.t;
  const D = { x: mid.p.x + 3.0 * n.x, y: mid.p.y + 3.0 * n.y };
  const at = (a: number, b: number) => ({ x: D.x + a * n.x + b * u.x, y: D.y + a * n.y + b * u.y });
  const k26 = Math.sqrt(26);
  // 底部橫條
  result.push([at(0, -0.6), at(0, 0.6), at(0.6, 0.48), at(0.6, -0.48)]);
  const outer = [at(0.6, -0.48), at(0.6, 0.48), at(3.0, 0)];
  const inner = [at(0.6, -(0.48 - 0.03 * k26)), at(0.6, 0.48 - 0.03 * k26), at(3.0 - 0.15 * k26, 0)];
  (result as any).triangle = { outer, inner };
  return result as any;
}

/** 機車停等區／待轉區的四角點（p1→p2 為前緣，p3 決定深度） */
export function getMotoBoxCorners(el: any): Point2D[] {
  const { p1, p2, depth } = el;
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  return [p1, p2, { x: p2.x + nx * depth, y: p2.y + ny * depth }, { x: p1.x + nx * depth, y: p1.y + ny * depth }];
}

/** 停車格四角（與畫布 rotate(-angle) 繪製一致） */
export function getParkingSpaceCorners(pk: any): Point2D[] {
  const Lm = pk.length || 5.0;
  const Wm = pk.width || 2.0;
  const ang = pk.angle !== undefined ? pk.angle : Math.atan2(pk.p2.y - pk.p1.y, pk.p2.x - pk.p1.x);
  const ux = Math.cos(ang), uy = Math.sin(ang);
  const vx = -uy, vy = ux;
  const p = pk.p1;
  return [
    p,
    { x: p.x + ux * Lm, y: p.y + uy * Lm },
    { x: p.x + ux * Lm + vx * Wm, y: p.y + uy * Lm + vy * Wm },
    { x: p.x + vx * Wm, y: p.y + vy * Wm },
  ];
}

export interface PrimitiveOptions {
  /** 是否輸出輔助線、輔助圓（出圖可關閉） */
  includeConstruction?: boolean;
  /** 是否輸出量測標註 */
  includeAnnotations?: boolean;
  /** 是否輸出車格尺寸文字 */
  includeParkingLabels?: boolean;
}

/** 取得單一元件的繪製原語 */
export function getElementPrimitives(el: CadElement, opts: PrimitiveOptions = {}): Primitive[] {
  const S = MARKING_SPEC;
  const e = el as any;
  const P: Primitive[] = [];
  const includeConstruction = opts.includeConstruction !== false;
  const includeAnnotations = opts.includeAnnotations !== false;

  switch (e.type) {
    case 'guideline':
      if (includeConstruction) {
        P.push({ kind: 'line', pts: centerline(e, 25), width: 0, minPx: 1.5, color: 'guide', layer: L('guide'), dashPx: [4, 6] });
      }
      break;
    case 'yellow_double':
    case 'white_double': {
      const c: MarkColor = e.type === 'yellow_double' ? 'yellow' : 'white';
      const layer = L(e.type);
      P.push({ kind: 'line', pts: offsetLine(e, S.doubleLineOffset), width: S.lineWidth, color: c, layer });
      P.push({ kind: 'line', pts: offsetLine(e, -S.doubleLineOffset), width: S.lineWidth, color: c, layer });
      break;
    }
    case 'white_dashed':
    case 'yellow_dashed': {
      const c: MarkColor = e.type === 'yellow_dashed' ? 'yellow' : 'white';
      if (e.isLeftTurnGuide) {
        P.push({ kind: 'line', pts: centerline(e, 25), width: S.crossingWidth, color: c, layer: L(e.type), dash: S.crossingDash });
      } else {
        const dash = (e.dashLength && e.dashGap) ? [e.dashLength, e.dashGap] as [number, number] : S.laneDash;
        P.push({ kind: 'line', pts: centerline(e, 25), width: e.lineWidth ?? S.lineWidth, color: c, layer: L(e.type), dash });
      }
      break;
    }
    case 'white_solid':
      P.push({ kind: 'line', pts: centerline(e, 25), width: e.lineWidth ?? S.edgeLineWidth, color: 'white', layer: L('white_solid') });
      break;
    case 'red_solid':
    case 'yellow_solid':
      P.push({ kind: 'line', pts: centerline(e, 25), width: e.lineWidth ?? S.curbLineWidth, color: e.type === 'red_solid' ? 'red' : 'yellow', layer: L(e.type) });
      break;
    case 'crossing_dashed':
      P.push({ kind: 'line', pts: centerline(e, 25), width: S.crossingWidth, color: 'white', layer: L('crossing_dashed'), dash: S.crossingDash });
      break;
    case 'stop_line':
      P.push({ kind: 'line', pts: centerline(e, 25), width: e.lineWidth ?? S.stopLineWidth, color: 'white', layer: L('stop_line') });
      break;
    case 'reversible_lane': {
      const layer = L('reversible_lane');
      P.push({ kind: 'line', pts: offsetLine(e, S.doubleLineOffset, 25), width: S.lineWidth, color: 'white', layer, dash: S.laneDash });
      P.push({ kind: 'line', pts: offsetLine(e, -S.doubleLineOffset, 25), width: S.lineWidth, color: 'white', layer, dash: S.laneDash });
      break;
    }
    case 'yield_line': {
      const polys = getYieldLinePolygons(e) as any;
      const layer = L('yield_line');
      (polys as Point2D[][]).forEach(pts => P.push({ kind: 'poly', pts, fill: 'white', layer }));
      if (polys.triangle) {
        P.push({ kind: 'poly', pts: polys.triangle.outer, holes: [polys.triangle.inner], fill: 'white', layer });
      }
      break;
    }
    case 'bicycle_lane': {
      const w = e.width || 1.5;
      const left = offsetLine(e, -w / 2, 40);
      const right = offsetLine(e, w / 2, 40);
      if (left.length >= 2 && right.length >= 2) {
        P.push({ kind: 'poly', pts: [...left, ...[...right].reverse()], fill: 'pink', fillAlpha: 0.2, stroke: 'pink', strokeWidth: S.bicycleBorderWidth, layer: L('bicycle_lane') });
      }
      break;
    }
    case 'Sidewalk': {
      const pts = centerline(e, 30);
      if (pts.length >= 2) P.push({ kind: 'poly', pts, fill: 'gray', stroke: 'gray', strokeWidth: 0.1, layer: L('Sidewalk') });
      break;
    }
    case 'BuildingLine':
      P.push({ kind: 'line', pts: centerline(e, 25), width: 0, minPx: 2.5, color: 'cyan', layer: L('BuildingLine') });
      break;
    case 'sketch_circle':
      if (includeConstruction) P.push({ kind: 'circle', c: e.center, r: e.radius, color: 'guide', layer: L('guide'), dashPx: [6, 6] });
      break;
    case 'three_center_curve':
      P.push({ kind: 'line', pts: e.points, width: 0.15, color: 'curve', layer: L('curve') });
      break;
    case 'island': {
      const hasBezier = e.cpLeft && e.cpRight && e.cpLeft.length === e.points.length;
      const boundary: Point2D[] = hasBezier ? sampleClosedBezierLoop(e.points, e.cpLeft, e.cpRight, 20) : e.points;
      if (!boundary || boundary.length < 3) break;
      const isGrid = e.hatchPattern === 'cross';
      // 槽化線只有白（同向分隔）與黃（對向分隔）兩種；網狀線一律黃色
      const color: MarkColor = isGrid || (e.color && e.color.toLowerCase() !== '#ffffff') ? 'yellow' : 'white';
      const layer = isGrid ? L('grid_box') : L('island');
      P.push({ kind: 'poly', pts: boundary, fill: null, stroke: color, strokeWidth: isGrid ? S.gridLineWidth : S.islandBorderWidth, layer });
      if (e.hasHatching !== false) {
        const spacing = e.hatchSpacing ?? (isGrid ? S.gridSpacing : S.hatchSpacing);
        const angle = e.hatchAngle ?? S.hatchAngle;
        const hw = isGrid ? S.gridLineWidth : S.hatchLineWidth;
        const angles = isGrid ? [angle, angle + 90] : [angle];
        angles.forEach(a => {
          generateHatchingLines(boundary, spacing, a).forEach(h => {
            P.push({ kind: 'line', pts: [h.p1, h.p2], width: hw, color, layer });
          });
        });
      }
      break;
    }
    case 'text':
      P.push({ kind: 'text', p: e.p, text: e.text, size: e.fontSize || 1, color: 'text', layer: L('text'), minPx: 9, angle: e.angle || 0 });
      break;
    case 'road_text': {
      // 路面標字：沿行車方向由近而遠排列，縱長字形
      const chars: string[] = Array.from(e.text || '');
      const h = e.charHeight || 2.4;
      const gap = e.charGap ?? 0.6;
      const ang = e.angle || 0; // 行車方向（字頭朝向）
      const fx = Math.cos(ang), fy = Math.sin(ang);
      chars.forEach((ch, i) => {
        const s = i * (h + gap);
        P.push({
          kind: 'text', p: { x: e.p.x + fx * s, y: e.p.y + fy * s }, text: ch, size: h,
          color: e.color === 'yellow' ? 'yellow' : 'white', layer: L('road_text'),
          angle: ang - Math.PI / 2, widthFactor: e.widthFactor ?? 0.4, minPx: 6,
        });
      });
      break;
    }
    case 'smart_path':
      P.push({ kind: 'line', pts: centerline(e, 30), width: 0, minPx: 1.5, color: 'curve', layer: L('path') });
      break;
    case 'crosswalk': {
      const stripes = generateCrosswalkStripes(e.pA1, e.pA2, e.pB1, e.pB2, e.stripeWidth ?? S.crosswalkStripeWidth, e.stripeGap ?? S.crosswalkStripeGap);
      stripes.forEach(s => P.push({ kind: 'poly', pts: [s.p1, s.p2, s.p3, s.p4], fill: 'white', layer: L('crosswalk') }));
      break;
    }
    case 'parking_space': {
      const c = getParkingSpaceCorners(e);
      P.push({ kind: 'line', pts: c, closed: true, width: S.parkingLineWidth, color: 'white', layer: L('parking') });
      if (opts.includeParkingLabels && e.showSizeLabel !== false) {
        const cx = (c[0].x + c[2].x) / 2, cy = (c[0].y + c[2].y) / 2;
        P.push({ kind: 'text', p: { x: cx, y: cy }, text: `${(e.width || 2).toFixed(1)}x${(e.length || 5).toFixed(1)}m`, size: Math.min(e.width || 2, e.length || 5) * 0.18, color: 'annot', layer: L('annot') });
      }
      break;
    }
    case 'parking_zone': {
      generateParkingZoneSlots(e).forEach(slot => {
        P.push({ kind: 'line', pts: slot.corners, closed: true, width: S.parkingLineWidth, color: 'white', layer: L('parking') });
      });
      break;
    }
    case 'road_arrow': {
      const pts = getRoadArrowOutlinePoints(e);
      if (pts.length) P.push({ kind: 'poly', pts, fill: 'white', layer: L('road_arrow') });
      break;
    }
    case 'moto_box':
    case 'moto_turn_box': {
      if (!e.p1 || !e.p2) break;
      const c = getMotoBoxCorners(e);
      P.push({ kind: 'line', pts: c, closed: true, width: S.motoBoxBorderWidth, color: 'white', layer: L('moto_box') });
      if (e.fill) P.push({ kind: 'poly', pts: c, fill: 'moto', fillAlpha: 0.35, layer: L('moto_box') });
      const mx = (c[0].x + c[2].x) / 2, my = (c[0].y + c[2].y) / 2;
      // 文字字頭朝向路口（與深度方向相反），讓停等的駕駛人正向閱讀
      const ang = Math.atan2(c[0].y - c[1].y, c[0].x - c[1].x);
      const label = e.label || (e.type === 'moto_turn_box' ? '機車待轉' : '機車停等區');
      const width = distance(c[0], c[1]);
      const size = Math.min(e.depth * 0.45, (width / Math.max(1, label.length)) * 0.9);
      P.push({ kind: 'text', p: { x: mx, y: my }, text: label, size, color: 'white', layer: L('moto_box'), angle: ang });
      break;
    }
    case 'measurement': {
      if (!includeAnnotations || !e.points || e.points.length < 2) break;
      const [p1, p2] = e.points;
      P.push({ kind: 'line', pts: [p1, p2], width: 0, minPx: 1.5, color: 'annot', layer: L('annot'), dashPx: [5, 5] });
      const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const upright = ang > Math.PI / 2 || ang < -Math.PI / 2 ? ang + Math.PI : ang;
      P.push({ kind: 'text', p: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }, text: `${distance(p1, p2).toFixed(2)} m`, size: 0.6, color: 'annot', layer: L('annot'), angle: upright, fixedPx: 11 });
      break;
    }
    case 'angular_dimension': {
      if (!includeAnnotations) break;
      const c = e.center;
      const a1 = Math.atan2(e.pStart1.y - c.y, e.pStart1.x - c.x);
      const a2 = Math.atan2(e.pStart2.y - c.y, e.pStart2.x - c.x);
      let diff = a2 - a1;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      const r = Math.min(distance(c, e.pStart1), distance(c, e.pStart2)) * 0.4;
      P.push({ kind: 'line', pts: [e.pStart1, c, e.pStart2], width: 0, minPx: 1, color: 'angle', layer: L('annot'), dashPx: [3, 3] });
      const s0 = diff >= 0 ? a1 : a1 + diff;
      P.push({ kind: 'arc', c, r, a0: s0, a1: s0 + Math.abs(diff), color: 'angle', layer: L('annot') });
      const mid = a1 + diff / 2;
      P.push({ kind: 'text', p: { x: c.x + Math.cos(mid) * r * 1.35, y: c.y + Math.sin(mid) * r * 1.35 }, text: `${e.angleDeg.toFixed(1)}°`, size: 0.6, color: 'angle', layer: L('annot'), fixedPx: 11 });
      break;
    }
  }
  return P;
}

/** 物件類型是否為「鋼筆路徑式」線型標線（共用節點編輯、鎖點、選取邏輯） */
export const PATH_LINE_TYPES = new Set([
  'guideline', 'yellow_double', 'white_double', 'white_dashed', 'yellow_dashed', 'white_solid',
  'crossing_dashed', 'stop_line', 'yield_line', 'Sidewalk', 'reversible_lane', 'BuildingLine',
  'red_solid', 'yellow_solid',
]);

/** 計算原語外框（m） */
export function primitivesBounds(prims: Primitive[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (p: Point2D) => {
    if (!p || !isFinite(p.x) || !isFinite(p.y)) return;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  };
  prims.forEach(pr => {
    if (pr.kind === 'line' || pr.kind === 'poly') pr.pts.forEach(add);
    else if (pr.kind === 'text') {
      const half = pr.size * Math.max(1, pr.text.length) * 0.5;
      add({ x: pr.p.x - half, y: pr.p.y - pr.size }); add({ x: pr.p.x + half, y: pr.p.y + pr.size });
    } else { add({ x: pr.c.x - pr.r, y: pr.c.y - pr.r }); add({ x: pr.c.x + pr.r, y: pr.c.y + pr.r }); }
  });
  return { minX, minY, maxX, maxY };
}

/** 數量計算：依標線類型統計長度（虛線只計實線段）與塗佈面積 */
export function computeQuantities(elements: CadElement[]) {
  const rows = new Map<string, { name: string; length: number; area: number; count: number }>();
  const bump = (key: string, length: number, area: number) => {
    const r = rows.get(key) || { name: MARKING_NAMES[key] || key, length: 0, area: 0, count: 0 };
    r.length += length; r.area += area; r.count += 1;
    rows.set(key, r);
  };
  const polyArea = (pts: Point2D[]) => {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  };
  elements.forEach(el => {
    const key = (el as any).hatchPattern === 'cross' ? 'grid_box' : el.type;
    if (['guideline', 'sketch_circle', 'measurement', 'angular_dimension', 'text', 'smart_path', 'three_center_curve', 'BuildingLine'].includes(el.type)) return;
    let len = 0, area = 0;
    getElementPrimitives(el, { includeConstruction: false, includeAnnotations: false }).forEach(pr => {
      if (pr.kind === 'line' && pr.width > 0) {
        const pts = pr.closed ? [...pr.pts, pr.pts[0]] : pr.pts;
        const pieces = pr.dash ? dashPolyline(pts, pr.dash[0], pr.dash[1]) : [pts];
        pieces.forEach(pc => { const l = polylineLength(pc); len += l; area += l * pr.width; });
      } else if (pr.kind === 'poly' && pr.fill && pr.fill !== 'gray' && pr.fill !== 'pink') {
        area += polyArea(pr.pts) - (pr.holes || []).reduce((s, h) => s + polyArea(h), 0);
      } else if (pr.kind === 'poly' && (pr.fill === 'gray' || pr.fill === 'pink')) {
        area += polyArea(pr.pts);
      }
    });
    bump(key, len, area);
  });
  return Array.from(rows.entries()).map(([key, r]) => ({ key, ...r }));
}

/**
 * 推測某點所在車道的行車方向（rad）。
 * 1. 優先找最近的分向限制線／分向線：台灣靠右行駛，點在中心線右側即與線同向。
 * 2. 否則對齊最近的任一縱向標線，方向取最接近 fallbackHeading 者。
 */
export function suggestHeading(pt: Point2D, elements: CadElement[], fallbackHeading = Math.PI / 2, maxDist = 20): number | null {
  const nearest = (types: string[]) => {
    let best: { d: number; dir: number; side: number } | null = null;
    elements.forEach(el => {
      if (!types.includes(el.type)) return;
      const pts = centerline(el, 20);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-9) continue;
        const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
        const fx = a.x + dx * t, fy = a.y + dy * t;
        const d = Math.hypot(pt.x - fx, pt.y - fy);
        if (d <= maxDist && (!best || d < best.d)) {
          best = { d, dir: Math.atan2(dy, dx), side: dx * (pt.y - a.y) - dy * (pt.x - a.x) };
        }
      }
    });
    return best as { d: number; dir: number; side: number } | null;
  };
  const center = nearest(['yellow_double', 'yellow_dashed']);
  if (center) return center.side < 0 ? center.dir : center.dir + Math.PI;
  const lane = nearest(['white_dashed', 'white_solid', 'white_double', 'reversible_lane']);
  if (!lane) return null;
  const diff = (a: number) => Math.abs(Math.atan2(Math.sin(a - fallbackHeading), Math.cos(a - fallbackHeading)));
  return diff(lane.dir) <= diff(lane.dir + Math.PI) ? lane.dir : lane.dir + Math.PI;
}

/** 物件所屬圖層鍵（圖層面板、顯示切換使用） */
export function layerKeyOf(el: CadElement): string {
  const t = el.type as string;
  if (t === 'island') return (el as any).hatchPattern === 'cross' ? 'grid_box' : 'island';
  if (t === 'parking_space' || t === 'parking_zone') return 'parking';
  if (t === 'moto_turn_box') return 'moto_box';
  if (t === 'measurement' || t === 'angular_dimension') return 'annot';
  if (t === 'guideline' || t === 'sketch_circle') return 'guide';
  if (t === 'three_center_curve') return 'curve';
  if (t === 'smart_path') return 'path';
  return LAYERS[t] ? t : 'guide';
}
