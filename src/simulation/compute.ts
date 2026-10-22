/** 單一路徑 × 單一車種的完整模擬結果（純函式，可快取） */
import { DriveSettings, PathSource } from './model';
import { BuiltPath, buildPath } from './pathBuilder';
import { SimStatus, Trajectory, simulate } from './kinematics';
import { Conflict, Hull, Obstacle, SimMetrics, Tracks, buildTracks, checkClearance, computeMetrics, sweepHulls } from './analysis';
import { VehicleSpec } from './vehicles';

export interface SimResult {
  vehicle: VehicleSpec;
  built: BuiltPath;
  traj: Trajectory;
  hulls: Hull[];
  tracks: Tracks;
  metrics: SimMetrics;
  conflicts: Conflict[];
  status: SimStatus;
  /** 給使用者看的狀態說明（路徑警告＋模擬訊息） */
  messages: string[];
}

export type Verdict = 'pass' | 'clearance' | 'conflict' | 'infeasible';

export function verdictOf(r: SimResult): Verdict {
  if (r.status === 'infeasible' || r.status === 'diverged' || r.metrics.jackknife) return 'infeasible';
  if (r.conflicts.some(c => c.severity === 'intrusion')) return 'conflict';
  if (r.conflicts.length) return 'clearance';
  return 'pass';
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: '通過',
  clearance: '注意',
  conflict: '侵入',
  infeasible: '不可行',
};

/** partial = true：拖曳中的快速計算，略過偏移量、掃掠寬度與淨距檢核 */
export function computeFromBuilt(built: BuiltPath, vehicle: VehicleSpec, drive: DriveSettings, obstacles: Obstacle[], bufferM: number, partial = false): SimResult {
  const traj = simulate(built, vehicle, drive);
  const hulls = sweepHulls(traj, vehicle, 0.25);
  const tracks = buildTracks(traj, vehicle);
  const base = computeMetrics(built, traj, vehicle, hulls, tracks, partial);
  const { conflicts, minClearance } = partial ? { conflicts: [], minClearance: null } : checkClearance(hulls, obstacles, bufferM);
  return {
    vehicle,
    built,
    traj,
    hulls,
    tracks,
    metrics: { ...base, minClearance },
    conflicts,
    status: traj.status,
    messages: [...built.warnings, ...traj.messages],
  };
}

export function computeResult(source: PathSource, vehicle: VehicleSpec, drive: DriveSettings, obstacles: Obstacle[], bufferM: number): SimResult | null {
  const built = buildPath(source);
  if (!built) return null;
  return computeFromBuilt(built, vehicle, drive, obstacles, bufferM);
}
