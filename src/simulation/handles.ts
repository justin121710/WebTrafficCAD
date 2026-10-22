/** 可拖曳控制點（畫布繪製與滑鼠命中測試共用） */
import { SimPath, Pt } from './model';
import { BuiltPath } from './pathBuilder';
import { add, closestOnPolyline, dir, mul, sub, unit } from './geom';

export type HandleKind = 'node' | 'hIn' | 'hOut' | 'radius' | 'p0' | 'p3' | 'h0' | 'h3';

export interface Handle {
  kind: HandleKind;
  index: number;
  world: Pt;
  /** 手柄連線的另一端（繪製用） */
  anchor?: Pt;
}

export const HEADING_KNOB_M = 5;

export function getHandles(path: SimPath, built: BuiltPath | null): Handle[] {
  const s = path.source;
  const out: Handle[] = [];
  switch (s.kind) {
    case 'polyline':
      s.nodes.forEach((n, i) => {
        out.push({ kind: 'node', index: i, world: n.p });
        if (built && i > 0 && i < s.nodes.length - 1) {
          const v = built.vertices?.find(x => x.index === i);
          if (v && v.Ract > 0) {
            const mid = closestOnPolyline(n.p, built.pts).point;
            out.push({ kind: 'radius', index: i, world: mid, anchor: n.p });
          }
        }
      });
      break;
    case 'pen':
      s.nodes.forEach((n, i) => {
        out.push({ kind: 'node', index: i, world: n.p });
        if (Math.hypot(n.hIn.x, n.hIn.y) > 1e-6) out.push({ kind: 'hIn', index: i, world: add(n.p, n.hIn), anchor: n.p });
        if (Math.hypot(n.hOut.x, n.hOut.y) > 1e-6) out.push({ kind: 'hOut', index: i, world: add(n.p, n.hOut), anchor: n.p });
      });
      break;
    case 'intersection': {
      const pr = s.params;
      if (pr.p0) {
        out.push({ kind: 'p0', index: 0, world: pr.p0 });
        out.push({ kind: 'h0', index: 0, world: add(pr.p0, mul(dir(pr.h0), -HEADING_KNOB_M)), anchor: pr.p0 });
      }
      if (pr.p3) {
        out.push({ kind: 'p3', index: 1, world: pr.p3 });
        out.push({ kind: 'h3', index: 1, world: add(pr.p3, mul(dir(pr.h3), HEADING_KNOB_M)), anchor: pr.p3 });
      }
      break;
    }
    case 'freehand':
      break;
  }
  return out;
}

/** 依拖曳位置更新來源（回傳新的 source） */
export function applyHandleDrag(path: SimPath, h: Handle, world: Pt, opts: { breakSymmetry: boolean }): SimPath['source'] {
  const s = path.source;
  if (s.kind === 'polyline') {
    const nodes = s.nodes.map(n => ({ ...n }));
    if (h.kind === 'node') nodes[h.index].p = world;
    if (h.kind === 'radius') {
      // 讓曲線中點通過游標：圓弧外距 E = R(1/cos(Δ/2) − 1)，沿分角線量測
      const B = nodes[h.index].p;
      const uin = unit(sub(B, nodes[h.index - 1].p));
      const uout = unit(sub(nodes[h.index + 1].p, B));
      const delta = Math.acos(Math.max(-1, Math.min(1, uin.x * uout.x + uin.y * uout.y)));
      const bis = unit(sub(uout, uin));
      const E = Math.max(0, (world.x - B.x) * bis.x + (world.y - B.y) * bis.y);
      const k = 1 / Math.cos(delta / 2) - 1;
      if (k > 1e-6) nodes[h.index].R = Math.round(Math.min(500, Math.max(0.5, E / k)) * 10) / 10;
    }
    return { ...s, nodes };
  }
  if (s.kind === 'pen') {
    const nodes = s.nodes.map(n => ({ ...n, p: { ...n.p }, hIn: { ...n.hIn }, hOut: { ...n.hOut } }));
    const n = nodes[h.index];
    if (h.kind === 'node') n.p = world;
    if (h.kind === 'hOut' || h.kind === 'hIn') {
      const v = sub(world, n.p);
      const smooth = n.smooth && !opts.breakSymmetry;
      if (h.kind === 'hOut') {
        n.hOut = v;
        if (smooth) n.hIn = mul(v, -1);
      } else {
        n.hIn = v;
        if (smooth) n.hOut = mul(v, -1);
      }
      if (opts.breakSymmetry) n.smooth = false;
    }
    return { ...s, nodes };
  }
  if (s.kind === 'intersection') {
    const pr = { ...s.params };
    if (h.kind === 'p0') pr.p0 = world;
    if (h.kind === 'p3') pr.p3 = world;
    if (h.kind === 'h0' && pr.p0) pr.h0 = Math.atan2(pr.p0.y - world.y, pr.p0.x - world.x);
    if (h.kind === 'h3' && pr.p3) pr.h3 = Math.atan2(world.y - pr.p3.y, world.x - pr.p3.x);
    return { ...s, params: pr };
  }
  return s;
}

/** 整條路徑平移 */
export function translateSource(src: SimPath['source'], d: Pt): SimPath['source'] {
  const T = (p: Pt) => ({ x: p.x + d.x, y: p.y + d.y });
  switch (src.kind) {
    case 'polyline': return { ...src, nodes: src.nodes.map(n => ({ ...n, p: T(n.p) })) };
    case 'pen': return { ...src, nodes: src.nodes.map(n => ({ ...n, p: T(n.p) })) };
    case 'freehand': return { ...src, points: src.points.map(T) };
    case 'intersection': return { ...src, params: { ...src.params, p0: src.params.p0 && T(src.params.p0), p3: src.params.p3 && T(src.params.p3) } };
  }
}
