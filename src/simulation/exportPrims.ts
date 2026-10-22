/**
 * 軌跡模擬結果 → 繪製原語（DXF／PNG 匯出共用）
 *
 * 圖層（ASCII 以相容 DXF R12）：
 *   SIM-PATH            引導線（前軸或後軸中心）
 *   SIM-SWEPT-<車種>    掃掠範圍外框（多邊形聯集）
 *   SIM-BUFFER          淨距帶外框
 *   SIM-WHEEL           輪胎軌跡
 *   SIM-POSE            車體骨架
 *   SIM-ANNOT           軌跡名稱、車種、最大轉角標註
 *   SIM-CONFLICT        衝突位置與說明
 */
import { Primitive } from '../markings';
import { DRAFT_ID, SimStore, ResultEntry } from './store';
import { bodyOutline, expandConvex, trailerOutlines, unionPolygons } from './analysis';
import { outlineService } from './outlines';
import { PATH_COLORS } from './model';

export interface SimExportOptions {
  swept: boolean;
  buffer: boolean;
  wheels: boolean;
  poses: boolean;
  annotations: boolean;
}

const ACI_TABLE: [number, [number, number, number]][] = [
  [1, [255, 0, 0]], [2, [255, 255, 0]], [3, [0, 255, 0]], [4, [0, 255, 255]], [5, [0, 0, 255]], [6, [255, 0, 255]],
  [30, [255, 127, 0]], [140, [0, 127, 255]], [210, [255, 0, 127]], [94, [0, 127, 0]],
];
const PATH_ACI = [5, 3, 30, 1, 4, 6, 94, 210];

export function aciFor(hex: string): number {
  const i = PATH_COLORS.indexOf(hex.toLowerCase());
  if (i >= 0) return PATH_ACI[i];
  const n = parseInt(hex.replace('#', ''), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = 7, bd = Infinity;
  ACI_TABLE.forEach(([aci, c]) => {
    const d = (c[0] - rgb[0]) ** 2 + (c[1] - rgb[1]) ** 2 + (c[2] - rgb[2]) ** 2;
    if (d < bd) { bd = d; best = aci; }
  });
  return best;
}

const layerSafe = (s: string) => s.toUpperCase().replace(/[^A-Z0-9_-]/g, '_').slice(0, 24);

export function exportableEntries(store: SimStore): ResultEntry[] {
  return store.getResults().filter(e => e.pathId !== DRAFT_ID && e.path.visible && !e.partial);
}

export function getSimulationPrimitives(store: SimStore, opts: SimExportOptions): Primitive[] {
  const prims: Primitive[] = [];
  const settings = store.doc.settings;
  for (const e of exportableEntries(store)) {
    const r = e.result;
    const css = e.path.color;
    const aci = aciFor(css);
    const vehLayer = layerSafe(r.vehicle.category === 'custom' ? `CUSTOM-${r.vehicle.id.slice(-6)}` : r.vehicle.id.replace(/^aashto-/, ''));
    if (opts.buffer && settings.bufferM > 0) {
      const rings = unionPolygons(r.hulls.map(h => expandConvex(h.pts, settings.bufferM)));
      rings.forEach(poly => poly.forEach(ring => prims.push({ kind: 'line', pts: ring, closed: true, width: 0, minPx: 1, dashPx: [5, 4], color: 'guide', css, aci, layer: 'SIM-BUFFER' })));
    }
    if (opts.swept) {
      const rings = outlineService.getSync(e.key, r.hulls);
      rings.forEach(poly => {
        prims.push({ kind: 'poly', pts: poly[0], holes: poly.slice(1), fill: 'curve', fillAlpha: 0.22, stroke: 'curve', strokeWidth: 0.05, css, aci, layer: `SIM-SWEPT-${vehLayer}` });
      });
    }
    if (opts.wheels) {
      r.tracks.wheels.forEach(w => prims.push({ kind: 'line', pts: w.pts, width: 0, minPx: 1, color: 'curve', css, aci, layer: 'SIM-WHEEL' }));
    }
    if (opts.poses) {
      const every = Math.max(1, Math.round(settings.poseIntervalM / Math.max(1e-6, r.traj.step)));
      for (let i = 0; i < r.traj.poses.length; i += every) {
        const p = r.traj.poses[i];
        prims.push({ kind: 'line', pts: bodyOutline(p, r.vehicle), closed: true, width: 0, minPx: 0.8, color: 'guide', css, aci, layer: 'SIM-POSE' });
        trailerOutlines(p, r.vehicle).forEach(tr => prims.push({ kind: 'line', pts: tr, closed: true, width: 0, minPx: 0.8, color: 'guide', css, aci, layer: 'SIM-POSE' }));
      }
    }
    prims.push({ kind: 'line', pts: r.built.pts, width: 0, minPx: 1.6, color: 'curve', css, aci, layer: 'SIM-PATH' });
    if (opts.annotations) {
      const start = r.built.pts[0];
      prims.push({ kind: 'text', p: { x: start.x, y: start.y + 1.6 }, text: `${e.path.name}／${r.vehicle.short}`, size: 0.9, minPx: 10, color: 'text', css, aci, layer: 'SIM-ANNOT' });
      if (r.metrics.maxSteerAt) {
        const a = r.metrics.maxSteerAt;
        prims.push({ kind: 'text', p: { x: a.x, y: a.y + 1.2 }, text: `δmax ${r.metrics.maxSteerDeg.toFixed(1)}°`, size: 0.6, minPx: 9, color: 'text', css, aci, layer: 'SIM-ANNOT' });
      }
      r.conflicts.forEach(c => {
        prims.push({ kind: 'circle', c: c.at, r: 0.6, color: 'red', layer: 'SIM-CONFLICT' });
        const label = c.severity === 'intrusion' ? `${c.label}侵入 ${c.depth.toFixed(2)} m` : c.severity === 'clearance' ? `${c.label}淨距 ${c.minDist.toFixed(2)} m` : `${c.label}越線`;
        prims.push({ kind: 'text', p: { x: c.at.x, y: c.at.y - 1.1 }, text: label, size: 0.5, minPx: 9, color: 'red', layer: 'SIM-CONFLICT' });
      });
    }
  }
  return prims;
}

/** PNG 圖例 */
export function simulationLegend(store: SimStore): { color: string; label: string }[] {
  return exportableEntries(store).map(e => ({ color: e.path.color, label: `${e.path.name}　${e.result.vehicle.name}` }));
}
