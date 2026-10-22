/**
 * 路徑建構：依來源類型（點選＋半徑／鋼筆／筆刷／路口）產生弧長參數化的引導線。
 *
 * - 各來源各自有固定的建構方式，不受「目前選取的繪圖工具」影響
 * - 點選模式以指定半徑的圓弧（可加回旋曲線緩和段）倒角，半徑可控制
 * - 只有筆刷手繪會做平滑；路口曲線直接採用解析貝茲曲線
 */
import { IntersectionParams, PathSource, PenNode, PolyNode, Pt } from './model';
import { add, cross, dir, dist, len, lerpPt, mul, normAngle, sub, unit } from './geom';

export const PATH_SPACING = 0.05;

export interface VertexInfo {
  index: number;
  /** 偏角（rad，左轉為正） */
  deflection: number;
  Rreq: number;
  Ract: number;
  LsReq: number;
  LsAct: number;
  T: number;
  limited: boolean;
}

export interface IntersectionHelpers {
  valid: boolean;
  I: Pt | null;
  c1: Pt;
  c2: Pt;
  I1?: Pt;
  I2?: Pt;
  I1base?: Pt;
  I2base?: Pt;
}

export interface BuiltPath {
  pts: Pt[];
  s: number[];
  heading: number[];
  length: number;
  warnings: string[];
  vertices?: VertexInfo[];
  helpers?: IntersectionHelpers;
}

/* ------------------------------------------------------------------ 共用 */

function dedupe(pts: Pt[], tol = 1e-6): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (!isFinite(p.x) || !isFinite(p.y)) continue;
    if (!out.length || dist(out[out.length - 1], p) > tol) out.push(p);
  }
  return out;
}

/** 依弧長等距重取樣，並以中央差分計算切線方向 */
export function resample(raw: Pt[], spacing = PATH_SPACING): { pts: Pt[]; s: number[]; heading: number[]; length: number } {
  const pts0 = dedupe(raw);
  if (pts0.length < 2) return { pts: pts0, s: pts0.map(() => 0), heading: pts0.map(() => 0), length: 0 };
  const cum = [0];
  for (let i = 1; i < pts0.length; i++) cum.push(cum[i - 1] + dist(pts0[i - 1], pts0[i]));
  const total = cum[cum.length - 1];
  const n = Math.max(1, Math.round(total / spacing));
  const step = total / n;
  const pts: Pt[] = [];
  const s: number[] = [];
  let seg = 1;
  for (let j = 0; j <= n; j++) {
    const target = j === n ? total : j * step;
    while (seg < pts0.length - 1 && cum[seg] < target) seg++;
    const a = pts0[seg - 1], b = pts0[seg];
    const segLen = cum[seg] - cum[seg - 1];
    const t = segLen > 0 ? Math.min(1, Math.max(0, (target - cum[seg - 1]) / segLen)) : 0;
    pts.push(lerpPt(a, b, t));
    s.push(target);
  }
  const heading = pts.map((_, k) => {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(pts.length - 1, k + 1)];
    return Math.atan2(b.y - a.y, b.x - a.x);
  });
  return { pts, s, heading, length: total };
}

/** 曲率分段（線性變化）積分產生點列 */
function integrateCurvature(start: Pt, h0: number, parts: { length: number; k0: number; k1: number }[], step = 0.02): { pts: Pt[]; h: number } {
  const out: Pt[] = [];
  let p = { ...start };
  let h = h0;
  for (const part of parts) {
    if (part.length <= 1e-9) continue;
    const n = Math.max(1, Math.ceil(part.length / step));
    const ds = part.length / n;
    for (let i = 0; i < n; i++) {
      const kA = part.k0 + (part.k1 - part.k0) * (i / n);
      const kB = part.k0 + (part.k1 - part.k0) * ((i + 1) / n);
      const dh = ((kA + kB) / 2) * ds;
      const hm = h + dh / 2;
      p = { x: p.x + ds * Math.cos(hm), y: p.y + ds * Math.sin(hm) };
      h += dh;
      out.push(p);
    }
  }
  return { pts: out, h };
}

/** 回旋曲線（曲率由 0 線性增加到 1/R，長度 Ls）終點座標 */
function clothoidEnd(R: number, Ls: number): { X: number; Y: number } {
  if (Ls <= 1e-9) return { X: 0, Y: 0 };
  const r = integrateCurvature({ x: 0, y: 0 }, 0, [{ length: Ls, k0: 0, k1: 1 / R }], Math.min(0.01, Ls / 50));
  const e = r.pts[r.pts.length - 1];
  return { X: e.x, Y: e.y };
}

/** 回旋曲線＋圓弧＋回旋曲線的切線長 T */
function tangentLength(R: number, Ls: number, absDelta: number): { T: number; Ls: number } {
  let L = Ls;
  if (L / R > absDelta) L = absDelta * R; // 緩和段過長時改為純回旋曲線
  const thetaS = L / (2 * R);
  const { X, Y } = clothoidEnd(R, L);
  const p = Y - R * (1 - Math.cos(thetaS));
  const k = X - R * Math.sin(thetaS);
  return { T: (R + p) * Math.tan(absDelta / 2) + k, Ls: L };
}

/* ------------------------------------------------------------------ 點選＋半徑 */

export function buildPolylineRaw(nodesIn: PolyNode[]): { pts: Pt[]; vertices: VertexInfo[]; warnings: string[] } {
  const nodes: PolyNode[] = [];
  nodesIn.forEach(n => {
    if (!nodes.length || dist(nodes[nodes.length - 1].p, n.p) > 1e-6) nodes.push(n);
  });
  const warnings: string[] = [];
  if (nodes.length < 2) return { pts: nodes.map(n => n.p), vertices: [], warnings };
  const segLen: number[] = [];
  for (let i = 1; i < nodes.length; i++) segLen.push(dist(nodes[i - 1].p, nodes[i].p));

  // 每個中間節點的需求切線長
  const req = nodes.map((n, i) => {
    if (i === 0 || i === nodes.length - 1) return null;
    const uin = unit(sub(n.p, nodes[i - 1].p));
    const uout = unit(sub(nodes[i + 1].p, n.p));
    const delta = normAngle(Math.atan2(uout.y, uout.x) - Math.atan2(uin.y, uin.x));
    const R = Math.max(0, n.R || 0);
    if (Math.abs(delta) < 1e-6) return { uin, uout, delta, R, Ls: 0, T: 0 };
    if (R <= 1e-6) return { uin, uout, delta, R: 0, Ls: 0, T: 0 };
    const absD = Math.min(Math.abs(delta), Math.PI - 1e-3);
    const tl = tangentLength(R, Math.max(0, n.Ls || 0), absD);
    return { uin, uout, delta, R, Ls: tl.Ls, T: tl.T };
  });

  // 相鄰兩個倒角共用一段直線：超過時依比例縮小
  const allowed = req.map(r => (r ? r.T : 0));
  for (let s = 0; s < segLen.length; s++) {
    const a = s; // 線段起點節點
    const b = s + 1;
    const ta = req[a] ? req[a]!.T : 0;
    const tb = req[b] ? req[b]!.T : 0;
    if (ta + tb > segLen[s] && ta + tb > 0) {
      const f = segLen[s] / (ta + tb);
      if (req[a]) allowed[a] = Math.min(allowed[a], ta * f);
      if (req[b]) allowed[b] = Math.min(allowed[b], tb * f);
    }
  }

  const vertices: VertexInfo[] = [];
  const out: Pt[] = [nodes[0].p];
  for (let i = 1; i < nodes.length - 1; i++) {
    const r = req[i]!;
    const B = nodes[i].p;
    if (r.T <= 1e-9) {
      out.push(B);
      vertices.push({ index: i, deflection: r.delta, Rreq: nodes[i].R, Ract: 0, LsReq: nodes[i].Ls, LsAct: 0, T: 0, limited: false });
      continue;
    }
    const f = Math.min(1, allowed[i] / r.T);
    const R = r.R * f;
    const Ls = r.Ls * f;
    const T = r.T * f;
    const sigma = Math.sign(r.delta);
    const absD = Math.abs(r.delta);
    const thetaS = Ls / (2 * R);
    const Lc = Math.max(0, R * (absD - 2 * thetaS));
    const TS = add(B, mul(r.uin, -T));
    const ST = add(B, mul(r.uout, T));
    const hIn = Math.atan2(r.uin.y, r.uin.x);
    const curve = integrateCurvature(TS, hIn, [
      { length: Ls, k0: 0, k1: sigma / R },
      { length: Lc, k0: sigma / R, k1: sigma / R },
      { length: Ls, k0: sigma / R, k1: 0 },
    ]);
    // 數值積分誤差線性分攤，使曲線終點精確落在 ST
    const end = curve.pts[curve.pts.length - 1] ?? TS;
    const err = sub(ST, end);
    const nC = curve.pts.length;
    out.push(TS);
    curve.pts.forEach((p, k) => out.push(add(p, mul(err, (k + 1) / nC))));
    vertices.push({ index: i, deflection: r.delta, Rreq: nodes[i].R, Ract: R, LsReq: nodes[i].Ls, LsAct: Ls, T, limited: f < 0.999 });
    if (f < 0.999) warnings.push(`第 ${i + 1} 點：直線段長度不足，半徑由 ${nodes[i].R.toFixed(1)} m 縮小為 ${R.toFixed(1)} m`);
  }
  out.push(nodes[nodes.length - 1].p);
  vertices.forEach(v => {
    if (v.Rreq > 0 && v.Ract === 0 && Math.abs(v.deflection) > 1e-6) warnings.push(`第 ${v.index + 1} 點：未設定半徑，形成尖角`);
  });
  return { pts: out, vertices, warnings };
}

/* ------------------------------------------------------------------ 鋼筆 */

function cubic(a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt {
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

export function buildPenRaw(nodes: PenNode[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    const A = nodes[i].p;
    const B = add(A, nodes[i].hOut);
    const D = nodes[i + 1].p;
    const C = add(D, nodes[i + 1].hIn);
    const ctrlLen = dist(A, B) + dist(B, C) + dist(C, D);
    const n = Math.max(8, Math.ceil(ctrlLen / 0.02));
    for (let j = i === 0 ? 0 : 1; j <= n; j++) out.push(cubic(A, B, C, D, j / n));
  }
  if (nodes.length === 1) out.push(nodes[0].p);
  return out;
}

/* ------------------------------------------------------------------ 筆刷 */

/** Ramer–Douglas–Peucker 簡化 */
export function simplifyRDP(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = -1, idx = -1;
    const ab = sub(pts[b], pts[a]);
    const L = len(ab);
    for (let i = a + 1; i < b; i++) {
      const d = L > 1e-12 ? Math.abs(cross(ab, sub(pts[i], pts[a]))) / L : dist(pts[i], pts[a]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = true;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

export function chaikin(pts: Pt[], iterations = 3): Pt[] {
  if (pts.length < 3) return pts.slice();
  let cur = pts.slice();
  for (let it = 0; it < iterations; it++) {
    const next: Pt[] = [cur[0]];
    for (let i = 0; i < cur.length - 1; i++) {
      next.push(lerpPt(cur[i], cur[i + 1], 0.25), lerpPt(cur[i], cur[i + 1], 0.75));
    }
    next.push(cur[cur.length - 1]);
    cur = next;
  }
  return cur;
}

export function buildFreehandRaw(points: Pt[]): Pt[] {
  return chaikin(simplifyRDP(dedupe(points), 0.05), 3);
}

/* ------------------------------------------------------------------ 路口轉彎 */

export function buildIntersectionRaw(params: IntersectionParams): { pts: Pt[]; helpers: IntersectionHelpers; warnings: string[] } | null {
  const { p0, p3 } = params;
  if (!p0 || !p3) return null;
  const warnings: string[] = [];
  const vA = dir(params.h0);
  const vB = dir(params.h3);
  const chord = dist(p0, p3);
  const D = cross(vA, vB);
  const w = sub(p3, p0);
  let I: Pt | null = null;
  let valid = false;
  if (Math.abs(D) > 0.02) {
    const t = cross(w, vB) / D;
    const u = cross(w, vA) / D;
    // 交點須在起點前方、終點後方，才是合理的轉彎
    if (t > 0.05 && u < -0.05) {
      I = add(p0, mul(vA, t));
      valid = true;
    }
  }
  const r1 = Math.min(1, Math.max(0.05, params.r1));
  const r2 = Math.min(1, Math.max(0.05, params.r2));
  let c1: Pt, c2: Pt;
  if (valid && I) {
    c1 = lerpPt(p0, I, r1);
    c2 = lerpPt(p3, I, r2);
  } else {
    // 平行（迴轉）或交點不合理：改以起訖切線控制，控制長度與弦長成比例
    const k1 = (chord * 0.667 * r1) / 0.7;
    const k2 = (chord * 0.667 * r2) / 0.7;
    c1 = add(p0, mul(vA, k1));
    c2 = add(p3, mul(vB, -k2));
    warnings.push(Math.abs(D) <= 0.02 ? '起訖方向平行（迴轉／平移），改以切線長度控制曲線' : '虛擬交點位於起點後方或終點前方，改以切線長度控制曲線；請確認起訖方向');
  }

  // 轉彎方向（左轉 +1、右轉 −1），外擺偏移朝轉彎外側
  const turn = Math.sign(cross(vA, sub(p3, valid && I ? I : p0))) || Math.sign(D) || 1;
  const curve: Pt[] = [];
  let helpers: IntersectionHelpers = { valid, I, c1, c2 };

  if (params.outswing) {
    const t1 = Math.min(1, Math.max(0, params.i1Pos));
    const t2 = Math.min(1, Math.max(0, params.i2Pos));
    const I1base = lerpPt(p0, c1, t1);
    const I2base = lerpPt(c2, p3, t2);
    const d1 = unit(sub(c1, p0));
    const d2 = unit(sub(p3, c2));
    const out1 = { x: turn * d1.y, y: -turn * d1.x }; // 轉彎外側法向量
    const out2 = { x: turn * d2.y, y: -turn * d2.x };
    const I1 = add(I1base, mul(out1, params.i1Off));
    const I2 = add(I2base, mul(out2, params.i2Off));
    helpers = { ...helpers, I1, I2, I1base, I2base };
    const tanI1 = unit(sub(I2, p0));
    const tanI2 = unit(sub(p3, I1));
    const seg = (a: Pt, ta: Pt, b: Pt, tb: Pt, first: boolean) => {
      const L = dist(a, b);
      const B = add(a, mul(ta, 0.35 * L));
      const C = add(b, mul(tb, -0.35 * L));
      const n = Math.max(16, Math.ceil(L / 0.02));
      for (let j = first ? 0 : 1; j <= n; j++) curve.push(cubic(a, B, C, b, j / n));
    };
    seg(p0, vA, I1, tanI1, true);
    seg(I1, tanI1, I2, tanI2, false);
    seg(I2, tanI2, p3, vB, false);
  } else {
    const ctrlLen = dist(p0, c1) + dist(c1, c2) + dist(c2, p3);
    const n = Math.max(32, Math.ceil(ctrlLen / 0.02));
    for (let j = 0; j <= n; j++) curve.push(cubic(p0, c1, c2, p3, j / n));
  }

  const pts: Pt[] = [];
  if (params.extStart > 0) pts.push(add(p0, mul(vA, -params.extStart)));
  pts.push(...curve);
  if (params.extEnd > 0) pts.push(add(p3, mul(vB, params.extEnd)));
  return { pts, helpers, warnings };
}

/* ------------------------------------------------------------------ 入口 */

export function buildPath(src: PathSource, spacing = PATH_SPACING): BuiltPath | null {
  let raw: Pt[] = [];
  let warnings: string[] = [];
  let vertices: VertexInfo[] | undefined;
  let helpers: IntersectionHelpers | undefined;
  switch (src.kind) {
    case 'polyline': {
      if (src.nodes.length < 2) return null;
      const r = buildPolylineRaw(src.nodes);
      raw = r.pts; vertices = r.vertices; warnings = r.warnings;
      break;
    }
    case 'pen':
      if (src.nodes.length < 2) return null;
      raw = buildPenRaw(src.nodes);
      break;
    case 'freehand':
      if (src.points.length < 2) return null;
      raw = buildFreehandRaw(src.points);
      break;
    case 'intersection': {
      const r = buildIntersectionRaw(src.params);
      if (!r) return null;
      raw = r.pts; helpers = r.helpers; warnings = r.warnings;
      break;
    }
  }
  const rs = resample(raw, spacing);
  if (rs.pts.length < 2 || rs.length < 1e-3) return null;
  return { ...rs, warnings, vertices, helpers };
}

/** 路徑上依弧長取點（線性內插） */
export function pointAtS(path: BuiltPath, s: number): { p: Pt; h: number; i: number } {
  const n = path.pts.length;
  if (s <= 0) return { p: path.pts[0], h: path.heading[0], i: 0 };
  if (s >= path.length) return { p: path.pts[n - 1], h: path.heading[n - 1], i: n - 1 };
  const step = path.length / (n - 1);
  const i = Math.min(n - 2, Math.floor(s / step));
  const t = (s - path.s[i]) / (path.s[i + 1] - path.s[i] || 1);
  return { p: lerpPt(path.pts[i], path.pts[i + 1], t), h: path.heading[i] + normAngle(path.heading[i + 1] - path.heading[i]) * t, i };
}
