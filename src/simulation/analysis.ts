/**
 * 掃掠範圍、輪跡、檢核指標與淨距（衝突）分析
 *
 * 掃掠範圍以「相鄰兩姿態車體外框的凸包」串接表示（略為保守、沒有縫隙），
 * 畫布繪製、淨距檢核都直接使用這組凸多邊形，外框聯集只在需要時（外框線、DXF）才計算。
 */
import * as pcNs from 'polygon-clipping';
import { Pt } from './model';
import { Pose, Trajectory, radiiFromSteer } from './kinematics';
import { BuiltPath } from './pathBuilder';
import { VehicleSpec, overallLength } from './vehicles';
import {
  BBox, SegmentGrid, add, bboxOf, bboxOverlap, closestOnSegment, convexHull, cross, dir, dist,
  distanceToPolygonEdges, leftNormal, mul, pointInPolygon, segmentsIntersect, sub,
} from './geom';

const pc: any = (pcNs as any).default ?? pcNs;

export type HullComp = 'body' | 'mirror' | 'trailer';
export interface Hull { pts: Pt[]; bbox: BBox; pose: number; comp: HullComp; /** 該姿態引導點的弧長位置 */ s: number }

export interface Tracks {
  frontAxle: Pt[];
  rearAxle: Pt[];
  trailerAxle?: Pt[];
  wheels: { name: string; pts: Pt[] }[];
  corners: { name: string; pts: Pt[] }[];
}

/* ------------------------------------------------------------------ 車體外框 */

const TIRE_INSET = 0.15;

function local(rear: Pt, h: number, x: number, y: number): Pt {
  const c = Math.cos(h), s = Math.sin(h);
  return { x: rear.x + x * c - y * s, y: rear.y + x * s + y * c };
}

export function bodyOutline(p: Pose, v: VehicleSpec): Pt[] {
  const w = v.W / 2;
  const xf = v.L + v.Of, xr = -v.Or;
  return [local(p.rear, p.heading, xf, w), local(p.rear, p.heading, xf, -w), local(p.rear, p.heading, xr, -w), local(p.rear, p.heading, xr, w)];
}

export function mirrorOutlines(p: Pose, v: VehicleSpec): Pt[][] {
  if (!(v.mirror > 0)) return [];
  const xf = v.L + v.Of;
  const x1 = Math.max(-v.Or, xf - 0.9), x2 = Math.max(-v.Or, xf - 0.5);
  const w = v.W / 2, m = v.mirror;
  return [1, -1].map(sg => [
    local(p.rear, p.heading, x1, sg * w), local(p.rear, p.heading, x2, sg * w),
    local(p.rear, p.heading, x2, sg * (w + m)), local(p.rear, p.heading, x1, sg * (w + m)),
  ]);
}

export function trailerOutline(p: Pose, v: VehicleSpec): Pt[] | null {
  if (!p.trailer || !v.trailer) return null;
  const t = v.trailer;
  const w = t.W / 2;
  const xf = t.Lt + t.Oft, xr = -t.Ort;
  const a = p.trailer.axle, h = p.trailer.heading;
  return [local(a, h, xf, w), local(a, h, xf, -w), local(a, h, xr, -w), local(a, h, xr, w)];
}

export function wheelPositions(p: Pose, v: VehicleSpec): { name: string; c: Pt; h: number; steered: boolean }[] {
  const w = Math.max(0.3, v.W / 2 - TIRE_INSET);
  const out = [
    { name: '左前輪', c: local(p.rear, p.heading, v.L, w), h: p.heading + p.steer, steered: true },
    { name: '右前輪', c: local(p.rear, p.heading, v.L, -w), h: p.heading + p.steer, steered: true },
    { name: '左後輪', c: local(p.rear, p.heading, 0, w), h: p.heading, steered: false },
    { name: '右後輪', c: local(p.rear, p.heading, 0, -w), h: p.heading, steered: false },
  ];
  if (p.trailer && v.trailer) {
    const tw = Math.max(0.3, v.trailer.W / 2 - TIRE_INSET);
    out.push(
      { name: '拖車左輪', c: local(p.trailer.axle, p.trailer.heading, 0, tw), h: p.trailer.heading, steered: false },
      { name: '拖車右輪', c: local(p.trailer.axle, p.trailer.heading, 0, -tw), h: p.trailer.heading, steered: false },
    );
  }
  return out;
}

/* ------------------------------------------------------------------ 掃掠凸包 */

export function sampleIndices(traj: Trajectory, intervalM: number): number[] {
  const n = traj.poses.length;
  if (n === 0) return [];
  const stride = Math.max(1, Math.round(intervalM / Math.max(1e-6, traj.step)));
  const idx: number[] = [];
  for (let i = 0; i < n; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  return idx;
}

export function sweepHulls(traj: Trajectory, v: VehicleSpec, intervalM = 0.25): Hull[] {
  const idx = sampleIndices(traj, intervalM);
  const hulls: Hull[] = [];
  const comps = (p: Pose): { comp: HullComp; pts: Pt[] }[] => {
    const list: { comp: HullComp; pts: Pt[] }[] = [{ comp: 'body', pts: bodyOutline(p, v) }];
    mirrorOutlines(p, v).forEach(m => list.push({ comp: 'mirror', pts: m }));
    const tr = trailerOutline(p, v);
    if (tr) list.push({ comp: 'trailer', pts: tr });
    return list;
  };
  if (idx.length === 1) {
    comps(traj.poses[idx[0]]).forEach(c => hulls.push({ pts: c.pts, bbox: bboxOf(c.pts), pose: idx[0], comp: c.comp, s: traj.poses[idx[0]].s }));
    return hulls;
  }
  let prev = comps(traj.poses[idx[0]]);
  for (let j = 1; j < idx.length; j++) {
    const cur = comps(traj.poses[idx[j]]);
    cur.forEach((c, k) => {
      const hp = convexHull([...c.pts, ...(prev[k]?.pts ?? [])]);
      hulls.push({ pts: hp, bbox: bboxOf(hp), pose: idx[j], comp: c.comp, s: traj.poses[idx[j]].s });
    });
    prev = cur;
  }
  return hulls;
}

/* ------------------------------------------------------------------ 輪跡 */

export function buildTracks(traj: Trajectory, v: VehicleSpec): Tracks {
  const idx = sampleIndices(traj, 0.1);
  const poses = idx.map(i => traj.poses[i]);
  const wheelNames = poses.length ? wheelPositions(poses[0], v).map(w => w.name) : [];
  const wheels = wheelNames.map(name => ({ name, pts: [] as Pt[] }));
  const corners: { name: string; pts: Pt[] }[] = ['左前角', '右前角', '右後角', '左後角'].map(name => ({ name, pts: [] }));
  if (v.trailer) ['拖車左前角', '拖車右前角', '拖車右後角', '拖車左後角'].forEach(name => corners.push({ name, pts: [] }));
  for (const p of poses) {
    wheelPositions(p, v).forEach((w, k) => wheels[k].pts.push(w.c));
    bodyOutline(p, v).forEach((c, k) => corners[k].pts.push(c));
    const tr = trailerOutline(p, v);
    if (tr) tr.forEach((c, k) => corners[4 + k].pts.push(c));
  }
  return {
    frontAxle: poses.map(p => p.front),
    rearAxle: poses.map(p => p.rear),
    trailerAxle: v.trailer ? poses.map(p => p.trailer!.axle) : undefined,
    wheels,
    corners,
  };
}

/* ------------------------------------------------------------------ 掃掠寬度 */

/** 直線 P + t·n 與凸多邊形的交集參數區間 */
function lineConvexInterval(P: Pt, n: Pt, poly: Pt[]): [number, number] | null {
  let lo = -Infinity, hi = Infinity;
  // 確保逆時針
  let area = 0;
  for (let i = 0; i < poly.length; i++) area += cross(poly[i], poly[(i + 1) % poly.length]);
  const sgn = area >= 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e = sub(b, a);
    // 內側：cross(e, X - a) * sgn >= 0
    const f0 = cross(e, sub(P, a)) * sgn;
    const f1 = cross(e, n) * sgn;
    if (Math.abs(f1) < 1e-12) {
      if (f0 < 0) return null;
      continue;
    }
    const t = -f0 / f1;
    if (f1 > 0) lo = Math.max(lo, t);
    else hi = Math.min(hi, t);
    if (lo > hi) return null;
  }
  return isFinite(lo) && isFinite(hi) ? [lo, hi] : null;
}

/**
 * 最大掃掠寬度：在引導線上每隔 sampleEvery 取一點，沿法線量測掃掠範圍寬度。
 * 只取引導點位於 [s − 2, s + reach] 的姿態（車體才可能覆蓋該斷面），避免把遠處路段算進來。
 */
export function maxSweptWidth(path: BuiltPath, hulls: Hull[], reach: number, sampleEvery = 0.5): { width: number; at: Pt | null } {
  let best = 0;
  let at: Pt | null = null;
  const order = hulls.map((_, i) => i).sort((a, b) => hulls[a].s - hulls[b].s);
  let lo = 0;
  const stride = Math.max(1, Math.round(sampleEvery / Math.max(1e-6, path.length / Math.max(1, path.pts.length - 1))));
  for (let k = 0; k < path.pts.length; k += stride) {
    const P = path.pts[k];
    const sP = path.s[k];
    const n = leftNormal(path.heading[k]);
    while (lo < order.length && hulls[order[lo]].s < sP - 2) lo++;
    const iv: [number, number][] = [];
    for (let j = lo; j < order.length; j++) {
      const h = hulls[order[j]];
      if (h.s > sP + reach) break;
      const r = lineConvexInterval(P, n, h.pts);
      if (r) iv.push(r);
    }
    if (!iv.length) continue;
    iv.sort((a, b) => a[0] - b[0]);
    // 合併區間並取包含 t = 0（引導點）的那一段
    let curLo = iv[0][0], curHi = iv[0][1];
    let width = 0;
    const consider = (a: number, b: number) => { if (a <= 1e-6 && b >= -1e-6) width = Math.max(width, b - a); };
    for (let i = 1; i < iv.length; i++) {
      if (iv[i][0] <= curHi + 1e-6) curHi = Math.max(curHi, iv[i][1]);
      else { consider(curLo, curHi); curLo = iv[i][0]; curHi = iv[i][1]; }
    }
    consider(curLo, curHi);
    if (width > best) { best = width; at = P; }
  }
  return { width: best, at };
}

/* ------------------------------------------------------------------ 淨距與衝突 */

export interface Obstacle {
  id: string;
  elementId: string;
  label: string;
  kind: 'hard' | 'soft';
  segs: [Pt, Pt][];
  polygon?: Pt[];
  bbox: BBox;
}

export type ConflictSeverity = 'intrusion' | 'clearance' | 'crossing';

export interface Conflict {
  obstacleId: string;
  elementId: string;
  label: string;
  kind: 'hard' | 'soft';
  severity: ConflictSeverity;
  /** 最小距離（m），相交為 0 */
  minDist: number;
  /** 侵入深度（m） */
  depth: number;
  at: Pt;
  /** 第一次發生的姿態索引 */
  pose: number;
}

function segVsConvex(a: Pt, b: Pt, hull: Pt[]): { d: number; point: Pt; depth: number } {
  const inA = pointInPolygon(a, hull), inB = pointInPolygon(b, hull);
  let hit = inA || inB;
  if (!hit) {
    for (let i = 0; i < hull.length && !hit; i++) if (segmentsIntersect(a, b, hull[i], hull[(i + 1) % hull.length])) hit = true;
  }
  if (hit) {
    // 沿線段取樣估計侵入深度與位置
    const L = dist(a, b);
    const n = Math.min(60, Math.max(2, Math.ceil(L / 0.1)));
    let depth = 0;
    let point = inA ? a : b;
    let found = false;
    for (let i = 0; i <= n; i++) {
      const p = { x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n };
      if (!pointInPolygon(p, hull)) continue;
      const d = distanceToPolygonEdges(p, hull);
      if (!found || d > depth) { depth = d; point = p; found = true; }
    }
    if (!found) {
      // 只擦過邊：取線段中點最接近者
      let bd = Infinity;
      for (let i = 0; i < hull.length; i++) {
        const r = closestOnSegment(hull[i], a, b);
        if (r.d < bd) { bd = r.d; point = r.point; }
      }
    }
    return { d: 0, point, depth };
  }
  let best = Infinity;
  let point = a;
  for (let i = 0; i < hull.length; i++) {
    const c = hull[i], d = hull[(i + 1) % hull.length];
    const r1 = closestOnSegment(c, a, b);
    if (r1.d < best) { best = r1.d; point = r1.point; }
    const r2 = closestOnSegment(a, c, d);
    if (r2.d < best) { best = r2.d; point = a; }
    const r3 = closestOnSegment(b, c, d);
    if (r3.d < best) { best = r3.d; point = b; }
  }
  return { d: best, point, depth: 0 };
}

export const CLEARANCE_RANGE = 3;

export function checkClearance(hulls: Hull[], obstacles: Obstacle[], bufferM: number): { conflicts: Conflict[]; minClearance: number | null } {
  const agg = new Map<string, Conflict>();
  let minClearance: number | null = null;
  // 量測範圍：淨距帶與 3 m 取大者（超過此距離的障礙物視為不影響，最小淨距回報為 null）
  const margin = Math.max(bufferM, CLEARANCE_RANGE) + 0.01;
  for (const ob of obstacles) {
    let obMin = Infinity, obDepth = 0, obAt: Pt | null = null, firstPose = -1;
    for (const h of hulls) {
      if (!bboxOverlap(h.bbox, ob.bbox, margin)) continue;
      const hb = { minX: h.bbox.minX - margin, minY: h.bbox.minY - margin, maxX: h.bbox.maxX + margin, maxY: h.bbox.maxY + margin };
      for (const [a, b] of ob.segs) {
        if (Math.max(a.x, b.x) < hb.minX || Math.min(a.x, b.x) > hb.maxX || Math.max(a.y, b.y) < hb.minY || Math.min(a.y, b.y) > hb.maxY) continue;
        const r = segVsConvex(a, b, h.pts);
        if (r.d < obMin) {
          obMin = r.d;
          if (obDepth === 0) obAt = r.point;
        }
        if (r.d === 0 && r.depth > obDepth) { obDepth = r.depth; obAt = r.point; }
        const violates = ob.kind === 'hard' ? r.d < bufferM || r.d === 0 : r.d === 0;
        if (violates && (firstPose < 0 || h.pose < firstPose)) firstPose = h.pose;
      }
      // 車體頂點落在人行道、槽化島內
      if (ob.polygon) {
        for (const p of h.pts) {
          if (pointInPolygon(p, ob.polygon)) {
            const d = distanceToPolygonEdges(p, ob.polygon);
            obMin = 0;
            if (d > obDepth) { obDepth = d; obAt = p; }
            if (firstPose < 0 || h.pose < firstPose) firstPose = h.pose;
          }
        }
      }
    }
    if (!isFinite(obMin)) continue;
    if (ob.kind === 'hard') {
      const signed = obMin > 0 ? obMin : -obDepth;
      minClearance = minClearance === null ? signed : Math.min(minClearance, signed);
    }
    let severity: ConflictSeverity | null = null;
    if (ob.kind === 'hard') severity = obMin === 0 ? 'intrusion' : obMin < bufferM ? 'clearance' : null;
    else severity = obMin === 0 ? 'crossing' : null;
    if (!severity || !obAt) continue;
    const key = ob.id;
    agg.set(key, { obstacleId: ob.id, elementId: ob.elementId, label: ob.label, kind: ob.kind, severity, minDist: obMin, depth: obDepth, at: obAt, pose: Math.max(0, firstPose) });
  }
  const order: Record<ConflictSeverity, number> = { intrusion: 0, clearance: 1, crossing: 2 };
  const conflicts = Array.from(agg.values()).sort((a, b) => order[a.severity] - order[b.severity] || b.depth - a.depth || a.minDist - b.minDist);
  return { conflicts, minClearance };
}

/* ------------------------------------------------------------------ 指標 */

export interface SimMetrics {
  length: number;
  maxSteerDeg: number;
  maxSteerAt: Pt | null;
  steerLimitDeg: number;
  infeasibleLength: number;
  /** 最急處前軸中心迴轉半徑 */
  minFrontRadius: number;
  /** 最急處後軸中心迴轉半徑 */
  minRearRadius: number;
  /** 最急處外側前角（含後照鏡）迴轉半徑 */
  outerCornerRadius: number;
  /** 最急處內側後輪迴轉半徑 */
  innerRearRadius: number;
  /** 最後一軸相對前軸軌跡的最大偏移 */
  offtracking: number;
  /** 同側前後輪軌跡最大偏移（內輪差） */
  wheelOfftracking: number;
  sweptWidth: number;
  sweptWidthAt: Pt | null;
  /** 轉角受限模式下前軸偏離路徑的最大距離 */
  maxDeviation: number;
  maxArticulationDeg: number;
  jackknife: boolean;
  minClearance: number | null;
}

/** 折線起點沿起始方向往後延伸 d */
function extendBack(pts: Pt[], d: number): Pt[] {
  if (pts.length < 2) return pts;
  let k = 1;
  while (k < pts.length - 1 && dist(pts[0], pts[k]) < 1e-6) k++;
  const back = sub(pts[0], pts[k]);
  const l = Math.hypot(back.x, back.y);
  if (l < 1e-9) return pts;
  return [add(pts[0], mul(back, d / l)), ...pts];
}

function polylineSegs(pts: Pt[]): [Pt, Pt][] {
  const segs: [Pt, Pt][] = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  return segs;
}

/** light = true 時略過較耗時的偏移量與掃掠寬度（拖曳中使用），以 NaN 表示未計算 */
export function computeMetrics(path: BuiltPath, traj: Trajectory, v: VehicleSpec, hulls: Hull[], tracks: Tracks, light = false): Omit<SimMetrics, 'minClearance'> {
  const poses = traj.poses;
  let maxAbs = 0, maxI = -1, infeasible = 0, maxDev = 0, maxArt = 0, jack = false;
  poses.forEach((p, i) => {
    const a = Math.abs(p.steer);
    if (a > maxAbs) { maxAbs = a; maxI = i; }
    if (!p.feasible) infeasible += traj.step;
    if (p.dev > maxDev) maxDev = p.dev;
    if (p.trailer) {
      const art = Math.abs(p.trailer.articulation);
      if (art > maxArt) maxArt = art;
    }
    if (p.jackknife) jack = true;
  });
  const { Rf, Rr } = radiiFromSteer(maxAbs, v.L);
  let outer = Infinity, inner = Infinity;
  if (maxI >= 0 && isFinite(Rr)) {
    const p = poses[maxI];
    const sg = Math.sign(p.steer) || 1;
    const icr = add(p.rear, mul(leftNormal(p.heading), sg * Rr));
    const frontPts = [...bodyOutline(p, v).slice(0, 2), ...mirrorOutlines(p, v).flat()];
    outer = Math.max(...frontPts.map(q => dist(icr, q)));
    // 穩態時拖車與牽引車共用瞬心，內側半徑取所有非轉向輪的最小值
    const rearWheels = wheelPositions(p, v).filter(w => !w.steered);
    inner = Math.min(...rearWheels.map(w => dist(icr, w.c)));
  }
  if (light) {
    return {
      length: path.length, maxSteerDeg: (maxAbs * 180) / Math.PI, maxSteerAt: maxI >= 0 ? poses[maxI].front : null,
      steerLimitDeg: v.maxSteerDeg, infeasibleLength: infeasible, minFrontRadius: Rf, minRearRadius: Rr,
      outerCornerRadius: outer, innerRearRadius: inner, offtracking: NaN, wheelOfftracking: NaN, sweptWidth: NaN,
      sweptWidthAt: null, maxDeviation: maxDev, maxArticulationDeg: (maxArt * 180) / Math.PI, jackknife: jack,
    };
  }
  // 最後一軸相對前軸軌跡（前軸軌跡往起點後方延伸，避免把起始位置的軸距誤算為偏移）
  const reachBack = v.L + (v.trailer ? v.trailer.Lt + Math.abs(v.trailer.hitchOffset) : 0) + 2;
  const frontGrid = new SegmentGrid(polylineSegs(extendBack(tracks.frontAxle, reachBack)), 2);
  const lastAxle = tracks.trailerAxle ?? tracks.rearAxle;
  let off = 0;
  for (let i = 0; i < lastAxle.length; i += 2) off = Math.max(off, frontGrid.nearest(lastAxle[i]));
  // 同側前後輪
  let wheelOff = 0;
  const pairs: [string, string][] = v.trailer ? [['左前輪', '拖車左輪'], ['右前輪', '拖車右輪']] : [['左前輪', '左後輪'], ['右前輪', '右後輪']];
  pairs.forEach(([f, r]) => {
    const ft = tracks.wheels.find(w => w.name === f);
    const rt = tracks.wheels.find(w => w.name === r);
    if (!ft || !rt) return;
    const g = new SegmentGrid(polylineSegs(extendBack(ft.pts, reachBack)), 2);
    for (let i = 0; i < rt.pts.length; i += 2) wheelOff = Math.max(wheelOff, g.nearest(rt.pts[i]));
  });
  const sw = maxSweptWidth(path, hulls, overallLength(v) + 4);
  return {
    length: path.length,
    maxSteerDeg: (maxAbs * 180) / Math.PI,
    maxSteerAt: maxI >= 0 ? poses[maxI].front : null,
    steerLimitDeg: v.maxSteerDeg,
    infeasibleLength: infeasible,
    minFrontRadius: Rf,
    minRearRadius: Rr,
    outerCornerRadius: outer,
    innerRearRadius: inner,
    offtracking: off,
    wheelOfftracking: wheelOff,
    sweptWidth: sw.width,
    sweptWidthAt: sw.at,
    maxDeviation: maxDev,
    maxArticulationDeg: (maxArt * 180) / Math.PI,
    jackknife: jack,
  };
}

/* ------------------------------------------------------------------ 外框聯集（匯出、外框線） */

function toPcPoly(pts: Pt[]): any {
  const ring = pts.map(p => [p.x, p.y]);
  ring.push([pts[0].x, pts[0].y]);
  return [ring];
}

/** 多個凸多邊形的聯集外框（回傳每個多邊形的環，第一個為外環） */
export function unionPolygons(polys: Pt[][]): Pt[][][] {
  const valid = polys.filter(p => p.length >= 3);
  if (!valid.length) return [];
  try {
    let parts: any[] = valid.map(toPcPoly);
    // 分批合併，降低單次運算量
    while (parts.length > 1) {
      const next: any[] = [];
      for (let i = 0; i < parts.length; i += 32) {
        const chunk = parts.slice(i, i + 32);
        next.push(chunk.length === 1 ? chunk[0] : pc.union(chunk[0], ...chunk.slice(1)));
      }
      parts = next;
    }
    const mp = parts[0];
    // 單一 Polygon（未經 union）時包成 MultiPolygon
    const multi: number[][][][] = Array.isArray(mp[0][0][0]) ? mp : [mp];
    return multi.map(poly => poly.map(ring => ring.slice(0, -1).map(([x, y]) => ({ x, y }))));
  } catch {
    return [];
  }
}

/** 將凸多邊形向外擴張 r（以 8 方向近似圓角） */
export function expandConvex(poly: Pt[], r: number): Pt[] {
  if (r <= 0) return poly;
  const pts: Pt[] = [];
  for (const p of poly) for (let k = 0; k < 12; k++) pts.push(add(p, mul(dir((k * Math.PI) / 6), r / Math.cos(Math.PI / 12))));
  return convexHull(pts);
}
