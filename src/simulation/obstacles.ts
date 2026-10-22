/**
 * 由 CAD 圖面物件建立淨距檢核對象
 *
 * 硬障礙（車體不得進入，並檢核淨距帶）：建築線、人行道；槽化線可在設定中改視為實體島。
 * 軟侵入（不應跨越的標線，只回報越線）：分向限制線、雙白實線、路面邊線／車道實線、禁止臨時停車線、禁止停車線、槽化線。
 * 不檢查：停止線、行人穿越道、車道虛線、穿越虛線、網狀線、標字、指向線等——正常轉彎本來就會越過。
 */
import { CadElement } from '../types';
import { getElementPrimitives, MARKING_NAMES } from '../markings';
import { Obstacle } from './analysis';
import { bboxOf } from './geom';
import { Pt } from './model';

const SOFT_LINE_TYPES = new Set(['yellow_double', 'white_double', 'white_solid', 'red_solid', 'yellow_solid']);

function segsOf(pts: Pt[], closed: boolean): [Pt, Pt][] {
  const segs: [Pt, Pt][] = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
  if (closed && pts.length > 2) segs.push([pts[pts.length - 1], pts[0]]);
  return segs;
}

export interface ObstacleOptions {
  islandIsHard: boolean;
}

export function buildObstacles(elements: CadElement[], opts: ObstacleOptions): Obstacle[] {
  const out: Obstacle[] = [];
  elements.forEach(el => {
    const t = el.type as string;
    const label = MARKING_NAMES[t] || t;
    try {
      if (t === 'BuildingLine') {
        getElementPrimitives(el).forEach((p, k) => {
          if (p.kind !== 'line' || p.pts.length < 2) return;
          out.push({ id: `${el.id}#${k}`, elementId: el.id, label, kind: 'hard', segs: segsOf(p.pts, false), bbox: bboxOf(p.pts) });
        });
      } else if (t === 'Sidewalk') {
        getElementPrimitives(el).forEach((p, k) => {
          if (p.kind !== 'poly' || p.pts.length < 3) return;
          out.push({ id: `${el.id}#${k}`, elementId: el.id, label, kind: 'hard', segs: segsOf(p.pts, true), polygon: p.pts, bbox: bboxOf(p.pts) });
        });
      } else if (t === 'island') {
        if ((el as any).hatchPattern === 'cross') return; // 網狀線可駛入
        const prim = getElementPrimitives(el).find(p => p.kind === 'poly');
        if (!prim || prim.kind !== 'poly' || prim.pts.length < 3) return;
        const hard = opts.islandIsHard;
        out.push({
          id: `${el.id}#0`, elementId: el.id, label: hard ? '槽化島' : '槽化線', kind: hard ? 'hard' : 'soft',
          segs: segsOf(prim.pts, true), polygon: hard ? prim.pts : undefined, bbox: bboxOf(prim.pts),
        });
      } else if (SOFT_LINE_TYPES.has(t)) {
        getElementPrimitives(el).forEach((p, k) => {
          if (p.kind !== 'line' || p.pts.length < 2) return;
          out.push({ id: `${el.id}#${k}`, elementId: el.id, label, kind: 'soft', segs: segsOf(p.pts, !!p.closed), bbox: bboxOf(p.pts) });
        });
      }
    } catch {
      // 幾何不完整的物件略過
    }
  });
  return out;
}
