/**
 * 軌跡模擬資料模型
 *
 * - 全部使用公尺與 CAD 世界座標（x 向東、y 向北），角度為數學角（rad，0 = 東，逆時針為正）
 * - 只儲存「來源幾何＋參數」，車輛姿態、掃掠範圍、檢核結果一律由純函式重新計算，不序列化
 */
import { Point2D } from '../types';

export type Pt = Point2D;

/** 點選繪製：折線節點，中間節點以半徑 R 的圓弧（可加回旋曲線緩和段 Ls）倒角 */
export interface PolyNode {
  p: Pt;
  /** 轉角半徑（m），端點不使用 */
  R: number;
  /** 回旋曲線緩和段長度（m），0 表示純圓弧 */
  Ls: number;
}

/** 鋼筆繪製：貝茲錨點，手柄為相對錨點的向量（m） */
export interface PenNode {
  p: Pt;
  hIn: Pt;
  hOut: Pt;
  /** true：兩側手柄保持共線（平滑）；false：可獨立調整（尖角） */
  smooth: boolean;
}

/** 路口轉彎產生器參數 */
export interface IntersectionParams {
  /** 起點（進入路口處）與行駛方向（rad） */
  p0: Pt | null;
  h0: number;
  /** 終點（離開路口處）與行駛方向（rad） */
  p3: Pt | null;
  h3: number;
  /** 控制點位置：由 P0／P3 往虛擬交點的比例（0.1–1.0） */
  r1: number;
  r2: number;
  /** 外擺：在入口段與出口段各加一個向外偏移的反曲點 */
  outswing: boolean;
  /** 反曲點位置（0–1，沿控制線）與向外偏移距離（m） */
  i1Pos: number;
  i1Off: number;
  i2Pos: number;
  i2Off: number;
  /** 起點前與終點後的直線延伸（m） */
  extStart: number;
  extEnd: number;
}

export type PathSource =
  | { kind: 'polyline'; nodes: PolyNode[] }
  | { kind: 'pen'; nodes: PenNode[] }
  | { kind: 'freehand'; points: Pt[] }
  | { kind: 'intersection'; params: IntersectionParams };

export type PathKind = PathSource['kind'];

export interface DriveSettings {
  /** 引導點：路徑代表前軸中心或後軸中心的軌跡 */
  guide: 'front' | 'rear';
  /** 行駛方向；倒車時一律以後軸中心為引導點 */
  direction: 'forward' | 'reverse';
  /** exact：精確沿路徑（超過轉角上限的路段標示為不可行）；limited：轉角受限追蹤（車輛實際可行的軌跡） */
  controller: 'exact' | 'limited';
  /** 轉角受限模式的前視距離（m） */
  lookahead: number;
  /** 轉向速率上限（°/m），0 表示不限制 */
  maxSteerRateDegPerM: number;
}

export interface SimPath {
  id: string;
  name: string;
  /** #rrggbb */
  color: string;
  source: PathSource;
  /** 套用的車種（可多選套疊比較） */
  vehicleIds: string[];
  drive: DriveSettings;
  visible: boolean;
  /** 防止誤改（鎖定後不可拖曳節點、不可刪除節點） */
  locked: boolean;
  /** 接續另一條軌跡的終點（多段前進／倒車操作），以其終點的車身與拖車方向為初始狀態 */
  chainFrom?: string | null;
}

export interface SimDisplay {
  swept: boolean;
  buffer: boolean;
  wheelTracks: boolean;
  cornerTracks: boolean;
  axleTracks: boolean;
  poses: boolean;
  helpers: boolean;
  /** 在 CAD 繪圖模式也顯示模擬結果（唯讀參考圖層） */
  showInCad: boolean;
}

export interface SimSettings {
  display: SimDisplay;
  /** 掃掠範圍不透明度（0–1，整片均勻） */
  sweptOpacity: number;
  /** 車體骨架繪製間距（m） */
  poseIntervalM: number;
  /** 淨距帶寬度（m），0 表示不檢核淨距 */
  bufferM: number;
  /** 動畫速度（km/h，僅影響播放，不影響軌跡） */
  animKmh: number;
  /** 新路徑預設轉角半徑（m） */
  defaultRadius: number;
  /** 新路徑預設車種 */
  defaultVehicleId: string;
  /** 槽化線視為實體槽化島（硬障礙） */
  islandIsHard: boolean;
}

export interface SimDoc {
  version: 2;
  paths: SimPath[];
  customVehicles: import('./vehicles').VehicleSpec[];
  settings: SimSettings;
}

export const PATH_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#a855f7', '#84cc16', '#ec4899'];

export const DEFAULT_DRIVE: DriveSettings = {
  guide: 'front',
  direction: 'forward',
  controller: 'exact',
  lookahead: 1.5,
  maxSteerRateDegPerM: 0,
};

export const DEFAULT_SETTINGS: SimSettings = {
  display: {
    swept: true,
    buffer: true,
    wheelTracks: true,
    cornerTracks: false,
    axleTracks: true,
    poses: true,
    helpers: true,
    showInCad: false,
  },
  sweptOpacity: 0.28,
  poseIntervalM: 3,
  bufferM: 0.3,
  animKmh: 15,
  defaultRadius: 12,
  defaultVehicleId: 'aashto-p',
  islandIsHard: false,
};

export const DEFAULT_INTERSECTION: IntersectionParams = {
  p0: null,
  h0: 0,
  p3: null,
  h3: Math.PI / 2,
  r1: 0.7,
  r2: 0.7,
  outswing: false,
  i1Pos: 0.5,
  i1Off: 0,
  i2Pos: 0.5,
  i2Off: 0,
  extStart: 0,
  extEnd: 10,
};

export function emptyDoc(): SimDoc {
  return { version: 2, paths: [], customVehicles: [], settings: structuredCloneSafe(DEFAULT_SETTINGS) };
}

export function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

let idCounter = 0;
export function newId(prefix = 'path'): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

export const PATH_KIND_LABEL: Record<PathKind, string> = {
  polyline: '點選＋半徑',
  intersection: '路口轉彎',
  pen: '鋼筆曲線',
  freehand: '筆刷手繪',
};

/** 路徑來源是否已有足夠節點可以建構 */
export function sourceIsBuildable(src: PathSource): boolean {
  switch (src.kind) {
    case 'polyline': return src.nodes.length >= 2;
    case 'pen': return src.nodes.length >= 2;
    case 'freehand': return src.points.length >= 2;
    case 'intersection': return !!src.params.p0 && !!src.params.p3;
  }
}

/** 數學角（rad）→ 方位角（°，北 = 0，順時針） */
export function headingToAzimuth(h: number): number {
  const deg = 90 - (h * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/** 方位角（°）→ 數學角（rad） */
export function azimuthToHeading(az: number): number {
  return ((90 - az) * Math.PI) / 180;
}
