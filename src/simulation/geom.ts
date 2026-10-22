/** 模擬模組共用的平面幾何小工具（單位：公尺） */
import { Pt } from './model';

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
export const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
export const len = (a: Pt) => Math.hypot(a.x, a.y);
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const dir = (h: number): Pt => ({ x: Math.cos(h), y: Math.sin(h) });
export const leftNormal = (h: number): Pt => ({ x: -Math.sin(h), y: Math.cos(h) });
export const lerpPt = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export function unit(a: Pt): Pt {
  const l = len(a);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
}

/** 角度正規化到 (-π, π] */
export function normAngle(a: number): number {
  a = a % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/** 點到線段的最近點與距離 */
export function closestOnSegment(p: Pt, a: Pt, b: Pt): { point: Pt; t: number; d: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 > 1e-18 ? dot(sub(p, a), ab) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { point, t, d: dist(p, point) };
}

/** 兩線段是否相交（含端點接觸） */
export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const eps = 1e-12;
  const onSeg = (p: Pt, q: Pt, r: Pt) => Math.min(p.x, q.x) - eps <= r.x && r.x <= Math.max(p.x, q.x) + eps && Math.min(p.y, q.y) - eps <= r.y && r.y <= Math.max(p.y, q.y) + eps;
  if (Math.abs(d1) <= eps && onSeg(a, b, c)) return true;
  if (Math.abs(d2) <= eps && onSeg(a, b, d)) return true;
  if (Math.abs(d3) <= eps && onSeg(c, d, a)) return true;
  if (Math.abs(d4) <= eps && onSeg(c, d, b)) return true;
  return false;
}

/** 兩線段間最短距離（相交為 0） */
export function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    closestOnSegment(a, c, d).d,
    closestOnSegment(b, c, d).d,
    closestOnSegment(c, a, b).d,
    closestOnSegment(d, a, b).d,
  );
}

/** 偶奇規則判斷點是否在多邊形內 */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 點到多邊形邊界的最短距離 */
export function distanceToPolygonEdges(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const d = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]).d;
    if (d < best) best = d;
  }
  return best;
}

/** Andrew monotone chain 凸包（逆時針，不含重複首點） */
export function convexHull(points: Pt[]): Pt[] {
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length <= 2) return pts;
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(p, lower[lower.length - 2])) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(p, upper[upper.length - 2])) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }

export function bboxOf(pts: Pt[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function bboxOverlap(a: BBox, b: BBox, margin = 0): boolean {
  return a.minX - margin <= b.maxX && b.minX - margin <= a.maxX && a.minY - margin <= b.maxY && b.minY - margin <= a.maxY;
}

/** 多邊形面積（有號，逆時針為正） */
export function polygonArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
}

/** 折線上最近點（全域搜尋） */
export function closestOnPolyline(p: Pt, line: Pt[]): { point: Pt; d: number; seg: number; t: number } {
  let best = { point: line[0], d: Infinity, seg: 0, t: 0 };
  for (let i = 0; i < line.length - 1; i++) {
    const r = closestOnSegment(p, line[i], line[i + 1]);
    if (r.d < best.d) best = { point: r.point, d: r.d, seg: i, t: r.t };
  }
  if (line.length === 1) best = { point: line[0], d: dist(p, line[0]), seg: 0, t: 0 };
  return best;
}

/** 以均勻格網加速「點到折線距離」查詢 */
export class SegmentGrid {
  private cells = new Map<string, number[]>();
  constructor(private segs: [Pt, Pt][], private cell = 2) {
    segs.forEach(([a, b], i) => {
      const bb = bboxOf([a, b]);
      for (let gx = Math.floor(bb.minX / cell); gx <= Math.floor(bb.maxX / cell); gx++) {
        for (let gy = Math.floor(bb.minY / cell); gy <= Math.floor(bb.maxY / cell); gy++) {
          const k = `${gx},${gy}`;
          let arr = this.cells.get(k);
          if (!arr) this.cells.set(k, (arr = []));
          arr.push(i);
        }
      }
    });
  }
  /** 回傳距離（搜尋半徑內找不到時往外擴張） */
  nearest(p: Pt, maxRadius = 200): number {
    const c = this.cell;
    const gx = Math.floor(p.x / c), gy = Math.floor(p.y / c);
    let best = Infinity;
    for (let r = 0; r * c <= maxRadius; r++) {
      for (let x = gx - r; x <= gx + r; x++) {
        for (let y = gy - r; y <= gy + r; y++) {
          if (r > 0 && Math.abs(x - gx) !== r && Math.abs(y - gy) !== r) continue;
          const arr = this.cells.get(`${x},${y}`);
          if (!arr) continue;
          for (const i of arr) {
            const d = closestOnSegment(p, this.segs[i][0], this.segs[i][1]).d;
            if (d < best) best = d;
          }
        }
      }
      // 已找到的最近距離小於下一圈的最小可能距離即可停止
      if (best <= r * c) break;
    }
    return best;
  }
}
