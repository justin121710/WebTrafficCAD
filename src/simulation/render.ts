/**
 * 軌跡模擬畫布繪製（獨立的覆蓋層 canvas，不參與 CAD 主畫布的重繪）
 *
 * - 掃掠範圍與淨距帶先在離屏 canvas 以實色填滿所有凸包，再以單一透明度合成，透明度均勻且不會疊色飽和
 * - 結果（掃掠、輪跡、骨架、衝突）一律完整顯示；播放只移動車體
 */
import { Pt } from './model';
import { ResultEntry, SimStore, DRAFT_ID } from './store';
import { bodyOutline, mirrorOutlines, trailerOutlines, wheelPositions } from './analysis';
import { Pose } from './kinematics';
import { getHandles } from './handles';
import { outlineService } from './outlines';
import { dir } from './geom';
import { VehicleSpec } from './vehicles';

export interface RenderView {
  ctx: CanvasRenderingContext2D;
  w2s: (x: number, y: number) => { x: number; y: number };
  zoom: number;
  width: number;
  height: number;
}

let scratch: HTMLCanvasElement | null = null;
function scratchCanvas(w: number, h: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!scratch) scratch = document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) { scratch.width = w; scratch.height = h; }
  const c = scratch.getContext('2d');
  c?.clearRect(0, 0, w, h);
  return c;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [99, 102, 241];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgba(hex: string, a: number) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function tracePoly(ctx: CanvasRenderingContext2D, pts: Pt[], v: RenderView) {
  pts.forEach((p, i) => {
    const s = v.w2s(p.x, p.y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  ctx.closePath();
}

function strokeLine(ctx: CanvasRenderingContext2D, pts: Pt[], v: RenderView, stride = 1) {
  if (pts.length < 2) return;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += stride) {
    const s = v.w2s(pts[i].x, pts[i].y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  }
  const last = v.w2s(pts[pts.length - 1].x, pts[pts.length - 1].y);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

/** 以離屏 canvas 一次合成，得到均勻透明度的填色 */
function drawUniform(v: RenderView, alpha: number, paint: (c: CanvasRenderingContext2D) => void) {
  const c = scratchCanvas(v.width, v.height);
  if (!c) return;
  paint(c);
  v.ctx.save();
  v.ctx.globalAlpha = alpha;
  v.ctx.drawImage(c.canvas, 0, 0);
  v.ctx.restore();
}

export function drawVehicle(ctx: CanvasRenderingContext2D, v: RenderView, pose: Pose, veh: VehicleSpec, color: string, opts: { alert?: boolean; ghost?: boolean } = {}) {
  const stroke = opts.alert ? '#ef4444' : '#ffffff';
  ctx.save();
  ctx.globalAlpha = opts.ghost ? 0.55 : 1;
  // 由最後一節往前畫，讓前一節壓在上面
  const units = trailerOutlines(pose, veh);
  const hitches = [pose.trailer, pose.trailer2];
  for (let k = units.length - 1; k >= 0; k--) {
    ctx.beginPath();
    tracePoly(ctx, units[k], v);
    ctx.fillStyle = 'rgba(51, 65, 85, 0.88)';
    ctx.fill();
    ctx.strokeStyle = opts.alert ? '#ef4444' : rgba(color, 1);
    ctx.lineWidth = 2;
    ctx.stroke();
    const tp = hitches[k];
    if (tp) {
      const h = v.w2s(tp.hitch.x, tp.hitch.y);
      ctx.beginPath();
      ctx.arc(h.x, h.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fill();
    }
  }
  const body = bodyOutline(pose, veh);
  ctx.beginPath();
  tracePoly(ctx, body, v);
  ctx.fillStyle = 'rgba(30, 41, 59, 0.92)';
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  mirrorOutlines(pose, veh).forEach(m => {
    ctx.beginPath();
    tracePoly(ctx, m, v);
    ctx.fillStyle = stroke;
    ctx.fill();
  });
  // 車頭方向標記
  const nose = v.w2s((body[0].x + body[1].x) / 2, (body[0].y + body[1].y) / 2);
  ctx.beginPath();
  ctx.arc(nose.x, nose.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = rgba(color, 1);
  ctx.fill();
  // 輪胎
  const wl = 0.9 * v.zoom, ww = Math.max(2, 0.3 * v.zoom);
  wheelPositions(pose, veh).forEach(w => {
    const s = v.w2s(w.c.x, w.c.y);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(-w.h);
    ctx.fillStyle = '#020617';
    ctx.fillRect(-wl / 2, -ww / 2, wl, ww);
    ctx.strokeStyle = w.steered ? rgba(color, 1) : '#94a3b8';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-wl / 2, -ww / 2, wl, ww);
    ctx.restore();
  });
  ctx.restore();
}

/** 依弧長找姿態 */
export function poseAtS(poses: Pose[], s: number): Pose | null {
  if (!poses.length) return null;
  // 轉角受限模式的 s 為最近點弧長，可能停滯；用累計距離較穩定
  let lo = 0, hi = poses.length - 1;
  if (s <= poses[0].s) return poses[0];
  if (s >= poses[hi].s) return poses[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (poses[mid].s <= s) lo = mid; else hi = mid;
  }
  return poses[lo];
}

export interface DrawOptions {
  mode: 'sim' | 'cad';
  playS: number;
}

export function drawSimulation(v: RenderView, store: SimStore, results: ResultEntry[], opt: DrawOptions) {
  const { ctx } = v;
  const settings = store.doc.settings;
  const disp = settings.display;
  const active = store.activePath();
  const activeId = active?.id ?? null;
  const isCad = opt.mode === 'cad';
  const live = new Set<string>();

  // 非作用中的路徑先畫，作用中的最後畫
  const ordered = [...results].sort((a, b) => Number(a.pathId === activeId) - Number(b.pathId === activeId));
  const playEntry = store.activeResult();

  for (const e of ordered) {
    const r = e.result;
    const isActive = e.pathId === activeId;
    const color = e.path.color;
    const fade = isCad ? 0.6 : isActive ? 1 : 0.55;
    live.add(e.key);

    // 1. 淨距帶
    if (!isCad && disp.buffer && settings.bufferM > 0 && disp.swept) {
      const bw = 2 * settings.bufferM * v.zoom;
      drawUniform(v, 0.16 * fade, c => {
        c.fillStyle = color;
        c.strokeStyle = color;
        c.lineJoin = 'round';
        c.lineWidth = bw;
        c.beginPath();
        r.hulls.forEach(h => tracePoly(c, h.pts, v));
        c.stroke();
        c.fill();
      });
    }
    // 2. 掃掠範圍
    if (disp.swept || isCad) {
      drawUniform(v, settings.sweptOpacity * fade, c => {
        c.fillStyle = color;
        c.beginPath();
        r.hulls.forEach(h => tracePoly(c, h.pts, v));
        c.fill();
      });
      if (!e.partial) {
        const rings = outlineService.get(e.key, r.hulls);
        if (rings) {
          ctx.save();
          ctx.strokeStyle = rgba(color, 0.95 * fade);
          ctx.lineWidth = isActive ? 1.6 : 1.1;
          rings.forEach(poly => poly.forEach(ring => { ctx.beginPath(); tracePoly(ctx, ring, v); ctx.stroke(); }));
          ctx.restore();
        }
      }
    }
    if (isCad) {
      ctx.save();
      ctx.strokeStyle = rgba(color, 0.9);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      strokeLine(ctx, r.built.pts, v, 4);
      ctx.restore();
      continue;
    }

    // 3. 輪跡、角點軌跡、軸心軌跡
    ctx.save();
    if (disp.wheelTracks) {
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      r.tracks.wheels.forEach(w => {
        ctx.strokeStyle = rgba(color, (w.name.includes('前') ? 0.9 : 0.6) * fade);
        strokeLine(ctx, w.pts, v);
      });
    }
    if (disp.cornerTracks) {
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = rgba('#e2e8f0', 0.55 * fade);
      r.tracks.corners.forEach(c => strokeLine(ctx, c.pts, v));
    }
    if (disp.axleTracks) {
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = rgba('#e2e8f0', 0.6 * fade);
      strokeLine(ctx, r.tracks.rearAxle, v);
      if (r.tracks.trailerAxle) strokeLine(ctx, r.tracks.trailerAxle, v);
    }
    ctx.restore();

    // 4. 車體骨架
    if (disp.poses && r.traj.poses.length) {
      ctx.save();
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 * fade})`;
      ctx.lineWidth = 1;
      const every = Math.max(1, Math.round(settings.poseIntervalM / Math.max(1e-6, r.traj.step)));
      for (let i = 0; i < r.traj.poses.length; i += every) {
        const p = r.traj.poses[i];
        ctx.beginPath();
        tracePoly(ctx, bodyOutline(p, r.vehicle), v);
        ctx.stroke();
        trailerOutlines(p, r.vehicle).forEach(tr => { ctx.beginPath(); tracePoly(ctx, tr, v); ctx.stroke(); });
      }
      ctx.restore();
    }

    // 5. 引導線（依轉角上色，超限為紅色粗線）；轉角受限模式另畫實際前軸軌跡
    ctx.save();
    const limited = e.path.drive.controller === 'limited' && e.path.drive.guide === 'front' && e.path.drive.direction === 'forward';
    if (limited) {
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba('#94a3b8', 0.9 * fade);
      strokeLine(ctx, r.built.pts, v, 2);
      ctx.setLineDash([]);
    }
    const poses = r.traj.poses;
    const lim = (r.vehicle.maxSteerDeg * Math.PI) / 180;
    const guidePt = (p: Pose) => (e.path.drive.guide === 'rear' || e.path.drive.direction === 'reverse' ? p.rear : p.front);
    const stride = Math.max(1, Math.floor(poses.length / 1500));
    for (let i = stride; i < poses.length; i += stride) {
      const a = guidePt(poses[i - stride]), b = guidePt(poses[i]);
      const p = poses[i];
      const sa = v.w2s(a.x, a.y), sb = v.w2s(b.x, b.y);
      const ratio = Math.min(1, Math.abs(p.steer) / Math.max(1e-6, lim));
      ctx.beginPath();
      ctx.moveTo(sa.x, sa.y);
      ctx.lineTo(sb.x, sb.y);
      if (!p.feasible) {
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = isActive ? 4 : 3;
      } else {
        ctx.strokeStyle = rgba(color, (0.45 + 0.55 * ratio) * fade);
        ctx.lineWidth = isActive ? 2.5 : 1.8;
      }
      ctx.stroke();
    }
    ctx.restore();

    // 6. 衝突標記
    if (r.conflicts.length) {
      ctx.save();
      r.conflicts.forEach(c => {
        const s = v.w2s(c.at.x, c.at.y);
        const col = c.severity === 'intrusion' ? '#ef4444' : c.severity === 'clearance' ? '#f59e0b' : '#eab308';
        ctx.strokeStyle = col;
        ctx.fillStyle = col;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s.x - 4, s.y - 4); ctx.lineTo(s.x + 4, s.y + 4);
        ctx.moveTo(s.x + 4, s.y - 4); ctx.lineTo(s.x - 4, s.y + 4);
        ctx.stroke();
        if (isActive) {
          const label = c.severity === 'intrusion' ? `侵入 ${c.depth.toFixed(2)} m` : c.severity === 'clearance' ? `淨距 ${c.minDist.toFixed(2)} m` : '越線';
          ctx.font = 'bold 11px "Noto Sans TC", sans-serif';
          const w = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(15, 17, 21, 0.85)';
          ctx.fillRect(s.x + 10, s.y - 9, w + 8, 18);
          ctx.fillStyle = col;
          ctx.textBaseline = 'middle';
          ctx.fillText(label, s.x + 14, s.y);
        }
      });
      ctx.restore();
    }

    // 7. 最大轉角位置標註（作用中路徑）
    if (isActive && r.metrics.maxSteerAt && r.metrics.maxSteerDeg > 0.5) {
      const s = v.w2s(r.metrics.maxSteerAt.x, r.metrics.maxSteerAt.y);
      const over = r.metrics.maxSteerDeg > r.vehicle.maxSteerDeg + 0.05;
      const label = `δmax ${r.metrics.maxSteerDeg.toFixed(1)}°`;
      ctx.save();
      ctx.font = '11px "Noto Sans TC", sans-serif';
      const w = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15, 17, 21, 0.8)';
      ctx.fillRect(s.x - w / 2 - 4, s.y - 26, w + 8, 16);
      ctx.fillStyle = over ? '#f87171' : '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, s.x, s.y - 18);
      ctx.restore();
    }
  }
  outlineService.prune(live);
  if (isCad) return;

  // 8. 車體（播放位置）
  if (playEntry) {
    const pose = poseAtS(playEntry.result.traj.poses, opt.playS);
    if (pose) {
      const alert = !pose.feasible || !!pose.jackknife;
      drawVehicle(ctx, v, pose, playEntry.result.vehicle, playEntry.path.color, { alert });
    }
  }

  // 9. 控制點與繪製預覽
  if (active) {
    const entry = results.find(x => x.pathId === active.id);
    const built = entry?.result.built ?? null;
    drawEditing(v, store, active.id === DRAFT_ID, built);
  }
}

function drawEditing(v: RenderView, store: SimStore, isDraft: boolean, built: import('./pathBuilder').BuiltPath | null) {
  const { ctx } = v;
  const path = store.activePath();
  if (!path) return;
  const color = path.color;
  const s = path.source;
  const disp = store.doc.settings.display;
  ctx.save();

  // 路口輔助線
  if (s.kind === 'intersection' && built?.helpers && disp.helpers) {
    const h = built.helpers;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.7)';
    const p0 = s.params.p0!, p3 = s.params.p3!;
    const line = (a: Pt, b: Pt) => { const sa = v.w2s(a.x, a.y), sb = v.w2s(b.x, b.y); ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke(); };
    if (h.I) { line(p0, h.I); line(p3, h.I); }
    line(p0, h.c1); line(p3, h.c2);
    ctx.setLineDash([]);
    const dot = (p: Pt, label: string) => {
      const q = v.w2s(p.x, p.y);
      ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
      ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.font = '10px sans-serif';
      ctx.fillText(label, q.x + 5, q.y - 5);
    };
    if (h.I) dot(h.I, 'I');
    dot(h.c1, 'C1'); dot(h.c2, 'C2');
    if (h.I1) dot(h.I1, 'I1');
    if (h.I2) dot(h.I2, 'I2');
  }

  // 草稿預覽線
  const hover = store.ui.hover;
  if (isDraft && hover && (s.kind === 'polyline' || s.kind === 'pen') && s.nodes.length) {
    const last = s.nodes[s.nodes.length - 1].p;
    const a = v.w2s(last.x, last.y), b = v.w2s(hover.x, hover.y);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = rgba(color, 0.8);
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    const len = Math.hypot(hover.x - last.x, hover.y - last.y);
    ctx.font = '11px monospace';
    ctx.fillStyle = '#e2e8f0';
    ctx.fillText(`${len.toFixed(2)} m`, b.x + 12, b.y + 16);
  }
  if (isDraft && s.kind === 'polyline' && s.nodes.length === 1 && !hover) {
    // 只有一點時仍顯示
  }
  if (s.kind === 'freehand' && isDraft && s.points.length > 1) {
    ctx.strokeStyle = rgba(color, 0.9);
    ctx.lineWidth = 2;
    strokeLine(ctx, s.points, v);
  }

  // 控制點
  const handles = path.locked ? [] : getHandles(path, built);
  handles.forEach(h => {
    const q = v.w2s(h.world.x, h.world.y);
    if (h.anchor) {
      const a = v.w2s(h.anchor.x, h.anchor.y);
      ctx.strokeStyle = h.kind === 'radius' ? 'rgba(148,163,184,0.6)' : rgba(color, 0.9);
      ctx.lineWidth = 1;
      ctx.setLineDash(h.kind === 'radius' ? [3, 3] : []);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    const selected = (h.kind === 'node' || h.kind === 'p0' || h.kind === 'p3') && store.ui.selectedNode === h.index;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgba(color, 1);
    ctx.fillStyle = selected ? rgba(color, 1) : '#ffffff';
    ctx.beginPath();
    if (h.kind === 'node' || h.kind === 'p0' || h.kind === 'p3') {
      ctx.rect(q.x - 5, q.y - 5, 10, 10);
    } else if (h.kind === 'radius') {
      ctx.moveTo(q.x, q.y - 6); ctx.lineTo(q.x + 6, q.y); ctx.lineTo(q.x, q.y + 6); ctx.lineTo(q.x - 6, q.y); ctx.closePath();
    } else {
      ctx.arc(q.x, q.y, 4.5, 0, Math.PI * 2);
    }
    ctx.fill();
    ctx.stroke();
    if (h.kind === 'radius' && s.kind === 'polyline') {
      const vi = built?.vertices?.find(x => x.index === h.index);
      if (vi) {
        const label = `R ${vi.Ract.toFixed(1)} m${vi.LsAct > 0 ? `・Ls ${vi.LsAct.toFixed(1)}` : ''}${vi.limited ? '（受限）' : ''}`;
        ctx.font = '11px "Noto Sans TC", sans-serif';
        const w = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(15, 17, 21, 0.82)';
        ctx.fillRect(q.x + 9, q.y - 8, w + 8, 16);
        ctx.fillStyle = vi.limited ? '#fbbf24' : '#e2e8f0';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, q.x + 13, q.y);
      }
    }
    if (h.kind === 'p0' || h.kind === 'p3') {
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = '#e2e8f0';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(h.kind === 'p0' ? '起點' : '終點', q.x + 8, q.y - 8);
    }
    if (h.kind === 'h0' || h.kind === 'h3') {
      // 方向箭頭
      const sp = s.kind === 'intersection' ? s.params : null;
      const hd = h.kind === 'h0' ? sp?.h0 ?? 0 : sp?.h3 ?? 0;
      const d = dir(hd);
      const tip = { x: q.x + d.x * 10, y: q.y - d.y * 10 };
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(q.x - d.y * 5, q.y - d.x * 5);
      ctx.lineTo(q.x + d.y * 5, q.y + d.x * 5);
      ctx.closePath();
      ctx.fillStyle = rgba(color, 1);
      ctx.fill();
    }
  });
  ctx.restore();
}
