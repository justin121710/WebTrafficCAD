/**
 * 低速車輛運動學（單軌 bicycle 模型＋半拖車），單位：公尺、弧度
 *
 * 三種模式：
 *  1. 前軸精確跟隨（guide = front, controller = exact）
 *     前軸中心沿路徑，後軸以曳物線（tractrix）跟隨。前輪轉角 = 路徑切線 − 車身方向。
 *     超過最大轉角的路段仍照路徑計算，但標示為「不可行」並計入不可行長度。
 *  2. 後軸沿路徑（guide = rear），可前進或倒車
 *     車身方向 = 路徑切線（倒車時反向），前輪轉角 δ = atan(±L·κ)。
 *  3. 轉角受限追蹤（guide = front, controller = limited）
 *     前軸以前視點追蹤路徑，轉角限制在 ±δmax（可加轉向速率限制），
 *     依 θ' = sinδ / L 積分，得到車輛實際可行的軌跡與偏離量。
 *
 * 拖車一律以「聯結點拉動拖車後軸」的投影法計算；此法對前進與倒車都是限制條件的一階正確離散。
 */
import { DriveSettings, Pt } from './model';
import { BuiltPath, pointAtS } from './pathBuilder';
import { VehicleSpec } from './vehicles';
import { add, dir, dist, mul, normAngle, sub, unit } from './geom';

export interface TrailerPose {
  hitch: Pt;
  axle: Pt;
  heading: number;
  /** 牽引車與拖車折角（rad） */
  articulation: number;
}

export interface Pose {
  /** 引導點在路徑上的弧長位置（m） */
  s: number;
  rear: Pt;
  front: Pt;
  heading: number;
  /** 前輪轉角（rad，左正） */
  steer: number;
  feasible: boolean;
  /** 引導點偏離路徑的距離（m，轉角受限模式） */
  dev: number;
  trailer?: TrailerPose;
  jackknife?: boolean;
}

export type SimStatus = 'ok' | 'infeasible' | 'truncated' | 'diverged';

export interface Trajectory {
  poses: Pose[];
  status: SimStatus;
  messages: string[];
  /** 相鄰姿態間距（m） */
  step: number;
}

const STEER_TOL = (0.05 * Math.PI) / 180;

/** 前軸中心迴轉半徑 Rf → 前輪轉角與後軸半徑（單一換算函式，介面、上色、檢核共用） */
export function steerFromFrontRadius(Rf: number, L: number): { delta: number; Rr: number; feasible: boolean } {
  if (!isFinite(Rf)) return { delta: 0, Rr: Infinity, feasible: true };
  if (Rf <= L) return { delta: Math.PI / 2, Rr: 0, feasible: false };
  return { delta: Math.asin(L / Rf), Rr: Math.sqrt(Rf * Rf - L * L), feasible: true };
}

/** 前輪轉角 → 前軸／後軸中心迴轉半徑 */
export function radiiFromSteer(delta: number, L: number): { Rf: number; Rr: number } {
  const d = Math.abs(delta);
  if (d < 1e-6) return { Rf: Infinity, Rr: Infinity };
  return { Rf: L / Math.sin(d), Rr: L / Math.tan(d) };
}

/**
 * 曳物線解析步進：前方牽引點沿直線弦 (A→B) 移動 d 時，被拖曳車身與弦的夾角 α 依
 * tan(α/2) = tan(α₀/2)·e^(−d/L) 變化（對折線路徑為精確解，比投影法少一階誤差）。
 * 以 atan2 形式計算，α₀ 接近 π（倒推）時仍穩定。
 */
export function tractrixStep(heading: number, A: Pt, B: Pt, L: number): number {
  const d = dist(A, B);
  if (d < 1e-12) return heading;
  const e = Math.atan2(B.y - A.y, B.x - A.x);
  const a0 = normAngle(heading - e);
  const a1 = 2 * Math.atan2(Math.exp(-d / L) * Math.sin(a0), 1 + Math.cos(a0));
  return normAngle(e + a1);
}

function attachTrailers(poses: Pose[], v: VehicleSpec) {
  const t = v.trailer;
  if (!t) return;
  const maxArt = (t.maxArticulationDeg * Math.PI) / 180;
  let prevHitch: Pt | null = null;
  let heading = 0;
  for (const p of poses) {
    const hitch = add(p.rear, mul(dir(p.heading), t.hitchOffset));
    heading = prevHitch ? tractrixStep(heading, prevHitch, hitch, t.Lt) : p.heading;
    const axle = add(hitch, mul(dir(heading), -t.Lt));
    const articulation = normAngle(p.heading - heading);
    p.trailer = { hitch, axle, heading, articulation };
    p.jackknife = Math.abs(articulation) > maxArt;
    prevHitch = hitch;
  }
}

function simulateFrontExact(path: BuiltPath, v: VehicleSpec, maxSteer: number): Pose[] {
  const poses: Pose[] = [];
  const L = v.L;
  let heading = path.heading[0];
  for (let k = 0; k < path.pts.length; k++) {
    const F = path.pts[k];
    if (k > 0) heading = tractrixStep(heading, path.pts[k - 1], F, L);
    const rear = add(F, mul(dir(heading), -L));
    const steer = normAngle(path.heading[k] - heading);
    poses.push({ s: path.s[k], rear, front: F, heading, steer, feasible: Math.abs(steer) <= maxSteer + STEER_TOL, dev: 0 });
  }
  return poses;
}

function simulateRear(path: BuiltPath, v: VehicleSpec, maxSteer: number, reverse: boolean): Pose[] {
  const poses: Pose[] = [];
  const L = v.L;
  const n = path.pts.length;
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, k - 1), b = Math.min(n - 1, k + 1);
    const kappa = b > a ? normAngle(path.heading[b] - path.heading[a]) / (path.s[b] - path.s[a]) : 0;
    const heading = reverse ? path.heading[k] + Math.PI : path.heading[k];
    const steer = Math.atan(L * kappa) * (reverse ? -1 : 1);
    const rear = path.pts[k];
    poses.push({ s: path.s[k], rear, front: add(rear, mul(dir(heading), L)), heading: normAngle(heading), steer, feasible: Math.abs(steer) <= maxSteer + STEER_TOL, dev: 0 });
  }
  return poses;
}

function simulateFrontLimited(path: BuiltPath, v: VehicleSpec, drive: DriveSettings, maxSteer: number): { poses: Pose[]; status: SimStatus } {
  const L = v.L;
  const ds = Math.max(0.02, path.length / Math.max(1, path.pts.length - 1));
  const ld = Math.max(0.3, drive.lookahead);
  const rate = drive.maxSteerRateDegPerM > 0 ? (drive.maxSteerRateDegPerM * Math.PI) / 180 : Infinity;
  const n = path.pts.length;
  const endH = path.heading[n - 1];
  const endP = path.pts[n - 1];
  const target = (s: number): Pt => (s <= path.length ? pointAtS(path, s).p : add(endP, mul(dir(endH), s - path.length)));

  let F = { ...path.pts[0] };
  let heading = path.heading[0];
  let steer = 0;
  let idx = 0;
  const poses: Pose[] = [{ s: 0, rear: add(F, mul(dir(heading), -L)), front: F, heading, steer: 0, feasible: true, dev: 0 }];
  const maxSteps = Math.ceil((path.length * 3) / ds) + 400;
  const win = Math.ceil((2 * ds + 1.0) / ds) + 2;
  let status: SimStatus = 'ok';

  for (let step = 0; step < maxSteps; step++) {
    // 只在目前位置附近往前搜尋最近點，避免 U 型或交叉路徑跳段
    let best = Infinity, bestI = idx;
    for (let i = idx; i < Math.min(n, idx + win); i++) {
      const d = dist(F, path.pts[i]);
      if (d < best) { best = d; bestI = i; }
    }
    idx = bestI;
    const sNear = path.s[idx];
    if (idx >= n - 1 && sNear >= path.length - 1e-6) {
      // 已到終點：前軸越過終點法線即結束
      const along = (F.x - endP.x) * Math.cos(endH) + (F.y - endP.y) * Math.sin(endH);
      if (along >= -ds * 0.5) break;
    }
    const G = target(sNear + ld);
    const desired = normAngle(Math.atan2(G.y - F.y, G.x - F.x) - heading);
    let next = desired;
    if (isFinite(rate)) next = steer + Math.max(-rate * ds, Math.min(rate * ds, normAngle(desired - steer)));
    steer = Math.max(-maxSteer, Math.min(maxSteer, next));
    F = add(F, mul(dir(heading + steer), ds));
    heading = normAngle(heading + (ds * Math.sin(steer)) / L);
    const dev = best;
    if (dev > 4) { status = 'diverged'; }
    poses.push({ s: sNear, rear: add(F, mul(dir(heading), -L)), front: F, heading, steer, feasible: true, dev });
    if (status === 'diverged') break;
    if (step === maxSteps - 1) status = 'truncated';
  }
  return { poses, status };
}

export function simulate(path: BuiltPath, v: VehicleSpec, drive: DriveSettings): Trajectory {
  const maxSteer = (v.maxSteerDeg * Math.PI) / 180;
  const messages: string[] = [];
  let poses: Pose[];
  let status: SimStatus = 'ok';
  const reverse = drive.direction === 'reverse';
  if (reverse || drive.guide === 'rear') {
    poses = simulateRear(path, v, maxSteer, reverse);
    if (drive.controller === 'limited') messages.push('後軸引導／倒車採精確跟隨；轉角受限模式只適用於前軸引導前進');
  } else if (drive.controller === 'limited') {
    const r = simulateFrontLimited(path, v, drive, maxSteer);
    poses = r.poses;
    status = r.status;
    if (status === 'diverged') messages.push('轉角受限下車輛已偏離路徑超過 4 m，模擬中止：此路徑對該車種過急');
    if (status === 'truncated') messages.push('模擬步數超過上限，結果不完整');
  } else {
    poses = simulateFrontExact(path, v, maxSteer);
  }
  attachTrailers(poses, v);
  const step = path.length / Math.max(1, path.pts.length - 1);
  if (status === 'ok' && poses.some(p => !p.feasible)) {
    status = 'infeasible';
    const bad = poses.filter(p => !p.feasible).length * step;
    messages.push(`有 ${bad.toFixed(1)} m 路段需要超過最大轉角 ${v.maxSteerDeg}°，實際無法依此路徑行駛`);
  }
  if (poses.some(p => p.jackknife)) messages.push(`拖車折角超過 ${v.trailer?.maxArticulationDeg}°（可能折疊）`);
  return { poses, status, messages, step };
}
