/**
 * 設計車輛庫（CAD 檢核與軌跡模擬共用的單一來源）
 *
 * 尺寸以單軌（bicycle）運動學模型描述：
 *   L  ：軸距（前軸中心到後軸中心；串列後軸取兩軸中點的等效軸距）
 *   W  ：車寬（不含後照鏡）
 *   Of ：前懸（前軸到車頭）
 *   Or ：後懸（後軸到車尾）
 *   mirror：後照鏡單側外凸量（只用於掃掠範圍）
 * 半聯結車的拖車：
 *   hitchOffset：聯結點（第五輪）相對牽引車後軸的位置，往前為正
 *   Lt ：聯結點到拖車後軸中心的距離
 *   Oft：拖車在聯結點前方的長度；Ort：拖車後軸到車尾
 *
 * 數值來源寫在每一筆的 source 欄位；送審前請依交通部《公路路線設計規範》等主管機關最新公告版本核對。
 */

export interface TrailerSpec {
  hitchOffset: number;
  Lt: number;
  W: number;
  Oft: number;
  Ort: number;
  /** 牽引車與拖車的最大折角（°），超過即判定為 jackknife */
  maxArticulationDeg: number;
}

export type VehicleCategory = 'passenger' | 'truck' | 'bus' | 'articulated' | 'custom' | 'legacy';

export interface VehicleSpec {
  id: string;
  name: string;
  /** 短名稱（圖例、清單用） */
  short: string;
  category: VehicleCategory;
  /** 數值出處 */
  source: string;
  note?: string;
  L: number;
  W: number;
  Of: number;
  Or: number;
  maxSteerDeg: number;
  mirror: number;
  /** 後軸數（僅影響繪圖；運動學採等效軸距） */
  rearAxles?: number;
  trailer?: TrailerSpec;
  /** 自訂車種的原始車種 id */
  baseId?: string;
}

const deg = (r: number) => (r * 180) / Math.PI;

/**
 * 由最小設計轉彎半徑（外前輪軌跡半徑）反算最大前輪轉角。
 * 外前輪位於後軸前方 L、距瞬心 R_r + W/2（以車寬近似輪距），故 R_o² = L² + (R_r + W/2)²。
 */
export function steerFromOuterWheelRadius(L: number, W: number, Ro: number): number {
  const lateral = Math.sqrt(Math.max(0, Ro * Ro - L * L)) - W / 2;
  if (lateral <= 0) return 89;
  return deg(Math.atan(L / lateral));
}

/** 最大轉角時的外前輪軌跡半徑（m） */
export function outerWheelRadius(v: Pick<VehicleSpec, 'L' | 'W' | 'maxSteerDeg'>): number {
  const d = (v.maxSteerDeg * Math.PI) / 180;
  if (d <= 1e-6) return Infinity;
  const Rr = v.L / Math.tan(d);
  return Math.hypot(v.L, Rr + v.W / 2);
}

/** 最大轉角時的前軸中心迴轉半徑 CTR（m） */
export function minFrontAxleRadius(v: Pick<VehicleSpec, 'L' | 'maxSteerDeg'>): number {
  const d = (v.maxSteerDeg * Math.PI) / 180;
  if (d <= 1e-6) return Infinity;
  return v.L / Math.sin(d);
}

/** 車輛全長（m） */
export function overallLength(v: VehicleSpec): number {
  if (!v.trailer) return v.L + v.Of + v.Or;
  const t = v.trailer;
  // 以牽引車後軸為原點，往前為正
  const front = Math.max(v.L + v.Of, t.hitchOffset + t.Oft);
  const rear = Math.max(v.Or, t.Lt + t.Ort - t.hitchOffset);
  return front + rear;
}

const AASHTO_SRC = 'AASHTO《A Policy on Geometric Design of Highways and Streets》（2011）表 2-1b、2-2b 公制設計車輛尺寸與最小設計轉彎半徑；最大轉角由最小轉彎半徑反算';

function aashto(
  id: string, name: string, short: string, category: VehicleCategory,
  L: number, W: number, Of: number, Or: number, minTurnRadius: number,
  extra: Partial<VehicleSpec> = {},
): VehicleSpec {
  return {
    id, name, short, category, L, W, Of, Or,
    maxSteerDeg: Math.round(steerFromOuterWheelRadius(L, W, minTurnRadius) * 10) / 10,
    mirror: 0,
    source: `${AASHTO_SRC}（最小設計轉彎半徑 ${minTurnRadius} m）`,
    ...extra,
  };
}

export const VEHICLE_LIBRARY: VehicleSpec[] = [
  aashto('aashto-p', '小客車（P）', '小客車', 'passenger', 3.4, 2.1, 0.9, 1.5, 7.3),
  aashto('aashto-su9', '單體貨車（SU-9）', '單體貨車', 'truck', 6.1, 2.4, 1.2, 1.8, 12.8, { rearAxles: 1 }),
  aashto('aashto-bus', '市區公車（CITY-BUS）', '市區公車', 'bus', 7.6, 2.6, 2.1, 2.4, 12.8),
  aashto('aashto-wb12', '半聯結車（WB-12）', '半聯結車', 'articulated', 3.8, 2.4, 0.9, 0.6, 12.2, {
    note: '牽引車後懸與聯結點位置為估計值（聯結點設於牽引車後軸）',
    trailer: { hitchOffset: 0, Lt: 8.4, W: 2.4, Oft: 0.9, Ort: 0.8, maxArticulationDeg: 70 },
    rearAxles: 2,
  }),
  // 舊版預設：保留以相容舊專案檔，未標示出處
  {
    id: 'standard-sedan', name: '標準自小客車（舊版預設）', short: '舊版小客車', category: 'legacy',
    L: 2.7, W: 1.8, Of: 0.9, Or: 1.0, maxSteerDeg: 40, mirror: 0,
    source: '舊版軟體預設值，未標示出處；僅供開啟舊檔，請勿作為審查依據',
  },
  {
    id: 'taiwan-bus', name: '大客車（舊版預設）', short: '舊版大客車', category: 'legacy',
    L: 5.8, W: 2.5, Of: 2.2, Or: 3.3, maxSteerDeg: 40, mirror: 0,
    source: '舊版軟體預設值，未標示出處；僅供開啟舊檔，請勿作為審查依據',
  },
  {
    id: 'taiwan-truck', name: '大貨車（舊版預設）', short: '舊版大貨車', category: 'legacy',
    L: 5.6, W: 2.5, Of: 1.5, Or: 2.9, maxSteerDeg: 40, mirror: 0,
    source: '舊版軟體預設值，未標示出處；僅供開啟舊檔，請勿作為審查依據',
  },
  {
    id: 'taiwan-trailer', name: '聯結半拖車（舊版預設）', short: '舊版聯結車', category: 'legacy',
    L: 3.5, W: 2.5, Of: 1.0, Or: 0.8, maxSteerDeg: 40, mirror: 0,
    trailer: { hitchOffset: 0, Lt: 7.5, W: 2.5, Oft: 1.4, Ort: 1.8, maxArticulationDeg: 70 },
    source: '舊版軟體預設值，未標示出處；僅供開啟舊檔，請勿作為審查依據',
  },
];

export const CATEGORY_LABEL: Record<VehicleCategory, string> = {
  passenger: '小型車',
  truck: '大貨車',
  bus: '大客車',
  articulated: '聯結車',
  custom: '自訂',
  legacy: '舊版預設',
};

/** CAD 繪圖端「設計車種」三分類對應到車輛庫（槽化島加寬、引導線半徑檢核共用） */
export type CadDesignVehicle = 'passenger' | 'semi_trailer' | 'articulated';
export const CAD_VEHICLE_MAP: Record<CadDesignVehicle, string> = {
  passenger: 'aashto-p',
  semi_trailer: 'aashto-bus',
  articulated: 'aashto-wb12',
};

export function findVehicle(id: string, custom: VehicleSpec[] = []): VehicleSpec | undefined {
  return custom.find(v => v.id === id) || VEHICLE_LIBRARY.find(v => v.id === id);
}

export function cadVehicle(dv: CadDesignVehicle): VehicleSpec {
  return findVehicle(CAD_VEHICLE_MAP[dv])!;
}

/** CAD 引導線的最小曲率半徑門檻：取該車種最大轉角時的前軸中心迴轉半徑 */
export function cadMinPathRadius(dv: CadDesignVehicle): number {
  return Math.round(minFrontAxleRadius(cadVehicle(dv)) * 10) / 10;
}

/** 驗證並修正車輛數值（載入檔案、使用者輸入共用） */
export function sanitizeVehicle(v: any): VehicleSpec | null {
  if (!v || typeof v !== 'object' || typeof v.id !== 'string') return null;
  const num = (x: any, lo: number, hi: number, d: number) => (typeof x === 'number' && isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d);
  const out: VehicleSpec = {
    id: v.id,
    name: typeof v.name === 'string' ? v.name : '自訂車種',
    short: typeof v.short === 'string' ? v.short : (typeof v.name === 'string' ? v.name : '自訂'),
    category: 'custom',
    source: typeof v.source === 'string' ? v.source : '使用者自訂',
    note: typeof v.note === 'string' ? v.note : undefined,
    L: num(v.L, 0.5, 20, 3),
    W: num(v.W, 0.5, 4, 2),
    Of: num(v.Of, 0, 6, 1),
    Or: num(v.Or, 0, 8, 1),
    maxSteerDeg: num(v.maxSteerDeg, 5, 60, 35),
    mirror: num(v.mirror, 0, 0.6, 0),
    rearAxles: v.rearAxles === 2 ? 2 : 1,
    baseId: typeof v.baseId === 'string' ? v.baseId : undefined,
  };
  if (v.trailer && typeof v.trailer === 'object') {
    const t = v.trailer;
    out.trailer = {
      hitchOffset: num(t.hitchOffset, -3, 3, 0),
      Lt: num(t.Lt, 1, 20, 7.5),
      W: num(t.W, 0.5, 4, 2.5),
      Oft: num(t.Oft, 0, 5, 1),
      Ort: num(t.Ort, 0, 8, 1.5),
      maxArticulationDeg: num(t.maxArticulationDeg, 20, 90, 70),
    };
  }
  return out;
}
