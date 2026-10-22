/**
 * 模擬資料的存檔、驗證與舊版轉換
 *
 * 新版（version 2）只儲存來源幾何與參數，載入時逐欄驗證並補上預設值。
 * 舊版（1.x）以像素座標（scale px/m）儲存並包含完整軌跡快照，載入時轉換為公尺與來源幾何。
 */
import {
  DEFAULT_DRIVE, DEFAULT_INTERSECTION, DEFAULT_SETTINGS, DriveSettings, IntersectionParams, PATH_COLORS,
  PathSource, PenNode, PolyNode, Pt, SimDoc, SimPath, SimSettings, emptyDoc, newId, structuredCloneSafe,
} from './model';
import { VEHICLE_LIBRARY, VehicleSpec, findVehicle, sanitizeVehicle } from './vehicles';

const isNum = (x: any): x is number => typeof x === 'number' && isFinite(x);
const num = (x: any, d: number, lo = -Infinity, hi = Infinity) => (isNum(x) ? Math.min(hi, Math.max(lo, x)) : d);
const pt = (x: any): Pt | null => (x && isNum(x.x) && isNum(x.y) ? { x: x.x, y: x.y } : null);
const bool = (x: any, d: boolean) => (typeof x === 'boolean' ? x : d);

/* ------------------------------------------------------------------ v2 驗證 */

function sanitizeDrive(d: any): DriveSettings {
  const o = d && typeof d === 'object' ? d : {};
  return {
    guide: o.guide === 'rear' ? 'rear' : 'front',
    direction: o.direction === 'reverse' ? 'reverse' : 'forward',
    controller: o.controller === 'limited' ? 'limited' : 'exact',
    lookahead: num(o.lookahead, DEFAULT_DRIVE.lookahead, 0.3, 20),
    maxSteerRateDegPerM: num(o.maxSteerRateDegPerM, 0, 0, 90),
  };
}

function sanitizeIntersection(p: any): IntersectionParams {
  const o = p && typeof p === 'object' ? p : {};
  const d = DEFAULT_INTERSECTION;
  return {
    p0: pt(o.p0), h0: num(o.h0, d.h0), p3: pt(o.p3), h3: num(o.h3, d.h3),
    r1: num(o.r1, d.r1, 0.05, 1), r2: num(o.r2, d.r2, 0.05, 1),
    outswing: bool(o.outswing, false),
    i1Pos: num(o.i1Pos, d.i1Pos, 0, 1), i1Off: num(o.i1Off, 0, -10, 10),
    i2Pos: num(o.i2Pos, d.i2Pos, 0, 1), i2Off: num(o.i2Off, 0, -10, 10),
    extStart: num(o.extStart, d.extStart, 0, 100), extEnd: num(o.extEnd, d.extEnd, 0, 100),
  };
}

export function sanitizeSource(s: any): PathSource | null {
  if (!s || typeof s !== 'object') return null;
  switch (s.kind) {
    case 'polyline': {
      const nodes: PolyNode[] = (Array.isArray(s.nodes) ? s.nodes : []).map((n: any) => {
        const p = pt(n?.p);
        return p ? { p, R: num(n.R, 0, 0, 1000), Ls: num(n.Ls, 0, 0, 500) } : null;
      }).filter(Boolean);
      return { kind: 'polyline', nodes };
    }
    case 'pen': {
      const nodes: PenNode[] = (Array.isArray(s.nodes) ? s.nodes : []).map((n: any) => {
        const p = pt(n?.p);
        return p ? { p, hIn: pt(n.hIn) ?? { x: 0, y: 0 }, hOut: pt(n.hOut) ?? { x: 0, y: 0 }, smooth: bool(n.smooth, true) } : null;
      }).filter(Boolean);
      return { kind: 'pen', nodes };
    }
    case 'freehand':
      return { kind: 'freehand', points: (Array.isArray(s.points) ? s.points : []).map(pt).filter(Boolean) as Pt[] };
    case 'intersection':
      return { kind: 'intersection', params: sanitizeIntersection(s.params) };
  }
  return null;
}

function sanitizeSettings(s: any): SimSettings {
  const o = s && typeof s === 'object' ? s : {};
  const d = DEFAULT_SETTINGS;
  const disp = o.display && typeof o.display === 'object' ? o.display : {};
  return {
    display: {
      swept: bool(disp.swept, d.display.swept),
      buffer: bool(disp.buffer, d.display.buffer),
      wheelTracks: bool(disp.wheelTracks, d.display.wheelTracks),
      cornerTracks: bool(disp.cornerTracks, d.display.cornerTracks),
      axleTracks: bool(disp.axleTracks, d.display.axleTracks),
      poses: bool(disp.poses, d.display.poses),
      helpers: bool(disp.helpers, d.display.helpers),
      showInCad: bool(disp.showInCad, d.display.showInCad),
    },
    sweptOpacity: num(o.sweptOpacity, d.sweptOpacity, 0.05, 1),
    poseIntervalM: num(o.poseIntervalM, d.poseIntervalM, 0.5, 50),
    bufferM: num(o.bufferM, d.bufferM, 0, 5),
    animKmh: num(o.animKmh, d.animKmh, 1, 120),
    defaultRadius: num(o.defaultRadius, d.defaultRadius, 0, 200),
    defaultVehicleId: typeof o.defaultVehicleId === 'string' ? o.defaultVehicleId : d.defaultVehicleId,
    islandIsHard: bool(o.islandIsHard, d.islandIsHard),
  };
}

export function sanitizeDoc(json: any): SimDoc {
  const doc = emptyDoc();
  if (!json || typeof json !== 'object') return doc;
  doc.customVehicles = (Array.isArray(json.customVehicles) ? json.customVehicles : [])
    .map(sanitizeVehicle).filter(Boolean) as VehicleSpec[];
  doc.settings = sanitizeSettings(json.settings);
  const known = (id: string) => !!findVehicle(id, doc.customVehicles);
  if (!known(doc.settings.defaultVehicleId)) doc.settings.defaultVehicleId = DEFAULT_SETTINGS.defaultVehicleId;
  doc.paths = (Array.isArray(json.paths) ? json.paths : []).map((p: any, i: number): SimPath | null => {
    const source = sanitizeSource(p?.source);
    if (!source) return null;
    const vehicleIds = (Array.isArray(p.vehicleIds) ? p.vehicleIds : []).filter((id: any) => typeof id === 'string' && known(id));
    return {
      id: typeof p.id === 'string' ? p.id : newId(),
      name: typeof p.name === 'string' ? p.name : `軌跡 ${i + 1}`,
      color: typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : PATH_COLORS[i % PATH_COLORS.length],
      source,
      vehicleIds: vehicleIds.length ? vehicleIds : [doc.settings.defaultVehicleId],
      drive: sanitizeDrive(p.drive),
      visible: bool(p.visible, true),
      locked: bool(p.locked, false),
      chainFrom: typeof p.chainFrom === 'string' ? p.chainFrom : null,
    };
  }).filter(Boolean) as SimPath[];
  // 接續關係：參照不存在或形成循環者移除
  const ids = new Set(doc.paths.map(p => p.id));
  doc.paths.forEach(p => {
    if (p.chainFrom && !ids.has(p.chainFrom)) p.chainFrom = null;
  });
  doc.paths.forEach(p => {
    const seen = new Set<string>([p.id]);
    let cur = p.chainFrom;
    while (cur) {
      if (seen.has(cur)) { p.chainFrom = null; break; }
      seen.add(cur);
      cur = doc.paths.find(x => x.id === cur)?.chainFrom ?? null;
    }
  });
  return doc;
}

/* ------------------------------------------------------------------ 舊版轉換 */

const LEGACY_COLORS: Record<string, string> = { indigo: '#6366f1', emerald: '#10b981', amber: '#f59e0b', rose: '#f43f5e', sky: '#0ea5e9' };

function legacyColor(c: any, i: number): string {
  if (typeof c === 'string') {
    if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
    if (LEGACY_COLORS[c]) return LEGACY_COLORS[c];
  }
  return PATH_COLORS[i % PATH_COLORS.length];
}

/** 舊版車輛設定 → 車輛庫 id（尺寸相符的舊版預設，否則建立自訂車種） */
function legacyVehicle(cfg: any, custom: VehicleSpec[]): string {
  if (!cfg || typeof cfg !== 'object') return 'standard-sedan';
  const same = (v: VehicleSpec) =>
    Math.abs(v.L - cfg.L) < 1e-6 && Math.abs(v.W - cfg.W) < 1e-6 && Math.abs(v.Of - cfg.Of) < 1e-6 && Math.abs(v.Or - cfg.Or) < 1e-6 &&
    Math.abs(v.maxSteerDeg - (cfg.maxSteerLimit ?? 40)) < 1e-6 && !!v.trailer === !!cfg.enableTrailer &&
    (!v.trailer || (Math.abs(v.trailer.Lt - (cfg.Lt ?? 7.5)) < 1e-6 && Math.abs(v.trailer.Oft - (cfg.Oft ?? 1)) < 1e-6 && Math.abs(v.trailer.Ort - (cfg.Ort ?? 1.8)) < 1e-6 && Math.abs(v.trailer.W - (cfg.Wt ?? 2.5)) < 1e-6));
  const hit = VEHICLE_LIBRARY.filter(v => v.category === 'legacy').find(same) || custom.find(same);
  if (hit) return hit.id;
  const v = sanitizeVehicle({
    id: newId('veh'), name: `自訂車種 ${custom.length + 1}（舊檔）`, short: `自訂 ${custom.length + 1}`,
    source: '由舊版專案檔轉入', L: cfg.L, W: cfg.W, Of: cfg.Of, Or: cfg.Or, maxSteerDeg: cfg.maxSteerLimit ?? 40, mirror: 0,
    trailer: cfg.enableTrailer ? { hitchOffset: 0, Lt: cfg.Lt ?? 7.5, W: cfg.Wt ?? 2.5, Oft: cfg.Oft ?? 1, Ort: cfg.Ort ?? 1.8, maxArticulationDeg: 70 } : undefined,
  });
  if (!v) return 'standard-sedan';
  custom.push(v);
  return v.id;
}

/** 舊版路口參數（px、度、百分比）→ 新版（m、rad、比例）。舊版偏移量正值朝轉彎內側，新版正值朝外側。 */
function legacyIntersection(ip: any, scale: number): IntersectionParams {
  return sanitizeIntersection({
    p0: isNum(ip.p0X) && isNum(ip.p0Y) ? { x: ip.p0X / scale, y: ip.p0Y / scale } : null,
    h0: (num(ip.p0Angle, 0) * Math.PI) / 180,
    p3: isNum(ip.p3X) && isNum(ip.p3Y) ? { x: ip.p3X / scale, y: ip.p3Y / scale } : null,
    h3: (num(ip.p3Angle, -90) * Math.PI) / 180,
    r1: num(ip.p1RatioPercent, 70) / 100,
    r2: num(ip.p2RatioPercent, 70) / 100,
    outswing: !!ip.enableOutswing,
    i1Pos: num(ip.i1RatioPercent, 100) / 100,
    i1Off: -num(ip.i1OffsetDistance, 0) || 0,
    i2Pos: num(ip.i2RatioPercent, 100) / 100,
    i2Off: -num(ip.i2OffsetDistance, 0) || 0,
    extStart: num(ip.startExtensionM, 0),
    extEnd: num(ip.endExtensionM, 10),
  });
}

/** 舊版原始節點 → 來源幾何。點選、筆刷模式在舊版都以 Chaikin 平滑，轉為筆刷手繪可保留原形狀。 */
function legacySource(rawPoints: any[], drawMode: any, scale: number, ip: any): PathSource | null {
  if (ip) return { kind: 'intersection', params: legacyIntersection(ip, scale) };
  const wps = (Array.isArray(rawPoints) ? rawPoints : []).filter(w => w && isNum(w.x) && isNum(w.y));
  if (wps.length < 2) return null;
  const P = (w: any): Pt => ({ x: w.x / scale, y: w.y / scale });
  const H = (h: any): Pt => (h && isNum(h.x) && isNum(h.y) ? { x: h.x / scale, y: h.y / scale } : { x: 0, y: 0 });
  const hasHandles = wps.some(w => (w.handleOut && (w.handleOut.x || w.handleOut.y)) || (w.handleIn && (w.handleIn.x || w.handleIn.y)));
  if (drawMode === 'smartpath' || (drawMode !== 'click' && drawMode !== 'drag' && hasHandles)) {
    return {
      kind: 'pen',
      nodes: wps.map(w => {
        const hIn = H(w.handleIn), hOut = H(w.handleOut);
        const smooth = Math.abs(hIn.x * hOut.y - hIn.y * hOut.x) < 1e-6 && hIn.x * hOut.x + hIn.y * hOut.y <= 0;
        return { p: P(w), hIn, hOut, smooth };
      }),
    };
  }
  return { kind: 'freehand', points: wps.map(P) };
}

export function migrateLegacy(sim: any): SimDoc {
  const doc = emptyDoc();
  if (!sim || typeof sim !== 'object') return doc;
  const cfg = sim.simConfig || {};
  const scale = isNum(cfg.scale) && cfg.scale > 0 ? cfg.scale : 25;
  const guide = (cfg.reverse ? 'rear' : 'front') as DriveSettings['guide'];
  const controller = sim.simControllerMode === 'ACTIVE_PURE_PURSUIT' ? 'limited' : 'exact';
  const drive = (c: any): DriveSettings => ({
    ...DEFAULT_DRIVE,
    guide: c?.reverse ? 'rear' : guide,
    direction: c?.reverse ? 'reverse' : 'forward',
    controller: c?.reverse ? 'exact' : controller,
  });
  const locked = Array.isArray(sim.simLockedPaths) ? sim.simLockedPaths : [];
  locked.forEach((lp: any, i: number) => {
    const lpScale = isNum(lp?.config?.scale) && lp.config.scale > 0 ? lp.config.scale : scale;
    const source = legacySource(lp?.rawPoints, lp?.drawMode, lpScale, lp?.intersectionParams);
    if (!source) return;
    doc.paths.push({
      id: typeof lp.id === 'string' ? lp.id : newId(),
      name: `軌跡 ${doc.paths.length + 1}`,
      color: legacyColor(lp.themeColor, i),
      source,
      vehicleIds: [legacyVehicle(lp.config, doc.customVehicles)],
      drive: drive(lp.config),
      visible: true,
      locked: false,
      chainFrom: null,
    });
  });
  // 舊版「編輯中」的軌跡
  const ip = sim.simIsIntersectionMode && isNum(sim.simP0X) && isNum(sim.simP3X)
    ? {
        p0X: sim.simP0X, p0Y: sim.simP0Y, p0Angle: sim.simP0Angle, p3X: sim.simP3X, p3Y: sim.simP3Y, p3Angle: sim.simP3Angle,
        p1RatioPercent: sim.simP1RatioPercent, p2RatioPercent: sim.simP2RatioPercent, enableOutswing: sim.simEnableOutswing,
        i1RatioPercent: sim.simI1RatioPercent, i1OffsetDistance: sim.simI1OffsetDistance, i2RatioPercent: sim.simI2RatioPercent,
        i2OffsetDistance: sim.simI2OffsetDistance, startExtensionM: sim.simStartExtensionM, endExtensionM: sim.simEndExtensionM,
      }
    : null;
  const current = legacySource(sim.simRawPoints, undefined, scale, ip);
  if (current) {
    doc.paths.push({
      id: newId(), name: `軌跡 ${doc.paths.length + 1}（舊檔編輯中）`, color: PATH_COLORS[doc.paths.length % PATH_COLORS.length],
      source: current, vehicleIds: [legacyVehicle(cfg, doc.customVehicles)], drive: drive(cfg), visible: true, locked: false, chainFrom: null,
    });
  }
  if (isNum(cfg.speed)) doc.settings.animKmh = Math.min(120, Math.max(1, cfg.speed * 3.6));
  return doc;
}

/** 讀取專案中的 simulation 欄位（新版或舊版皆可） */
export function loadSimulation(sim: any): SimDoc {
  if (sim && typeof sim === 'object' && sim.version === 2) return sanitizeDoc(sim);
  if (sim && typeof sim === 'object' && ('simLockedPaths' in sim || 'simRawPoints' in sim || 'simConfig' in sim)) return migrateLegacy(sim);
  return emptyDoc();
}

export function serializeSimulation(doc: SimDoc): SimDoc {
  return structuredCloneSafe(doc);
}
