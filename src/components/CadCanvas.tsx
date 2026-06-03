import React, { useEffect, useRef, useState } from 'react';
import { 
  CadElement, 
  CadTool, 
  Point2D, 
  ViewportState, 
  SnapTarget,
  ThreeCenterCurveElement,
  IslandElement,
  TextElement,
  BaseElement,
  SketchCircleElement,
  LineElement,
  SmartPathElement,
  CrosswalkElement,
  BuildingLineElement,
  ParkingSpaceElement,
  BicycleLaneElement,
  Waypoint,
  VehicleConfig,
  SimulationState,
  ControllerMode,
  Point
} from '../types';
import { 
  distance, 
  projectPointOnSegment, 
  generateHatchingLines,
  sampleClosedBezierLoop,
  generateChannelizingIsland,
  offsetSegment,
  sampleCubicBezier,
  getBezierMinRadiusOfCurvature,
  getLineBezierRepresentation,
  getPathOffsetCurves,
  generateCrosswalkStripes,
  generateParkingZoneSlots,
  lineSegmentsIntersect,
  generateVehicleSweptPath,
  lerp,
  normalize,
  smoothBezierControlPoints,
  calculateSteeringAngle,
  getWheelbaseForVehicle,
  getMaxSteeringAngleForPath,
  getRoadArrowOutlinePoints
} from '../geometry';
import { arrowData } from '../arrowData';
import { calculateIntersectionCurve } from '../utils/pathInterpolator';
import { calculateCorners, calculateTrailerCorners } from '../utils/vehicleSimulator';
import { Search } from 'lucide-react';

const ensureSmoothWaypoint = (idx: number, points: Waypoint[]): Waypoint[] => {
  if (idx < 0 || idx >= points.length) return points;
  const pt = { ...points[idx] };
  const hOutLen = Math.hypot(pt.handleOut.x, pt.handleOut.y);
  if (hOutLen < 5) {
    pt.handleOut = { x: 0, y: 0 };
    pt.handleIn = { x: 0, y: 0 };
    const next = [...points];
    next[idx] = pt;
    return next;
  }
  return points;
};

function getParkingSpaceCenter(pk: { p1: Point2D; angle?: number; length?: number; width?: number; p2?: Point2D }): Point2D {
  const L = pk.length || 5.0;
  const W = pk.width || 2.0;
  const angle = pk.angle !== undefined ? pk.angle : (pk.p2 && pk.p1 ? Math.atan2(pk.p2.y - pk.p1.y, pk.p2.x - pk.p1.x) : 0);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: pk.p1.x + (L / 2) * cos - (W / 2) * sin,
    y: pk.p1.y + (L / 2) * sin + (W / 2) * cos
  };
}

function getElementCenter(el: any): Point2D {
  if (el.type === 'parking_space' && el.p1) return getParkingSpaceCenter(el);
  if (el.center) return { ...el.center };
  if (el.p) return { ...el.p };
  
  const collect: Point2D[] = [];
  if (el.p1) collect.push(el.p1);
  if (el.p2) collect.push(el.p2);
  if (el.pA1) collect.push(el.pA1);
  if (el.pA2) collect.push(el.pA2);
  if (el.pB1) collect.push(el.pB1);
  if (el.pB2) collect.push(el.pB2);
  if (el.pStart) collect.push(el.pStart);
  if (el.pIntersection) collect.push(el.pIntersection);
  if (el.pEnd) collect.push(el.pEnd);

  if (el.points && el.points.length > 0) {
    collect.push(...el.points);
  }

  if (collect.length > 0) {
    let sx = 0, sy = 0;
    collect.forEach(p => {
      sx += p.x;
      sy += p.y;
    });
    return { x: sx / collect.length, y: sy / collect.length };
  }

  return { x: 0, y: 0 };
}

function getElementVertices(el: CadElement): Point2D[] {
  switch (el.type) {
    case 'guideline':
    case 'yellow_double':
    case 'white_double':
    case 'white_dashed':
    case 'yellow_dashed':
    case 'white_solid':
    case 'crossing_dashed':
    case 'stop_line':
    case 'yield_line':
    case 'Sidewalk':
    case 'reversible_lane': {
      const line = el as LineElement;
      if (line.points && line.points.length > 0) return line.points;
      const pts: Point2D[] = [];
      if (line.p1) pts.push(line.p1);
      if (line.p2) pts.push(line.p2);
      return pts;
    }
    case 'three_center_curve': {
      const tcc = el as ThreeCenterCurveElement;
      return [tcc.pStart, tcc.pIntersection, tcc.pEnd];
    }
    case 'island': {
      const isl = el as IslandElement;
      return isl.points || [];
    }
    case 'text': {
      const txt = el as TextElement;
      return [txt.p];
    }
    case 'smart_path': {
      const sp = el as SmartPathElement;
      return sp.points || [];
    }
    case 'sketch_circle': {
      const circ = el as SketchCircleElement;
      const pts = [circ.center];
      const r = circ.radius;
      pts.push({ x: circ.center.x + r, y: circ.center.y });
      pts.push({ x: circ.center.x - r, y: circ.center.y });
      pts.push({ x: circ.center.x, y: circ.center.y + r });
      pts.push({ x: circ.center.x, y: circ.center.y - r });
      return pts;
    }
    case 'crosswalk': {
      const cw = el as CrosswalkElement;
      return [cw.pA1, cw.pA2, cw.pB1, cw.pB2];
    }
    case 'BuildingLine': {
      const bl = el as BuildingLineElement;
      return bl.points || [];
    }
    case 'parking_space': {
      const pk = el as ParkingSpaceElement;
      const center = getParkingSpaceCenter(pk);
      return [pk.p1, pk.p2, center];
    }
    case 'parking_zone': {
      const zone = el as any;
      const vertices = [...(zone.points || [])];
      try {
        const slots = generateParkingZoneSlots(zone);
        slots.forEach(slot => {
          vertices.push(...slot.corners);
        });
      } catch (e) {}
      return vertices;
    }
    case 'bicycle_lane': {
      const bl = el as BicycleLaneElement;
      return bl.points || [];
    }
    case 'road_arrow': {
      const arrow = el as any;
      return [arrow.p, ...getRoadArrowOutlinePoints(arrow)];
    }
    default:
      return [];
  }
}

/**
 * 繪製符合台灣交通標線規則之「讓路線」 (Yield Line)
 * 1單位 = 1公分 (cm)。scale = zoom / 100 (像素/公分)
 */
function drawYieldLine(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  scale: number
) {
  const dx = endX - startX;
  const dy = endY - startY;
  const L = Math.hypot(dx, dy);
  if (L < 1) return;

  const ux = dx / L;
  const uy = dy / L;
  // 垂直方向法向量 n (朝向來車方向，亦即標線延伸與繪製的方向)
  const nx = -uy;
  const ny = ux;

  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';

  // 輔助函數：繪製單排前導虛線
  // offsetCm：該排虛線前緣相對於基準線 AB 沿法向量平移之距離 (單位: cm)
  const drawGuideDashedRow = (offsetCm: number) => {
    const L_cm = L / scale;
    // 「前導虛線是寬的邊在拉線的軸向」
    const blockSizeCm = 60;   // 虛線方塊沿著 AB 方向寬度 = 60 cm
    const blockHeightCm = 30; // 垂直 AB 方向高度 = 30 cm
    const gapSizeCm = 30;     // 橫向間距 = 30 cm
    const cycleSizeCm = blockSizeCm + gapSizeCm; // 週期 = 90 cm

    // 計算可以放置的虛線方塊數量
    let N = Math.floor((L_cm + gapSizeCm) / cycleSizeCm);
    if (N < 1) N = 1;

    const totalSpanCm = N * cycleSizeCm - gapSizeCm;
    const marginCm = (L_cm - totalSpanCm) / 2;

    for (let i = 0; i < N; i++) {
      const startCm = marginCm + i * cycleSizeCm;
      const endCm = startCm + blockSizeCm;

      // 1. 起始平移後的基礎點 (Canvas 像素坐標)
      const base1x = startX + offsetCm * scale * nx;
      const base1y = startY + offsetCm * scale * ny;

      // 2. 計算虛線塊的前緣兩端點
      const p1x = base1x + startCm * scale * ux;
      const p1y = base1y + startCm * scale * uy;

      const p2x = base1x + endCm * scale * ux;
      const p2y = base1y + endCm * scale * uy;

      // 3. 沿法向量延伸 30cm 作為方塊之垂直高度 (後緣)
      const hPx = blockHeightCm * scale;
      const p3x = p2x + hPx * nx;
      const p3y = p2y + hPx * ny;

      const p4x = p1x + hPx * nx;
      const p4y = p1y + hPx * ny;

      // 4. 填充虛線方塊
      ctx.beginPath();
      ctx.moveTo(p1x, p1y);
      ctx.lineTo(p2x, p2y);
      ctx.lineTo(p3x, p3y);
      ctx.lineTo(p4x, p4y);
      ctx.closePath();
      ctx.fill();
    }
  };

  // 【1. 繪製雙排前導虛線】 (兩排虛線：寬 60cm, 高 30cm, 同排間距 30cm, 排與排垂直間隔 40cm)
  // 第一排虛線：起點 offset = 0，延伸 30 cm 達後緣 30 cm
  drawGuideDashedRow(0);

  // 第二排虛線：垂直間隔 40 cm -> 起點 offset = 30 + 40 = 70 cm，延伸 30 cm 達後緣 100 cm
  drawGuideDashedRow(70);

  // 【2. 繪製後方空心讓路三角形】 (本體底寬 120cm, 高度 300cm; 頂部 60cm 實心，邊厚 15cm)
  // AB 基準線中點 M
  const mx = (startX + endX) / 2;
  const my = (startY + endY) / 2;

  // 「三角形距離前導虛線為 2.0m ~ 2.5m（以 2.0m 為基準）」
  // 第二排虛線的後緣在 offset = 100cm。安全間距設定為 200cm (2.0m)
  // 因此三角形平底邊中點 D 位於 offset = 100 + 200 = 300cm 相對於基準線
  const Dx = mx + 300 * scale * nx;
  const Dy = my + 300 * scale * ny;

  const scaleSqrt26 = Math.sqrt(26);

  // 【外三角形】 (底邊寬 120cm, 高度 300cm, 尖端頂點 C 朝向後方來車方向)
  const Cx = Dx + 300 * scale * nx;
  const Cy = Dy + 300 * scale * ny;

  // 平底邊寬 120cm，端端點 E（右側 60cm）和 F（左側 60cm）：E/F = D +/- 60 * u
  const Ex = Dx + 60 * scale * ux;
  const Ey = Dy + 60 * scale * uy;

  const Fx = Dx - 60 * scale * ux;
  const Fy = Dy - 60 * scale * uy;

  // 【中界線】 (頂部實心梯角線在高度 60cm 處)
  // E60 = D + 60*n + 48*u
  const E60x = Dx + 60 * scale * nx + 48 * scale * ux;
  const E60y = Dy + 60 * scale * ny + 48 * scale * uy;

  // F60 = D + 60*n - 48*u
  const F60x = Dx + 60 * scale * nx - 48 * scale * ux;
  const F60y = Dy + 60 * scale * ny - 48 * scale * uy;

  // 【內三角形挖空】 (底面與頂部 60cm 實心塊無偏置，斜邊厚度 15cm)
  // C_inner = D + (300 - 15 * sqrt(26)) * n
  const C_inner_x = Dx + (300 - 15 * scaleSqrt26) * scale * nx;
  const C_inner_y = Dy + (300 - 15 * scaleSqrt26) * scale * ny;

  // E_inner = D + 60 * n + (48 - 3 * sqrt(26)) * u
  const E_inner_x = Dx + 60 * scale * nx + (48 - 3 * scaleSqrt26) * scale * ux;
  const E_inner_y = Dy + 60 * scale * ny + (48 - 3 * scaleSqrt26) * scale * uy;

  // F_inner = D + 60 * n - (48 - 3 * sqrt(26)) * u
  const F_inner_x = Dx + 60 * scale * nx - (48 - 3 * scaleSqrt26) * scale * ux;
  const F_inner_y = Dy + 60 * scale * ny - (48 - 3 * scaleSqrt26) * scale * uy;

  // 繪製與填充
  // A. 頂部 60cm 實心梯形 (F -> E -> E60 -> F60)
  ctx.beginPath();
  ctx.moveTo(Fx, Fy);
  ctx.lineTo(Ex, Ey);
  ctx.lineTo(E60x, E60y);
  ctx.lineTo(F60x, F60y);
  ctx.closePath();
  ctx.fill();

  // B. 底部空心部分 (外框 F60 -> E60 -> C 減去 內框 F_inner -> E_inner -> C_inner)
  ctx.beginPath();
  // Outer triangle (F60 -> E60 -> C)
  ctx.moveTo(F60x, F60y);
  ctx.lineTo(E60x, E60y);
  ctx.lineTo(Cx, Cy);
  ctx.closePath();

  // Inner cutout triangle (F_inner -> E_inner -> C_inner)
  ctx.moveTo(F_inner_x, F_inner_y);
  ctx.lineTo(E_inner_x, E_inner_y);
  ctx.lineTo(C_inner_x, C_inner_y);
  ctx.closePath();

  ctx.fill('evenodd');

  ctx.restore();
}

function drawYieldLineBezier(
  ctx: CanvasRenderingContext2D,
  points: Point2D[],
  cpLeft: Point2D[] | undefined,
  cpRight: Point2D[] | undefined,
  sgn: number,
  zoom: number,
  worldToScreen: (wx: number, wy: number) => { x: number, y: number }
) {
  if (!points || points.length < 2) return;
  const safeLeft = cpLeft || points;
  const safeRight = cpRight || points;

  // 1. Sample the centerline at high resolution
  const M = 150;
  const centerPts: Point2D[] = [];
  const numSegments = points.length - 1;
  const samplesPerSeg = Math.max(10, Math.ceil(M / numSegments));

  for (let s = 0; s < numSegments; s++) {
    const pStart = points[s];
    const cpStart = safeRight[s] || pStart;
    const cpEnd = safeLeft[s + 1] || points[s + 1];
    const pEnd = points[s + 1];

    for (let i = 0; i < samplesPerSeg; i++) {
      if (s > 0 && i === 0) continue; // avoid duplicates
      const t = i / (samplesPerSeg - 1);
      const mt = 1 - t;
      const b0 = mt * mt * mt;
      const b1 = 3 * mt * mt * t;
      const b2 = 3 * mt * t * t;
      const b3 = t * t * t;

      const px = b0 * pStart.x + b1 * cpStart.x + b2 * cpEnd.x + b3 * pEnd.x;
      const py = b0 * pStart.y + b1 * cpStart.y + b2 * cpEnd.y + b3 * pEnd.y;
      centerPts.push({ x: px, y: py });
    }
  }

  if (centerPts.length < 2) return;

  const normals: Point2D[] = [];
  const tangents: Point2D[] = [];
  const totalM = centerPts.length;

  for (let k = 0; k < totalM; k++) {
    const P_curr = centerPts[k];
    let tangent: Point2D;
    if (k === 0) {
      const next = centerPts[k + 1];
      tangent = { x: next.x - P_curr.x, y: next.y - P_curr.y };
    } else if (k === totalM - 1) {
      const prev = centerPts[k - 1];
      tangent = { x: P_curr.x - prev.x, y: P_curr.y - prev.y };
    } else {
      const prev = centerPts[k - 1];
      const next = centerPts[k + 1];
      tangent = { x: next.x - prev.x, y: next.y - prev.y };
    }
    const len = Math.hypot(tangent.x, tangent.y) || 0.001;
    const ut = { x: tangent.x / len, y: tangent.y / len };
    tangents.push(ut);
    normals.push({ x: -ut.y, y: ut.x });
  }

  const evaluateOffset = (k_frac: number, offsetDist: number): Point2D => {
    const idx = Math.min(totalM - 2, Math.max(0, Math.floor(k_frac)));
    const r = k_frac - idx;

    const p1 = centerPts[idx];
    const p2 = centerPts[idx + 1];
    const n1 = normals[idx];
    const n2 = normals[idx + 1];

    const px = P_interp(p1.x, p2.x, r);
    const py = P_interp(p1.y, p2.y, r);
    const nx = P_interp(n1.x, n2.x, r);
    const ny = P_interp(n1.y, n2.y, r);

    const nLen = Math.hypot(nx, ny) || 0.001;
    return {
      x: px + (nx / nLen) * offsetDist,
      y: py + (ny / nLen) * offsetDist
    };
  };

  function P_interp(v1: number, v2: number, ratio: number) {
    return v1 * (1 - ratio) + v2 * ratio;
  }

  // Row 1 and Row 2 center offests
  const d_cen1 = 0.15 * sgn; // 15cm
  const d_cen2 = 0.85 * sgn; // 85cm

  let L1 = 0;
  let L2 = 0;
  const S1_vals: number[] = [0];
  const S2_vals: number[] = [0];

  let p1_prev = evaluateOffset(0, d_cen1);
  let p2_prev = evaluateOffset(0, d_cen2);

  for (let k = 1; k < totalM; k++) {
    const p1_curr = evaluateOffset(k, d_cen1);
    const p2_curr = evaluateOffset(k, d_cen2);

    L1 += Math.hypot(p1_curr.x - p1_prev.x, p1_curr.y - p1_prev.y);
    L2 += Math.hypot(p2_curr.x - p2_prev.x, p2_curr.y - p2_prev.y);

    S1_vals.push(L1);
    S2_vals.push(L2);

    p1_prev = p1_curr;
    p2_prev = p2_curr;
  }

  const isRow2Outer = L2 >= L1;
  const L_outer = isRow2Outer ? L2 : L1;
  const S_outer = isRow2Outer ? S2_vals : S1_vals;

  let N = Math.round(L_outer / 0.90);
  if (N < 1) N = 1;

  const C_actual = L_outer / N;
  let gap_outer = 0.30; // 30cm
  let width_outer = C_actual - gap_outer;
  if (width_outer < 0.10) {
    width_outer = C_actual * 2/3;
    gap_outer = C_actual * 1/3;
  }

  const getKForDistance = (dist: number, H: number[]): number => {
    if (dist <= 0) return 0;
    if (dist >= H[H.length - 1]) return totalM - 1;
    for (let i = 0; i < H.length - 1; i++) {
      if (dist >= H[i] && dist <= H[i + 1]) {
        const ratio = (dist - H[i]) / (H[i + 1] - H[i] || 0.001);
        return i + ratio;
      }
    }
    return totalM - 1;
  };

  ctx.save();
  ctx.fillStyle = '#ffffff';

  for (let j = 0; j < N; j++) {
    const dist_start = j * C_actual;
    const dist_end = dist_start + width_outer;

    const k_start = getKForDistance(dist_start, S_outer);
    const k_end = getKForDistance(dist_end, S_outer);

    // Row 1 goes from 0 to 30cm offset
    drawRadialBlock(ctx, k_start, k_end, 0 * sgn, 0.30 * sgn, worldToScreen);
    // Row 2 goes from 70cm to 100cm offset
    drawRadialBlock(ctx, k_start, k_end, 0.70 * sgn, 1.00 * sgn, worldToScreen);
  }

  function drawRadialBlock(
    canvasCtx: CanvasRenderingContext2D,
    k_start: number,
    k_end: number,
    d_low: number,
    d_high: number,
    w2s: (wx: number, wy: number) => { x: number, y: number }
  ) {
    const lowerPts: Point2D[] = [];
    const upperPts: Point2D[] = [];
    const steps = 4;
    for (let s = 0; s <= steps; s++) {
      const k_curr = k_start + (k_end - k_start) * (s / steps);
      lowerPts.push(evaluateOffset(k_curr, d_low));
      upperPts.push(evaluateOffset(k_curr, d_high));
    }

    canvasCtx.beginPath();
    const s0_lower = w2s(lowerPts[0].x, lowerPts[0].y);
    canvasCtx.moveTo(s0_lower.x, s0_lower.y);
    for (let s = 1; s <= steps; s++) {
      const sl = w2s(lowerPts[s].x, lowerPts[s].y);
      canvasCtx.lineTo(sl.x, sl.y);
    }
    for (let s = steps; s >= 0; s--) {
      const su = w2s(upperPts[s].x, upperPts[s].y);
      canvasCtx.lineTo(su.x, su.y);
    }
    canvasCtx.closePath();
    canvasCtx.fill();
  }

  // Draw the hollow yield triangle (placed at the geometric center point of the centerline along its arc length)
  let totalLength = 0;
  const centerlineLengths: number[] = [0];
  for (let i = 1; i < totalM; i++) {
    const d = Math.hypot(centerPts[i].x - centerPts[i - 1].x, centerPts[i].y - centerPts[i - 1].y);
    totalLength += d;
    centerlineLengths.push(totalLength);
  }

  const targetDist = totalLength / 2;
  let midK = 0;
  if (totalLength > 0.01) {
    for (let i = 0; i < totalM - 1; i++) {
      if (targetDist >= centerlineLengths[i] && targetDist <= centerlineLengths[i + 1]) {
        const ratio = (targetDist - centerlineLengths[i]) / (centerlineLengths[i + 1] - centerlineLengths[i] || 0.001);
        midK = i + ratio;
        break;
      }
    }
  } else {
    midK = (totalM - 1) / 2;
  }

  const midIdx = Math.min(totalM - 2, Math.max(0, Math.floor(midK)));
  const ratioK = midK - midIdx;

  const P_mid = {
    x: P_interp(centerPts[midIdx].x, centerPts[midIdx + 1].x, ratioK),
    y: P_interp(centerPts[midIdx].y, centerPts[midIdx + 1].y, ratioK)
  };

  const nPrev = normals[midIdx];
  const nNext = normals[midIdx + 1];
  const tPrev = tangents[midIdx];
  const tNext = tangents[midIdx + 1];

  const nxRaw = P_interp(nPrev.x, nNext.x, ratioK);
  const nyRaw = P_interp(nPrev.y, nNext.y, ratioK);
  const nLen = Math.hypot(nxRaw, nyRaw) || 0.001;
  const n_mid = { x: nxRaw / nLen, y: nyRaw / nLen };

  const txRaw = P_interp(tPrev.x, tNext.x, ratioK);
  const tyRaw = P_interp(tPrev.y, tNext.y, ratioK);
  const tLen = Math.hypot(txRaw, tyRaw) || 0.001;
  const u_mid = { x: txRaw / tLen, y: tyRaw / tLen };

  const Dx = P_mid.x + (3.0 * sgn) * n_mid.x;
  const Dy = P_mid.y + (3.0 * sgn) * n_mid.y;

  const nx = n_mid.x * sgn;
  const ny = n_mid.y * sgn;
  const ux = u_mid.x;
  const uy = u_mid.y;

  const scaleSqrt26 = Math.sqrt(26);

  const Cx = Dx + 3.0 * nx;
  const Cy = Dy + 3.0 * ny;

  const Ex = Dx + 0.60 * ux;
  const Ey = Dy + 0.60 * uy;
  const Fx = Dx - 0.60 * ux;
  const Fy = Dy - 0.60 * uy;

  const E60x = Dx + 0.60 * nx + 0.48 * ux;
  const E60y = Dy + 0.60 * ny + 0.48 * uy;
  const F60x = Dx + 0.60 * nx - 0.48 * ux;
  const F60y = Dy + 0.60 * ny - 0.48 * uy;

  const C_inner_x = Dx + (3.0 - 0.15 * scaleSqrt26) * nx;
  const C_inner_y = Dy + (3.0 - 0.15 * scaleSqrt26) * ny;
  const E_inner_x = Dx + 0.60 * nx + (0.48 - 0.03 * scaleSqrt26) * ux;
  const E_inner_y = Dy + 0.60 * ny + (0.48 - 0.03 * scaleSqrt26) * uy;
  const F_inner_x = Dx + 0.60 * nx - (0.48 - 0.03 * scaleSqrt26) * ux;
  const F_inner_y = Dy + 0.60 * ny - (0.48 - 0.03 * scaleSqrt26) * uy;

  const sE = worldToScreen(Ex, Ey);
  const sF = worldToScreen(Fx, Fy);
  const sE60 = worldToScreen(E60x, E60y);
  const sF60 = worldToScreen(F60x, F60y);
  const sC = worldToScreen(Cx, Cy);

  const sC_inner = worldToScreen(C_inner_x, C_inner_y);
  const sE_inner = worldToScreen(E_inner_x, E_inner_y);
  const sF_inner = worldToScreen(F_inner_x, F_inner_y);

  ctx.beginPath();
  ctx.moveTo(sF.x, sF.y);
  ctx.lineTo(sE.x, sE.y);
  ctx.lineTo(sE60.x, sE60.y);
  ctx.lineTo(sF60.x, sF60.y);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(sF60.x, sF60.y);
  ctx.lineTo(sE60.x, sE60.y);
  ctx.lineTo(sC.x, sC.y);
  ctx.closePath();

  ctx.moveTo(sF_inner.x, sF_inner.y);
  ctx.lineTo(sE_inner.x, sE_inner.y);
  ctx.lineTo(sC_inner.x, sC_inner.y);
  ctx.closePath();

  ctx.fill('evenodd');
  ctx.restore();
}

function getSelectedYieldLineSign(state: any, clickWorldPt: Point2D): number {
  if (!state || !state.points || state.points.length < 2) return 1;
  const safeLeft = state.cpLeft || state.points;
  const safeRight = state.cpRight || state.points;

  // Sample centerline
  const M = 150;
  const centerPts: Point2D[] = [];
  const numSegments = state.points.length - 1;
  const samplesPerSeg = Math.max(10, Math.ceil(M / numSegments));

  for (let s = 0; s < numSegments; s++) {
    const pStart = state.points[s];
    const cpStart = safeRight[s] || pStart;
    const cpEnd = safeLeft[s + 1] || state.points[s + 1];
    const pEnd = state.points[s + 1];

    for (let i = 0; i < samplesPerSeg; i++) {
      if (s > 0 && i === 0) continue;
      const t = i / (samplesPerSeg - 1);
      const mt = 1 - t;
      const b0 = mt * mt * mt;
      const b1 = 3 * mt * mt * t;
      const b2 = 3 * mt * t * t;
      const b3 = t * t * t;
      const px = b0 * pStart.x + b1 * cpStart.x + b2 * cpEnd.x + b3 * pEnd.x;
      const py = b0 * pStart.y + b1 * cpStart.y + b2 * cpEnd.y + b3 * pEnd.y;
      centerPts.push({ x: px, y: py });
    }
  }

  if (centerPts.length < 2) return 1;

  const normals: Point2D[] = [];
  const tangents: Point2D[] = [];
  const totalM = centerPts.length;

  for (let k = 0; k < totalM; k++) {
    const P_curr = centerPts[k];
    let tangent: Point2D;
    if (k === 0) {
      const next = centerPts[1];
      tangent = { x: next.x - P_curr.x, y: next.y - P_curr.y };
    } else if (k === totalM - 1) {
      const prev = centerPts[k - 1];
      tangent = { x: P_curr.x - prev.x, y: P_curr.y - prev.y };
    } else {
      const prev = centerPts[k - 1];
      const next = centerPts[k + 1];
      tangent = { x: next.x - prev.x, y: next.y - prev.y };
    }
    const len = Math.hypot(tangent.x, tangent.y) || 0.001;
    const ut = { x: tangent.x / len, y: tangent.y / len };
    tangents.push(ut);
    normals.push({ x: -ut.y, y: ut.x });
  }

  // Compute centerline's cumulative lengths
  let totalLength = 0;
  const centerlineLengths: number[] = [0];
  for (let i = 1; i < totalM; i++) {
    const d = Math.hypot(centerPts[i].x - centerPts[i - 1].x, centerPts[i].y - centerPts[i - 1].y);
    totalLength += d;
    centerlineLengths.push(totalLength);
  }

  const targetDist = totalLength / 2;
  let midK = 0;
  if (totalLength > 0.01) {
    for (let i = 0; i < totalM - 1; i++) {
      if (targetDist >= centerlineLengths[i] && targetDist <= centerlineLengths[i + 1]) {
        const ratio = (targetDist - centerlineLengths[i]) / (centerlineLengths[i + 1] - centerlineLengths[i] || 0.001);
        midK = i + ratio;
        break;
      }
    }
  } else {
    midK = (totalM - 1) / 2;
  }

  const midIdx = Math.min(totalM - 2, Math.max(0, Math.floor(midK)));
  const ratioK = midK - midIdx;

  function P_interp(v1: number, v2: number, ratio: number) {
    return v1 * (1 - ratio) + v2 * ratio;
  }

  const P_mid = {
    x: P_interp(centerPts[midIdx].x, centerPts[midIdx + 1].x, ratioK),
    y: P_interp(centerPts[midIdx].y, centerPts[midIdx + 1].y, ratioK)
  };

  const nPrev = normals[midIdx];
  const nNext = normals[midIdx + 1];
  const nxRaw = P_interp(nPrev.x, nNext.x, ratioK);
  const nyRaw = P_interp(nPrev.y, nNext.y, ratioK);
  const nLen = Math.hypot(nxRaw, nyRaw) || 0.001;
  const n_mid = { x: nxRaw / nLen, y: nyRaw / nLen };

  // Compute distance from clickWorldPt to Option +1 and Option -1
  const DA_x = P_mid.x + 3.0 * n_mid.x;
  const DA_y = P_mid.y + 3.0 * n_mid.y;

  const DB_x = P_mid.x - 3.0 * n_mid.x;
  const DB_y = P_mid.y - 3.0 * n_mid.y;

  const distA = Math.hypot(clickWorldPt.x - DA_x, clickWorldPt.y - DA_y);
  const distB = Math.hypot(clickWorldPt.x - DB_x, clickWorldPt.y - DB_y);

  return distA <= distB ? 1 : -1;
}

function transformElement(
  el: any,
  dx: number,
  dy: number,
  angleRad: number,
  center: Point2D
): any {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);

  const tx = (pt: Point2D) => {
    if (!pt) return pt;
    const rx = center.x + (pt.x - center.x) * cos - (pt.y - center.y) * sin;
    const ry = center.y + (pt.x - center.x) * sin + (pt.y - center.y) * cos;
    return { x: rx + dx, y: ry + dy };
  };

  const copy = { ...el };

  if (copy.p1) copy.p1 = tx(copy.p1);
  if (copy.p2) copy.p2 = tx(copy.p2);

  if (copy.points) {
    copy.points = copy.points.map((p: Point2D) => tx(p));
  }
  if (copy.cpLeft) {
    copy.cpLeft = copy.cpLeft.map((p: Point2D) => tx(p));
  }
  if (copy.cpRight) {
    copy.cpRight = copy.cpRight.map((p: Point2D) => tx(p));
  }

  // sketch_circle
  if (copy.center) copy.center = tx(copy.center);

  // crosswalk
  if (copy.pA1) copy.pA1 = tx(copy.pA1);
  if (copy.pA2) copy.pA2 = tx(copy.pA2);
  if (copy.pB1) copy.pB1 = tx(copy.pB1);
  if (copy.pB2) copy.pB2 = tx(copy.pB2);

  // three_center_curve outputs
  if (copy.pStart) copy.pStart = tx(copy.pStart);
  if (copy.pIntersection) copy.pIntersection = tx(copy.pIntersection);
  if (copy.pEnd) copy.pEnd = tx(copy.pEnd);
  
  if (copy.O1) copy.O1 = tx(copy.O1);
  if (copy.O2) copy.O2 = tx(copy.O2);
  if (copy.O3) copy.O3 = tx(copy.O3);
  if (copy.T1) copy.T1 = tx(copy.T1);
  if (copy.C12) copy.C12 = tx(copy.C12);
  if (copy.C23) copy.C23 = tx(copy.C23);
  if (copy.T2) copy.T2 = tx(copy.T2);

  // text
  if (copy.p) copy.p = tx(copy.p);

  return copy;
}

function getElementBoundingBox(el: any): { minX: number; maxX: number; minY: number; maxY: number } {
  const collect: Point2D[] = [];
  if (el.p1) collect.push(el.p1);
  if (el.p2) collect.push(el.p2);
  if (el.pA1) collect.push(el.pA1);
  if (el.pA2) collect.push(el.pA2);
  if (el.pB1) collect.push(el.pB1);
  if (el.pB2) collect.push(el.pB2);
  if (el.pStart) collect.push(el.pStart);
  if (el.pIntersection) collect.push(el.pIntersection);
  if (el.pEnd) collect.push(el.pEnd);
  
  if (el.center) {
    if (el.radius) {
      collect.push({ x: el.center.x - el.radius, y: el.center.y - el.radius });
      collect.push({ x: el.center.x + el.radius, y: el.center.y + el.radius });
    } else {
      collect.push(el.center);
    }
  }

  if (el.points && el.points.length > 0) {
    collect.push(...el.points);
  }
  if (el.cpLeft && el.cpLeft.length > 0) {
    collect.push(...el.cpLeft);
  }
  if (el.cpRight && el.cpRight.length > 0) {
    collect.push(...el.cpRight);
  }

  if (el.type === 'road_arrow') {
    const pts = getRoadArrowOutlinePoints(el);
    collect.push(...pts);
  }

  if (collect.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  collect.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });

  return { minX, maxX, minY, maxY };
}

interface CadCanvasProps {
  elements: CadElement[];
  onAddElement: (el: CadElement) => void;
  onUpdateElement: (el: CadElement) => void;
  selectedElement: CadElement | null;
  onSelectElement: (el: CadElement | null) => void;
  selectedAnchorIndices?: number[];
  setSelectedAnchorIndices?: (indices: number[]) => void;
  activeTool: CadTool;
  setActiveTool: (tool: CadTool) => void;
  parkingStampConfig?: { slotType: 'car' | 'motorcycle', width: number, length: number, angle: number };
  setParkingStampConfig?: (cfg: any) => void;
  parkingZoneConfig?: { slotType: 'car' | 'motorcycle', width: number, length: number, angle: number, gap: number, side: 'left' | 'right' };
  R2: number;
  designVehicle: 'passenger' | 'semi_trailer' | 'articulated';
  
  // Snap switches
  snapToGrid: boolean;
  snapToEndpoint: boolean;
  snapToMidpoint: boolean;
  snapToNearest: boolean;

  onSaveHistoryBeforeDrag: () => void;
  bgImage: any;
  setBgImage: React.Dispatch<React.SetStateAction<any>>;

  showGrid: boolean;
  minorGridInterval: number;
  majorGridInterval: number;

  selectedElementIds?: string[];
  onSelectElementIdsChange?: (ids: string[]) => void;
  onUpdateElements?: (elements: CadElement[]) => void;
  theme?: 'dark' | 'light';

  // Simulation Mode Props
  appMode?: 'cad' | 'simulation';
  simConfig?: VehicleConfig;
  setSimConfig?: React.Dispatch<React.SetStateAction<VehicleConfig>>;
  simControllerMode?: ControllerMode;
  simRawPoints?: Waypoint[];
  setSimRawPoints?: React.Dispatch<React.SetStateAction<Waypoint[]>>;
  simDrawMode?: "select" | "drag" | "click" | "smartpath";
  setSimDrawMode?: (mode: "select" | "drag" | "click" | "smartpath") => void;
  simIsPlaying?: boolean;
  setSimIsPlaying?: (b: boolean) => void;
  simCurrentStepIndex?: number;
  setSimCurrentStepIndex?: (idx: number) => void;
  simTrajectory?: SimulationState[];
  simInterpolatedPath?: any[]; // PathPoint[]
  simLockedPaths?: any[];
  setSimLockedPaths?: React.Dispatch<React.SetStateAction<any[]>>;
  simThemeColor?: "indigo" | "emerald" | "amber" | "rose" | "sky";
  simShowSweptPath?: boolean;
  simShowCornerTracks?: boolean;
  simShowAxleTracks?: boolean;
  simShowBodyWireframe?: boolean;
  simSweptOpacity?: number;
  simDraggingWaypointIndex?: number | null;
  setSimDraggingWaypointIndex?: (idx: number | null) => void;
  simDraggingHandleType?: "anchor" | "handleIn" | "handleOut" | null;
  setSimDraggingHandleType?: (t: "anchor" | "handleIn" | "handleOut" | null) => void;
  simIsDraggingFirstVec?: boolean;
  setSimIsDraggingFirstVec?: (b: boolean) => void;
  simFirstVecStart?: Point | null;
  setSimFirstVecStart?: (p: Point | null) => void;
  simFirstVecEnd?: Point | null;
  setSimFirstVecEnd?: (p: Point | null) => void;
  simClickStartHeadingRef?: React.MutableRefObject<number | null>;
  simFractionalStepRef?: React.MutableRefObject<number>;
  onSelectLockedPath?: (id: string) => void;

  // Intersection simulation props
  simIsIntersectionMode?: boolean;
  simP0X?: number | null;
  setSimP0X?: (x: number | null) => void;
  simP0Y?: number | null;
  setSimP0Y?: (y: number | null) => void;
  simP0Angle?: number;
  setSimP0Angle?: (a: number) => void;
  simP3X?: number | null;
  setSimP3X?: (x: number | null) => void;
  simP3Y?: number | null;
  setSimP3Y?: (y: number | null) => void;
  simP3Angle?: number;
  setSimP3Angle?: (a: number) => void;
  simP1RatioPercent?: number;
  simP2RatioPercent?: number;
  simIntersectionPickState?: "none" | "p0" | "p3";
  setSimIntersectionPickState?: (s: "none" | "p0" | "p3") => void;
  simShowIntersectionHelpers?: boolean;
  simEnableOutswing?: boolean;
  simI1RatioPercent?: number;
  simI1OffsetDistance?: number;
  simI2RatioPercent?: number;
  simI2OffsetDistance?: number;
  simStartExtensionM?: number;
  simEndExtensionM?: number;
  simIsCalibrating?: boolean;
  setSimIsCalibrating?: (b: boolean) => void;
  editingPathId?: string | null;
  setSimIsDragging?: (dragging: boolean) => void;
  roadArrowConfig?: { arrowType: 'straight' | 'left' | 'right' | 'straight_left' | 'straight_right', length: number, angle: number };
  setRoadArrowConfig?: (cfg: any) => void;
}

export default function CadCanvas({
  elements,
  onAddElement,
  onUpdateElement,
  selectedElement,
  onSelectElement,
  selectedAnchorIndices = [],
  setSelectedAnchorIndices,
  activeTool,
  setActiveTool,
  parkingStampConfig,
  setParkingStampConfig,
  parkingZoneConfig,
  roadArrowConfig,
  setRoadArrowConfig,
  R2,
  designVehicle,
  snapToGrid,
  snapToEndpoint,
  snapToMidpoint,
  snapToNearest,
  onSaveHistoryBeforeDrag,
  bgImage,
  setBgImage,
  showGrid,
  minorGridInterval,
  majorGridInterval,
  selectedElementIds = [],
  onSelectElementIdsChange,
  onUpdateElements,
  onSelectLockedPath,

  // Simulation Props
  appMode = 'cad',
  simConfig = { L: 2.7, W: 1.8, Of: 0.9, Or: 1.0, speed: 3.0, scale: 25, lookahead: 6.0 },
  setSimConfig,
  simControllerMode = ControllerMode.FRONT_AXLE_DRAG,
  simRawPoints = [],
  setSimRawPoints,
  simDrawMode = 'click',
  setSimDrawMode,
  simIsPlaying = false,
  setSimIsPlaying,
  simCurrentStepIndex = 0,
  setSimCurrentStepIndex,
  simTrajectory = [],
  simInterpolatedPath = [],
  simLockedPaths = [],
  setSimLockedPaths,
  simThemeColor = 'indigo',
  simShowSweptPath = true,
  simShowCornerTracks = true,
  simShowAxleTracks = true,
  simShowBodyWireframe = true,
  simSweptOpacity = 0.12,
  simDraggingWaypointIndex = null,
  setSimDraggingWaypointIndex,
  simDraggingHandleType = null,
  setSimDraggingHandleType,
  simIsDraggingFirstVec = false,
  setSimIsDraggingFirstVec,
  simFirstVecStart = null,
  setSimFirstVecStart,
  simFirstVecEnd = null,
  setSimFirstVecEnd,
  simClickStartHeadingRef,
  simFractionalStepRef,

  // Intersection simulation props
  simIsIntersectionMode = false,
  simP0X = null,
  setSimP0X,
  simP0Y = null,
  setSimP0Y,
  simP0Angle = 0,
  setSimP0Angle,
  simP3X = null,
  setSimP3X,
  simP3Y = null,
  setSimP3Y,
  simP3Angle = -90,
  setSimP3Angle,
  simP1RatioPercent = 70,
  simP2RatioPercent = 70,
  simIntersectionPickState = 'none',
  setSimIntersectionPickState,
  simShowIntersectionHelpers = true,
  simEnableOutswing = false,
  simI1RatioPercent = 50,
  simI1OffsetDistance = 1.5,
  simI2RatioPercent = 50,
  simI2OffsetDistance = 1.5,
  simStartExtensionM = 0.0,
  simEndExtensionM = 10.0,
  simIsCalibrating = false,
  setSimIsCalibrating,
  editingPathId = null,
  setSimIsDragging,
  theme = 'dark'
}: CadCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Marquee selection & multi drag states
  const [isMarqueeDragging, setIsMarqueeDragging] = useState(false);
  const [marqueeStartPos, setMarqueeStartPos] = useState<Point2D | null>(null);
  const [marqueeEndPos, setMarqueeEndPos] = useState<Point2D | null>(null);
  const [draggedElementsInitialStates, setDraggedElementsInitialStates] = useState<{ [id: string]: CadElement }>({});

  // Viewport State: zoom is pixels per meter. Start with 12 pixels per meter.
  const [viewport, setViewport] = useState<ViewportState>({
    zoom: 12,
    panX: 0,
    panY: 0
  });

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });
  const [mouseWorld, setMouseWorld] = useState<Point2D>({ x: 0, y: 0 });
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);

  // Simulation dragging local states
  const [isDraggingRoadA, setIsDraggingRoadA] = useState(false);
  const [isDraggingRoadB, setIsDraggingRoadB] = useState(false);
  const [activeDragPoint, setActiveDragPoint] = useState<'none' | 'p0' | 'p3'>('none');
  const [isDraggingWholePath, setIsDraggingWholePath] = useState(false);
  const [pathDragStartWorld, setPathDragStartWorld] = useState<Point2D | null>(null);
  const [pathDragStartPoints, setPathDragStartPoints] = useState<Waypoint[]>([]);
  const isSimDrawingDragRef = useRef(false);

  // Interactive drawings draft states (used by polygon channels & circles)
  const [draftPoints, setDraftPoints] = useState<Point2D[]>([]);

  // Bezier path creation interactive states (shared by guideline, yellow_double, white_dashed, white_solid, and smart_path!)
  const [spPoints, setSpPoints] = useState<Point2D[]>([]);
  const [spCpLeft, setSpCpLeft] = useState<Point2D[]>([]);
  const [spCpRight, setSpCpRight] = useState<Point2D[]>([]);
  const [spDraggingIndex, setSpDraggingIndex] = useState<number | null>(null);
  const [isClosingPathDrag, setIsClosingPathDrag] = useState<boolean>(false);
  const [connectionStartInfo, setConnectionStartInfo] = useState<{
    elementId: string;
    isStart: boolean;
  } | null>(null);

  // Yield Line Direction Selection Mode State
  const [yieldLineDecisionState, setYieldLineDecisionState] = useState<{
    points: Point2D[];
    cpLeft: Point2D[];
    cpRight: Point2D[];
    minRadius: number;
    isValid: boolean;
  } | null>(null);

  // Map Scaling Screen coordinates state
  const [scalingStartScreen, setScalingStartScreen] = useState<Point2D | null>(null);
  const [scalingEndScreen, setScalingEndScreen] = useState<Point2D | null>(null);
  const [calibrationDialog, setCalibrationDialog] = useState<{ screenDist: number; rawInput: string } | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  // Active drags for Select Tool handles
  const [activeHandle, setActiveHandle] = useState<{ elementId: string; nodeIndex: number } | null>(null);
  const [draggedSmartPathItem, setDraggedSmartPathItem] = useState<{
    elementId: string;
    nodeIndex: number;
    type: 'anchor' | 'cpLeft' | 'cpRight';
  } | null>(null);
  const [dragStartAnchor, setDragStartAnchor] = useState<Point2D | null>(null);
  const [dragStartRefPoint, setDragStartRefPoint] = useState<Point2D | null>(null);
  const [draggedCrosswalkItem, setDraggedCrosswalkItem] = useState<{
    elementId: string;
    pointKey: 'pA1' | 'pA2' | 'pB1' | 'pB2';
  } | null>(null);

  // Element-wide drag & rotate states
  const [isDraggingElement, setIsDraggingElement] = useState<boolean>(false);
  const [elementDragStartPos, setElementDragStartPos] = useState<Point2D | null>(null);
  const [elementInitialState, setElementInitialState] = useState<any>(null);

  const [isRotatingElement, setIsRotatingElement] = useState<boolean>(false);
  const [elementRotateCenter, setElementRotateCenter] = useState<Point2D | null>(null);
  const [elementRotateStartAngle, setElementRotateStartAngle] = useState<number>(0);
  const [elementInitialStateForRot, setElementInitialStateForRot] = useState<any>(null);

  // Refs and variables for parking space rotation by center point
  const rotationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const rotatingCenterRef = useRef<Point2D | null>(null);
  const detectionRefPointRef = useRef<Point2D | null>(null);
  const latestMouseWorldPosRef = useRef<Point2D | null>(null);
  const latestElementsRef = useRef(elements);

  useEffect(() => {
    latestElementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    return () => {
      if (rotationIntervalRef.current) {
        clearInterval(rotationIntervalRef.current);
      }
    };
  }, []);

  // 清理 CAD 模式下單個節點的草稿
  const prevActiveToolRef = useRef(activeTool);
  useEffect(() => {
    if (prevActiveToolRef.current !== activeTool) {
      if (spPoints.length === 1) {
        setSpPoints([]);
        setSpCpLeft([]);
        setSpCpRight([]);
      }
      if (draftPoints.length === 1) {
        setDraftPoints([]);
      }
      prevActiveToolRef.current = activeTool;
    }
  }, [activeTool, spPoints, draftPoints]);

  // 清理軌跡模擬模式下單個節點的草稿
  const prevSimDrawModeRef = useRef(simDrawMode);
  useEffect(() => {
    if (prevSimDrawModeRef.current !== simDrawMode) {
      if (simDrawMode === 'select' && simRawPoints && simRawPoints.length === 1 && setSimRawPoints) {
        setSimRawPoints([]);
      }
      prevSimDrawModeRef.current = simDrawMode;
    }
  }, [simDrawMode, simRawPoints, setSimRawPoints]);

  // Track key pressed (for dragging with spacebar etc)
  const [spacePressed, setSpacePressed] = useState(false);

  // Background image loaded reference
  const bgImgRef = useRef<HTMLImageElement | null>(null);
  const lastImgSrcRef = useRef<string | null>(null);
  useEffect(() => {
    if (bgImage?.src) {
      const img = new Image();
      img.onload = () => {
        bgImgRef.current = img;

        // Auto-Fit Image Initialization: center and zoom to 80% canvas width/height
        if (lastImgSrcRef.current !== bgImage.src) {
          lastImgSrcRef.current = bgImage.src;

          if (canvasRef.current) {
            const W_canvas = canvasRef.current.width;
            const H_canvas = canvasRef.current.height;
            const W_img = img.width;
            const H_img = img.height;

            if (W_img > 0 && H_img > 0) {
              const initialScale = Math.min(W_canvas / W_img, H_canvas / H_img) * 1.2;
              const defaultPPM = bgImage.pixelPerMeter || 20;
              const nextZoom = initialScale * defaultPPM;

              const widthMeters = W_img / defaultPPM;
              const heightMeters = H_img / defaultPPM;

              // Center View alignment: Since worldToScreen automatically models 
              // coordinates relative to canvas center, we set panX = 0 and panY = 0 
              // which aligns the image's mathematical and visual center perfectly.
              setViewport({
                zoom: nextZoom,
                panX: 0,
                panY: 0
              });
            }
          }
        }
      };
      img.src = bgImage.src;
    } else {
      bgImgRef.current = null;
      lastImgSrcRef.current = null;
    }
  }, [bgImage?.src, setViewport]);

  // Map Scaling State variables
  const [scaleStartPt, setScaleStartPt] = useState<Point2D | null>(null);
  const [scaleEndPt, setScaleEndPt] = useState<Point2D | null>(null);
  const [isScalingDrag, setIsScalingDrag] = useState(false);

  // Helper coordinate conversions
  const worldToScreen = (wx: number, wy: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const centerX = canvasRef.current.width / 2;
    const centerY = canvasRef.current.height / 2;
    
    return {
      x: centerX + wx * viewport.zoom + viewport.panX,
      y: centerY - wy * viewport.zoom + viewport.panY // inverted Y axis for engineering CAD Standard
    };
  };

  const screenToWorld = (sx: number, sy: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const centerX = canvasRef.current.width / 2;
    const centerY = canvasRef.current.height / 2;
    
    return {
      x: (sx - centerX - viewport.panX) / viewport.zoom,
      y: (centerY - sy + viewport.panY) / viewport.zoom // standard engineering CAD Cartesian coordinate
    };
  };

  const isLineOrPathTool = (tool: CadTool) => {
    return tool === 'guideline' || 
           tool === 'yellow_double' || 
           tool === 'white_double' || 
           tool === 'white_dashed' || 
           tool === 'yellow_dashed' || 
           tool === 'white_solid' || 
           tool === 'smart_path' || 
           tool === 'BuildingLine' || 
           tool === 'crossing_dashed' || 
           tool === 'stop_line' || 
           tool === 'Sidewalk' || 
           tool === 'channelization' || 
           tool === 'bicycle_lane' || 
           tool === 'reversible_lane' ||
           tool === 'yield_line' ||
           tool === 'parking_zone';
  };

  // Zoom to Fit and Center implementation
  const handleZoomToFit = () => {
    if (elements.length === 0) {
      if (canvasRef.current) {
        setViewport({
          zoom: 12,
          panX: 0,
          panY: 0
        });
      }
      return;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    const addPoint = (p: Point2D) => {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    };

    elements.forEach(el => {
      if (el.type === 'guideline' || el.type === 'yellow_double' || el.type === 'white_double' || el.type === 'white_dashed' || el.type === 'yellow_dashed' || el.type === 'white_solid' || el.type === 'smart_path' || el.type === 'parking_zone') {
        const line = el as any;
        const ref = getLineBezierRepresentation(line);
        if (ref) {
          ref.points.forEach((p: Point2D) => addPoint(p));
        } else if (line.p1 && line.p2) {
          addPoint(line.p1);
          addPoint(line.p2);
        }
      } else if (el.type === 'sketch_circle') {
        const circ = el as any;
        addPoint({ x: circ.center.x - circ.radius, y: circ.center.y });
        addPoint({ x: circ.center.x + circ.radius, y: circ.center.y });
        addPoint({ x: circ.center.x, y: circ.center.y - circ.radius });
        addPoint({ x: circ.center.x, y: circ.center.y + circ.radius });
      } else if (el.type === 'three_center_curve') {
        const curve = el as ThreeCenterCurveElement;
        curve.points.forEach(p => addPoint(p));
        addPoint(curve.pStart);
        addPoint(curve.pIntersection);
        addPoint(curve.pEnd);
      } else if (el.type === 'island') {
        const island = el as IslandElement;
        island.points.forEach(p => addPoint(p));
      } else if (el.type === 'text') {
        const txt = el as TextElement;
        addPoint(txt.p);
      }
    });

    if (minX === Infinity || minY === Infinity) return;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const widthWorld = Math.max(1.0, maxX - minX);
    const heightWorld = Math.max(1.0, maxY - minY);

    if (canvasRef.current) {
      const paddingRatio = 0.8; // 10% padding on each side
      const zoomX = (canvasRef.current.width * paddingRatio) / widthWorld;
      const zoomY = (canvasRef.current.height * paddingRatio) / heightWorld;
      let targetZoom = Math.min(zoomX, zoomY);

      // Clamp zoom levels (1.5 to 220)
      targetZoom = Math.max(1.5, Math.min(220, targetZoom));

      setViewport({
        zoom: targetZoom,
        panX: -cx * targetZoom,
        panY: cy * targetZoom
      });
    }
  };

  // Monitor elements changes to auto-center on first load (e.g. template import is fitted perfectly!)
  const prevElementsLength = useRef(elements.length);
  useEffect(() => {
    if (elements.length > 0 && prevElementsLength.current === 0) {
      setTimeout(() => {
        handleZoomToFit();
      }, 50);
    }
    prevElementsLength.current = elements.length;
  }, [elements]);

  // Handle Resize beautifully on expands / collapses using standard ResizeObserver!
  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;

    const handleResize = () => {
      if (canvasRef.current && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        canvasRef.current.width = rect.width;
        canvasRef.current.height = rect.height;
        // Trigger drawing pipeline sync
        setViewport(prev => ({ ...prev }));
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });

    resizeObserver.observe(containerRef.current);
    handleResize();

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Monitor global key down listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Guard if user is typing in any input field
      if (
        e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement || 
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (e.code === 'Space') {
        setSpacePressed(true);
      }
      if (e.code === 'Enter') {
        e.preventDefault();
        if (appMode === 'simulation') {
          if (setSimDrawMode) setSimDrawMode('select');
        } else if (isLineOrPathTool(activeTool) && spPoints.length >= 2) {
          handleCompleteSmartPath(spPoints, spCpLeft, spCpRight);
        }
      }
      if (e.key === 'v' || e.key === 'V' || e.code === 'KeyV') {
        e.preventDefault();
        if (appMode === 'simulation') {
          if (simRawPoints && simRawPoints.length === 1 && setSimRawPoints) {
            setSimRawPoints([]);
          }
          if (setSimDrawMode) setSimDrawMode('select');
        } else {
          if (spPoints.length === 1) {
            setSpPoints([]);
            setSpCpLeft([]);
            setSpCpRight([]);
          }
          if (draftPoints.length === 1) {
            setDraftPoints([]);
          }
          setActiveTool('select');
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSpPoints([]);
        setSpCpLeft([]);
        setSpCpRight([]);
        setDraftPoints([]);
        if (appMode === 'simulation' && setSimRawPoints) {
          setSimRawPoints([]);
        }
        setActiveTool('select');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [spPoints, spCpLeft, spCpRight, activeTool]);

  const normalize = (v: { x: number; y: number }): { x: number; y: number } => {
    const len = Math.hypot(v.x, v.y);
    return len > 0.001 ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 };
  };

  // Object snappy captures logic
  const computeSnapPoint = (worldPos: Point2D, sx: number, sy: number, excludeElementId?: string): SnapTarget | null => {
    let bestSnap: SnapTarget | null = null;
    let closestDistScreen = 14; // Snapping radius threshold in screens pixel

    // 優先吸附選取物件的所有幾何節點（即使 snapToEndpoint 未啟用）
    if (appMode === 'cad' && selectedElement && activeTool !== 'select') {
      const vertices = getElementVertices(selectedElement);
      vertices.forEach((pt: Point2D) => {
        const screenPt = worldToScreen(pt.x, pt.y);
        const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
        if (d < closestDistScreen) {
          closestDistScreen = d;
          bestSnap = { point: pt, type: 'endpoint', elementId: selectedElement.id };
        }
      });
      if (bestSnap) {
        return bestSnap;
      }
    }

    elements.forEach(el => {
      if (excludeElementId && el.id === excludeElementId) {
        return;
      }
      // Endpoint snapping
      if (el.type === 'guideline' || el.type === 'yellow_double' || el.type === 'white_double' || el.type === 'white_dashed' || el.type === 'yellow_dashed' || el.type === 'white_solid' || el.type === 'smart_path' || el.type === 'parking_zone') {
        const line = el as any;
        const ref = getLineBezierRepresentation(line);

        if (ref) {
          // Snap to any intermediate anchor points
          if (snapToEndpoint) {
            ref.points.forEach((pt: Point2D) => {
              const screenPt = worldToScreen(pt.x, pt.y);
              const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
              if (d < closestDistScreen) {
                closestDistScreen = d;
                bestSnap = { point: pt, type: 'endpoint', elementId: el.id };
              }
            });
          }

          // Snap to midpoint along overall subdivisions
          if (snapToMidpoint && !bestSnap && ref.points.length > 0) {
            const midIndex = Math.floor(ref.points.length / 2);
            const pt = ref.points[midIndex];
            const screenPt = worldToScreen(pt.x, pt.y);
            const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
            if (d < closestDistScreen) {
              closestDistScreen = d;
              bestSnap = { point: pt, type: 'midpoint', elementId: el.id };
            }
          }
        } else if (line.p1 && line.p2) {
          if (snapToEndpoint) {
            const pts = [line.p1, line.p2];
            pts.forEach(pt => {
              const screenPt = worldToScreen(pt.x, pt.y);
              const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
              if (d < closestDistScreen) {
                closestDistScreen = d;
                bestSnap = { point: pt, type: 'endpoint', elementId: el.id };
              }
            });
          }
          if (snapToMidpoint && !bestSnap) {
            const midPt = { x: (line.p1.x + line.p2.x) / 2, y: (line.p1.y + line.p2.y) / 2 };
            const screenPt = worldToScreen(midPt.x, midPt.y);
            const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
            if (d < closestDistScreen) {
              closestDistScreen = d;
              bestSnap = { point: midPt, type: 'midpoint', elementId: el.id };
            }
          }
        }
      } else if (el.type === 'sketch_circle') {
        const circ = el as any;
        if (snapToEndpoint) {
          // Snap directly to center point
          const screenC = worldToScreen(circ.center.x, circ.center.y);
          const dCenter = Math.hypot(sx - screenC.x, sy - screenC.y);
          if (dCenter < closestDistScreen) {
            closestDistScreen = dCenter;
            bestSnap = { point: circ.center, type: 'endpoint', elementId: el.id };
          }
        }
      } else if (el.type === 'three_center_curve') {
        const curve = el as ThreeCenterCurveElement;
        const pointsToSnap = [
          { pt: curve.pStart, label: 'pStart' },
          { pt: curve.pEnd, label: 'pEnd' },
          { pt: curve.T1, label: 'T1' },
          { pt: curve.T2, label: 'T2' }
        ];
        
        if (snapToEndpoint) {
          pointsToSnap.forEach(item => {
            const screenPt = worldToScreen(item.pt.x, item.pt.y);
            const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
            if (d < closestDistScreen) {
              closestDistScreen = d;
              bestSnap = { point: item.pt, type: 'endpoint', elementId: el.id };
            }
          });
        }
      } else if (el.type === 'island') {
        const island = el as IslandElement;
        if (snapToEndpoint) {
          island.points.forEach((pt: Point2D) => {
            const screenPt = worldToScreen(pt.x, pt.y);
            const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
            if (d < closestDistScreen) {
              closestDistScreen = d;
              bestSnap = { point: pt, type: 'endpoint', elementId: el.id };
            }
          });
        }
      } else if (el.type === 'crosswalk') {
        const cw = el as any;
        if (snapToEndpoint) {
          const pts = [cw.pA1, cw.pA2, cw.pB1, cw.pB2];
          pts.forEach(pt => {
            const screenPt = worldToScreen(pt.x, pt.y);
            const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
            if (d < closestDistScreen) {
              closestDistScreen = d;
              bestSnap = { point: pt, type: 'endpoint', elementId: el.id };
            }
          });
        }
        if (snapToMidpoint && !bestSnap) {
          const midA = { x: (cw.pA1.x + cw.pA2.x) / 2, y: (cw.pA1.y + cw.pA2.y) / 2 };
          const midB = { x: (cw.pB1.x + cw.pB2.x) / 2, y: (cw.pB1.y + cw.pB2.y) / 2 };
          const midPoints = [midA, midB];
          midPoints.forEach(pt => {
            const screenPt = worldToScreen(pt.x, pt.y);
            const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
            if (d < closestDistScreen) {
              closestDistScreen = d;
              bestSnap = { point: pt, type: 'midpoint', elementId: el.id };
            }
          });
        }
      }
    });

    // 2. Check grid snap
    if (!bestSnap && snapToGrid) {
      let snapInterval = minorGridInterval;
      if (canvasRef.current) {
        const visibleWidthMeters = canvasRef.current.width / viewport.zoom;
        if (visibleWidthMeters <= 30 && snapInterval >= 1) {
          snapInterval = 0.1;
        } else if (visibleWidthMeters <= 10 && snapInterval >= 0.2) {
          snapInterval = 0.05;
        }
      }
      const gx = Math.round(worldPos.x / snapInterval) * snapInterval;
      const gy = Math.round(worldPos.y / snapInterval) * snapInterval;
      
      const screenG = worldToScreen(gx, gy);
      const dGrid = Math.hypot(sx - screenG.x, sy - screenG.y);
      if (dGrid < 25) {
        bestSnap = { point: { x: gx, y: gy }, type: 'grid' };
      }
    }

    return bestSnap;
  };

  // Pointer move handler
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (isPanning) {
      const dx = sx - panStart.x;
      const dy = sy - panStart.y;
      setViewport(prev => ({
        ...prev,
        panX: prev.panX + dx,
        panY: prev.panY + dy
      }));
      setPanStart({ x: sx, y: sy });
      return;
    }

    if (appMode === 'simulation') {
      const literalWorld = screenToWorld(sx, sy);
      const snap = computeSnapPoint(literalWorld, sx, sy);
      const activeWorldPos = snap ? snap.point : literalWorld;
      setMouseWorld(activeWorldPos);
      setSnapTarget(snap);

      const pxX = activeWorldPos.x * simConfig.scale;
      const pxY = activeWorldPos.y * simConfig.scale;

      if (simIsIntersectionMode) {
        if (isDraggingRoadA && setSimP0Angle && simP0X !== null && simP0Y !== null) {
          const dx = pxX - simP0X;
          const dy = pxY - simP0Y;
          if (Math.hypot(dx, dy) > 2) {
            setSimP0Angle(Math.round(Math.atan2(dy, dx) * 180 / Math.PI));
          }
          return;
        }
        if (isDraggingRoadB && setSimP3Angle && simP3X !== null && simP3Y !== null) {
          const dx = pxX - simP3X;
          const dy = pxY - simP3Y;
          if (Math.hypot(dx, dy) > 2) {
            setSimP3Angle(Math.round(Math.atan2(dy, dx) * 180 / Math.PI));
          }
          return;
        }
        if (activeDragPoint === "p0" && setSimP0X && setSimP0Y) {
          setSimP0X(Math.round(pxX));
          setSimP0Y(Math.round(pxY));
        } else if (activeDragPoint === "p3" && setSimP3X && setSimP3Y) {
          setSimP3X(Math.round(pxX));
          setSimP3Y(Math.round(pxY));
        }
        return;
      }

      if (simIsDraggingFirstVec && setSimFirstVecEnd) {
        setSimFirstVecEnd({ x: pxX, y: pxY });
        return;
      }

      if (simDrawMode === 'drag' && isSimDrawingDragRef.current && setSimRawPoints) {
        setSimRawPoints(prev => {
          if (prev.length === 0) {
            return [{ x: pxX, y: pxY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }];
          } else {
            const lastPt = prev[prev.length - 1];
            const dist = Math.hypot(pxX - lastPt.x, pxY - lastPt.y);
            const threshold = prev.length === 1 ? 1.0 : 5.0;
            if (dist > threshold) {
              return [...prev, { x: pxX, y: pxY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }];
            }
            return prev;
          }
        });
        return;
      }

      if (isDraggingWholePath && pathDragStartWorld && setSimRawPoints && pathDragStartPoints.length > 0) {
        const dx = activeWorldPos.x - pathDragStartWorld.x;
        const dy = activeWorldPos.y - pathDragStartWorld.y;
        const dxPx = dx * simConfig.scale;
        const dyPx = dy * simConfig.scale;

        const updated = pathDragStartPoints.map(wp => ({
          ...wp,
          x: wp.x + dxPx,
          y: wp.y + dyPx
        }));
        setSimRawPoints(updated);
        return;
      }

      if (simDraggingWaypointIndex !== null && simDraggingHandleType !== null && setSimRawPoints && simRawPoints.length > 0) {
        const updatedPoints = [...simRawPoints];
        const wp = { ...updatedPoints[simDraggingWaypointIndex] };

        if (simDraggingHandleType === 'anchor') {
          wp.x = pxX;
          wp.y = pxY;
        } else if (simDraggingHandleType === 'handleOut') {
          wp.handleOut = {
            x: pxX - wp.x,
            y: pxY - wp.y
          };
          wp.handleIn = {
            x: -wp.handleOut.x,
            y: -wp.handleOut.y
          };
        } else if (simDraggingHandleType === 'handleIn') {
          wp.handleIn = {
            x: pxX - wp.x,
            y: pxY - wp.y
          };
          wp.handleOut = {
            x: -wp.handleIn.x,
            y: -wp.handleIn.y
          };
        }

        updatedPoints[simDraggingWaypointIndex] = wp;
        setSimRawPoints(updatedPoints);
        
        if (setSimCurrentStepIndex) setSimCurrentStepIndex(0);
        if (simFractionalStepRef) simFractionalStepRef.current = 0;
      }
      return;
    }

    const literalWorld = screenToWorld(sx, sy);
    const snap = computeSnapPoint(
      literalWorld, 
      sx, 
      sy, 
      draggedSmartPathItem?.elementId || activeHandle?.elementId || draggedCrosswalkItem?.elementId
    );
    let activeWorldPos = snap ? snap.point : literalWorld;

    if (e.shiftKey) {
      if (isLineOrPathTool(activeTool) && spPoints.length > 0) {
        const p0 = spPoints[spPoints.length - 1];
        const dx = activeWorldPos.x - p0.x;
        const dy = activeWorldPos.y - p0.y;
        if (Math.abs(dx) >= Math.abs(dy)) {
          activeWorldPos = { x: activeWorldPos.x, y: p0.y };
        } else {
          activeWorldPos = { x: p0.x, y: activeWorldPos.y };
        }
      } else if (activeTool === 'crosswalk' && draftPoints.length > 0) {
        const p0 = draftPoints[draftPoints.length - 1];
        const dx = activeWorldPos.x - p0.x;
        const dy = activeWorldPos.y - p0.y;
        if (Math.abs(dx) >= Math.abs(dy)) {
          activeWorldPos = { x: activeWorldPos.x, y: p0.y };
        } else {
          activeWorldPos = { x: p0.x, y: activeWorldPos.y };
        }
      }
    }
    
    if (isLineOrPathTool(activeTool) && spPoints.length >= 2) {
      const firstPt = spPoints[0];
      const screenFirstPt = worldToScreen(firstPt.x, firstPt.y);
      const distScreen = Math.hypot(sx - screenFirstPt.x, sy - screenFirstPt.y);
      if (distScreen < 15) {
        activeWorldPos = { ...firstPt };
        if (!isClosingPathDrag) setIsClosingPathDrag(true);
      } else {
        if (isClosingPathDrag) setIsClosingPathDrag(false);
      }
    } else {
      if (isClosingPathDrag) setIsClosingPathDrag(false);
    }
    
    setMouseWorld(activeWorldPos);
    setSnapTarget(snap);

    // 0.0 Marquee Dragging Selection
    if (isMarqueeDragging && marqueeStartPos) {
      setMarqueeEndPos({ x: sx, y: sy });
      performMarqueeSelection(marqueeStartPos, { x: sx, y: sy });
      return;
    }

    // 0.1 Element Translation Drag
    if (isDraggingElement && elementDragStartPos && elementInitialState) {
      const dx = activeWorldPos.x - elementDragStartPos.x;
      const dy = activeWorldPos.y - elementDragStartPos.y;

      const isMultiDrag = Object.keys(draggedElementsInitialStates).length > 0;
      if (isMultiDrag && onUpdateElements) {
        const nextElements = elements.map(el => {
          const initial = draggedElementsInitialStates[el.id];
          if (initial) {
            return transformElement(initial, dx, dy, 0, { x: 0, y: 0 });
          }
          return el;
        });
        onUpdateElements(nextElements);
      } else {
        const nextEl = transformElement(elementInitialState, dx, dy, 0, { x: 0, y: 0 });
        onUpdateElement(nextEl);
      }
      return;
    }

    // 0.2 Element Rotation Drag
    if (isRotatingElement && elementRotateCenter && elementInitialStateForRot) {
      const currentAngle = Math.atan2(activeWorldPos.y - elementRotateCenter.y, activeWorldPos.x - elementRotateCenter.x);
      const deltaAngle = currentAngle - elementRotateStartAngle;
      const nextEl = transformElement(elementInitialStateForRot, 0, 0, deltaAngle, elementRotateCenter);
      
      // Keep parking space angle variable updated in sync
      if (nextEl.type === 'parking_space') {
        const initialAngle = elementInitialStateForRot.angle || 0;
        let newAngle = initialAngle + deltaAngle;
        while (newAngle > Math.PI) newAngle -= 2 * Math.PI;
        while (newAngle < -Math.PI) newAngle += 2 * Math.PI;
        nextEl.angle = newAngle;
      }
      
      onUpdateElement(nextEl);
      return;
    }

    if (activeTool === 'map_scale' && scaleStartPt) {
      setScaleEndPt(activeWorldPos);
      setScalingEndScreen({ x: sx, y: sy });
      return;
    }

    // 1. Dragging sketch circle center or radius controllers
    if (activeHandle) {
      if (activeHandle.nodeIndex === 25) { // dragging parking space center (rotation)
        latestMouseWorldPosRef.current = activeWorldPos;
        return;
      }
      if (activeHandle.nodeIndex === 30) { // dragging road arrow center (rotation)
        latestMouseWorldPosRef.current = activeWorldPos;
        return;
      }
      if (activeHandle.nodeIndex === 10) { // dragging sketch circle center
        const circ = elements.find(el => el.id === activeHandle.elementId) as any;
        if (circ) {
          onUpdateElement({
            ...circ,
            center: activeWorldPos
          });
        }
        return;
      }
      if (activeHandle.nodeIndex === 11) { // dragging sketch circle radius
        const circ = elements.find(el => el.id === activeHandle.elementId) as any;
        if (circ) {
          const r = distance(circ.center, activeWorldPos);
          if (r > 0.1) {
            onUpdateElement({
              ...circ,
              radius: r
            });
          }
        }
        return;
      }
      if (activeHandle.nodeIndex === 20) { // dragging parking space p1
        const pk = elements.find(el => el.id === activeHandle.elementId) as any;
        if (pk) {
          onUpdateElement({
            ...pk,
            p1: activeWorldPos
          });
        }
        return;
      }
      if (activeHandle.nodeIndex === 21) { // dragging parking space p2
        const pk = elements.find(el => el.id === activeHandle.elementId) as any;
        if (pk) {
          onUpdateElement({
            ...pk,
            p2: activeWorldPos
          });
        }
        return;
      }
    }

    // 2. Dragging smart path handles / anchors under SELECT mode
    if (draggedSmartPathItem) {
      const sp = elements.find(el => el.id === draggedSmartPathItem.elementId) as any;
      if (sp) {
        const i = draggedSmartPathItem.nodeIndex;
        const newPts = [...sp.points];
        const newCpLeft = [...sp.cpLeft];
        const newCpRight = [...sp.cpRight];

        if (draggedSmartPathItem.type === 'anchor') {
          let currentPos = activeWorldPos;
          if (e.shiftKey && dragStartAnchor && dragStartRefPoint) {
            const dxLine = dragStartAnchor.x - dragStartRefPoint.x;
            const dyLine = dragStartAnchor.y - dragStartRefPoint.y;
            const len = Math.hypot(dxLine, dyLine);
            if (len > 0.0001) {
              const ux = dxLine / len;
              const uy = dyLine / len;
              const mx = activeWorldPos.x - dragStartRefPoint.x;
              const my = activeWorldPos.y - dragStartRefPoint.y;
              const dotProd = mx * ux + my * uy;
              currentPos = {
                x: dragStartRefPoint.x + dotProd * ux,
                y: dragStartRefPoint.y + dotProd * uy
              };
            }
          }

          const oldAnchor = newPts[i];
          const dx = currentPos.x - oldAnchor.x;
          const dy = currentPos.y - oldAnchor.y;
          
          newPts[i] = currentPos;
          newCpLeft[i] = { x: newCpLeft[i].x + dx, y: newCpLeft[i].y + dy };
          newCpRight[i] = { x: newCpRight[i].x + dx, y: newCpRight[i].y + dy };

          if (sp.type === 'smart_path') {
            const smoothed = smoothBezierControlPoints(newPts);
            for (let k = 0; k < newPts.length; k++) {
              newCpLeft[k] = smoothed.cpLeft[k];
              newCpRight[k] = smoothed.cpRight[k];
            }
          }
        } else if (draggedSmartPathItem.type === 'cpRight') {
          newCpRight[i] = activeWorldPos;
          
          // symmetry opposite
          const anchor = newPts[i];
          const dx = activeWorldPos.x - anchor.x;
          const dy = activeWorldPos.y - anchor.y;
          newCpLeft[i] = { x: anchor.x - dx, y: anchor.y - dy };
        } else if (draggedSmartPathItem.type === 'cpLeft') {
          newCpLeft[i] = activeWorldPos;
          
          // symmetry opposite
          const anchor = newPts[i];
          const dx = activeWorldPos.x - anchor.x;
          const dy = activeWorldPos.y - anchor.y;
          newCpRight[i] = { x: anchor.x - dx, y: anchor.y - dy };
        }

        // Recalculate curve safety values
        let minR = Infinity;
        if (newPts.length > 1) {
          for (let j = 0; j < newPts.length - 1; j++) {
            const r = getBezierMinRadiusOfCurvature(newPts[j], newCpRight[j], newCpLeft[j + 1], newPts[j + 1]);
            if (r < minR) minR = r;
          }
        }
        
        const limit = designVehicle === 'passenger' ? 4.5 : 12.5;
        const isValid = minR >= limit;

        onUpdateElement({
          ...sp,
          points: newPts,
          cpLeft: newCpLeft,
          cpRight: newCpRight,
          minRadius: minR === Infinity ? 999 : minR,
          isValid
        });
      }
      return;
    }

    // 2.5. Dragging crosswalk corners under SELECT mode
    if (draggedCrosswalkItem) {
      const cw = elements.find(el => el.id === draggedCrosswalkItem.elementId) as any;
      if (cw) {
        onUpdateElement({
          ...cw,
          [draggedCrosswalkItem.pointKey]: activeWorldPos
        });
      }
      return;
    }

    // 3. Spdragging active curves handles under active construction
    if (isLineOrPathTool(activeTool) && spDraggingIndex !== null) {
      const i = spDraggingIndex;
      const anchor = spPoints[i];
      const dx = activeWorldPos.x - anchor.x;
      const dy = activeWorldPos.y - anchor.y;

      const newCpLeft = [...spCpLeft];
      const newCpRight = [...spCpRight];

      if (i === 0 && isClosingPathDrag) {
        // Only adjust entering handle (cpLeft) of first point, and leaving handle (cpRight) of the last point.
        // Keep leaving handle of first point (cpRight[0]) anchored on the first segment's existing fixed curvature!
        newCpLeft[0] = { x: anchor.x - dx, y: anchor.y - dy };
        if (spPoints.length >= 2) {
          const lastIdx = spPoints.length - 1;
          newCpRight[lastIdx] = { x: spPoints[lastIdx].x + dx, y: spPoints[lastIdx].y + dy };
        }
      } else {
        newCpRight[i] = { x: anchor.x + dx, y: anchor.y + dy };
        newCpLeft[i] = { x: anchor.x - dx, y: anchor.y - dy };
      }

      setSpCpLeft(newCpLeft);
      setSpCpRight(newCpRight);
    }
  };

  // Safe handler to finish drawing a curved lane marker or smart path
  const handleCompleteSmartPath = (points: Point2D[], cpLeft: Point2D[], cpRight: Point2D[]) => {
    if (points.length < 2) {
      setSpPoints([]);
      setSpCpLeft([]);
      setSpCpRight([]);
      setConnectionStartInfo(null);
      return;
    }

    const actualType = isLineOrPathTool(activeTool) ? activeTool : 'white_solid';
    const finalType = actualType === 'channelization' ? 'island' : actualType;

    let merged = false;
    if (connectionStartInfo && selectedElement && selectedElement.type === finalType) {
      const targetEl = selectedElement as any;
      const tPts = [...targetEl.points];
      const tCpL = [...targetEl.cpLeft];
      const tCpR = [...targetEl.cpRight];

      const nPts = [...points];
      const nCpL = [...cpLeft];
      const nCpR = [...cpRight];

      let mergedPts: Point2D[] = [];
      let mergedCpL: Point2D[] = [];
      let mergedCpR: Point2D[] = [];

      const reverseBezier = (pts: Point2D[], cpl: Point2D[], cpr: Point2D[]) => {
        const revPts = [...pts].reverse();
        const revCpl = [...cpr].reverse();
        const revCpr = [...cpl].reverse();
        return { pts: revPts, cpl: revCpl, cpr: revCpr };
      };

      if (connectionStartInfo.isStart) {
        const revNew = reverseBezier(nPts, nCpL, nCpR);
        mergedPts = [...revNew.pts.slice(0, -1), ...tPts];
        mergedCpL = [...revNew.cpl.slice(0, -1), ...tCpL];
        mergedCpR = [...revNew.cpr.slice(0, -1), ...tCpR];
      } else {
        mergedPts = [...tPts, ...nPts.slice(1)];
        mergedCpL = [...tCpL, ...nCpL.slice(1)];
        mergedCpR = [...tCpR, ...nCpR.slice(1)];
      }

      let mergedMinR = Infinity;
      for (let j = 0; j < mergedPts.length - 1; j++) {
        const r = getBezierMinRadiusOfCurvature(mergedPts[j], mergedCpR[j], mergedCpL[j + 1], mergedPts[j + 1]);
        if (r < mergedMinR) mergedMinR = r;
      }
      const limit = designVehicle === 'passenger' ? 4.5 : 12.5;
      const isValid = mergedMinR >= limit;

      const updatedEl = {
        ...targetEl,
        points: mergedPts,
        cpLeft: mergedCpL,
        cpRight: mergedCpR,
        minRadius: mergedMinR === Infinity ? 999 : mergedMinR,
        isValid
      };

      onUpdateElement(updatedEl);
      onSelectElement(updatedEl);
      merged = true;
    }

    if (merged) {
      setSpPoints([]);
      setSpCpLeft([]);
      setSpCpRight([]);
      setConnectionStartInfo(null);
      return;
    }

    let minR = Infinity;
    for (let j = 0; j < points.length - 1; j++) {
      const r = getBezierMinRadiusOfCurvature(points[j], cpRight[j], cpLeft[j + 1], points[j + 1]);
      if (r < minR) minR = r;
    }

    const limit = designVehicle === 'passenger' ? 4.5 : 12.5;
    const isValid = minR >= limit;

    if (finalType === 'yield_line') {
      setYieldLineDecisionState({
        points: [...points],
        cpLeft: [...cpLeft],
        cpRight: [...cpRight],
        minRadius: minR === Infinity ? 999 : minR,
        isValid
      });
      setSpPoints([]);
      setSpCpLeft([]);
      setSpCpRight([]);
      return;
    }

    const newEl: CadElement = {
      id: `${finalType}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      type: finalType as any,
      points: [...points],
      cpLeft: [...cpLeft],
      cpRight: [...cpRight],
      minRadius: minR === Infinity ? 999 : minR,
      isValid,
      ...(finalType === 'Sidewalk' ? { closed: true } : {}),
      ...(finalType === 'island' ? { hasHatching: true, laneWidth: R2, designVehicle } : {}),
      ...(finalType === 'parking_zone' ? {
        slotType: parkingZoneConfig?.slotType || 'car',
        width: parkingZoneConfig?.width || 2.0,
        length: parkingZoneConfig?.length || 5.0,
        angle: parkingZoneConfig?.angle !== undefined ? parkingZoneConfig.angle : 90,
        gap: parkingZoneConfig?.gap !== undefined ? parkingZoneConfig.gap : 0.2,
        side: parkingZoneConfig?.side || 'right'
      } : {})
    } as any;

    onAddElement(newEl);
    onSelectElement(newEl);
    setSpPoints([]);
    setSpCpLeft([]);
    setSpCpRight([]);
  };

  const handleSaveCalibration = () => {
    if (!calibrationDialog) return;
    const realDist = parseFloat(calibrationDialog.rawInput);
    if (!isNaN(realDist) && realDist > 0) {
      setCalibrationError(null);
      const currentPPM = bgImage?.pixelPerMeter || 20;
      const pixelDist = calibrationDialog.screenDist * currentPPM / viewport.zoom;
      const newPixelPerMeter = pixelDist / realDist;

      setBgImage((prev: any) => {
        if (!prev) return null;
        return {
          ...prev,
          pixelPerMeter: newPixelPerMeter,
          widthMeters: bgImgRef.current ? bgImgRef.current.width / newPixelPerMeter : prev.widthMeters,
          heightMeters: bgImgRef.current ? bgImgRef.current.height / newPixelPerMeter : prev.heightMeters,
          isCalibrated: true,
        };
      });
      
      setCalibrationDialog(null);
      setScaleStartPt(null);
      setScaleEndPt(null);
      setScalingStartScreen(null);
      setScalingEndScreen(null);
      setIsScalingDrag(false);
      setActiveTool('select');
    } else {
      setCalibrationError('請輸入有效且大於 0 的公尺數值！');
    }
  };

  const performMarqueeSelection = (start: Point2D, end: Point2D) => {
    if (!onSelectElementIdsChange) return;

    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);

    // AutoCAD style: Drag left-to-right (end.x >= start.x) -> Enclosed mode (blue)
    // Drag right-to-left (end.x < start.x) -> Touching mode (green)
    const isEncloseMode = end.x >= start.x;

    const selectedIds: string[] = [];

    // Define 4 corner points of the marquee box in screen-space
    const sc1 = { x: minX, y: minY };
    const sc2 = { x: maxX, y: minY };
    const sc3 = { x: maxX, y: maxY };
    const sc4 = { x: minX, y: maxY };

    const marqueeEdges = [
      { p1: sc1, p2: sc2 },
      { p1: sc2, p2: sc3 },
      { p1: sc3, p2: sc4 },
      { p1: sc4, p2: sc1 }
    ];

    elements.forEach(el => {
      const vertices = getElementVertices(el);
      if (vertices.length === 0) return;

      // Convert all vertices to Screen-space
      const verticesScr = vertices.map(pt => worldToScreen(pt.x, pt.y));

      const inMarqueeResults = verticesScr.map(scr => {
        return scr.x >= minX && scr.x <= maxX && scr.y >= minY && scr.y <= maxY;
      });

      if (isEncloseMode) {
        // Enclose mode: All vertices MUST be completely inside the marquee
        if (inMarqueeResults.every(r => r === true)) {
          selectedIds.push(el.id);
        }
      } else {
        // Touching mode: 
        // Case 1: At least one vertex is inside the marquee
        const someVertInside = inMarqueeResults.some(r => r === true);
        if (someVertInside) {
          selectedIds.push(el.id);
          return;
        }

        // Case 2: Or any edge of the element intersects with any edge of the marquee
        let intersectsMarquee = false;
        const elEdges: Array<{ p1: Point2D; p2: Point2D }> = [];

        if (el.type === 'sketch_circle') {
          // Circle doesn't have simple line-segments, but verticesScr has 5 points (center + 4 boundary cardinal directions),
          // which is covered nicely by Case 1 and Case 3 on center coordinates.
        } else if (el.type === 'crosswalk' || el.type === 'island' || el.type === 'Sidewalk') {
          // Closed polygon loop edges
          for (let i = 0; i < verticesScr.length; i++) {
            elEdges.push({
              p1: verticesScr[i],
              p2: verticesScr[(i + 1) % verticesScr.length]
            });
          }
        } else {
          // Open line segments edges
          for (let i = 0; i < verticesScr.length - 1; i++) {
            elEdges.push({
              p1: verticesScr[i],
              p2: verticesScr[i + 1]
            });
          }
        }

        for (const elEdge of elEdges) {
          for (const mEdge of marqueeEdges) {
            if (lineSegmentsIntersect(elEdge.p1, elEdge.p2, mEdge.p1, mEdge.p2)) {
              intersectsMarquee = true;
              break;
            }
          }
          if (intersectsMarquee) break;
        }

        if (intersectsMarquee) {
          selectedIds.push(el.id);
        }
      }
    });

    onSelectElementIdsChange(selectedIds);
    // Also update selectedElement with the first one so property panels show info if available
    if (selectedIds.length > 0) {
      const firstSelected = elements.find(el => el.id === selectedIds[0]) || null;
      onSelectElement(firstSelected);
    } else {
      onSelectElement(null);
    }
  };

  // Pointer down handler
  const handlePointerDown = (e: React.PointerEvent) => {
    containerRef.current?.focus();
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (appMode === 'simulation') {
      if (e.button === 1 || (e.button === 0 && spacePressed)) {
        setIsPanning(true);
        setPanStart({ x: sx, y: sy });
        e.preventDefault();
        return;
      }
      if (e.button === 2) {
        if (simRawPoints && simRawPoints.length === 1 && setSimRawPoints) {
          setSimRawPoints([]);
        }
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;

      const clickPt = snapTarget ? snapTarget.point : screenToWorld(sx, sy);
      const pxX = clickPt.x * simConfig.scale;
      const pxY = clickPt.y * simConfig.scale;

      if (simIsIntersectionMode) {
        if (simIntersectionPickState === "p0" && setSimP0X && setSimP0Y) {
          setSimP0X(Math.round(pxX));
          setSimP0Y(Math.round(pxY));
          setIsDraggingRoadA(true);
          if (setSimIsDragging) setSimIsDragging(true);
          return;
        }
        if (simIntersectionPickState === "p3" && setSimP3X && setSimP3Y) {
          setSimP3X(Math.round(pxX));
          setSimP3Y(Math.round(pxY));
          setIsDraggingRoadB(true);
          if (setSimIsDragging) setSimIsDragging(true);
          return;
        }

        const hasP0 = simP0X !== null && simP0Y !== null;
        const hasP3 = simP3X !== null && simP3Y !== null;

        if (hasP0) {
          const screenP0 = worldToScreen(simP0X / simConfig.scale, simP0Y / simConfig.scale);
          if (Math.hypot(sx - screenP0.x, sy - screenP0.y) < 18) {
            setActiveDragPoint("p0");
            if (setSimIsDragging) setSimIsDragging(true);
            return;
          }
        }
        if (hasP3) {
          const screenP3 = worldToScreen(simP3X / simConfig.scale, simP3Y / simConfig.scale);
          if (Math.hypot(sx - screenP3.x, sy - screenP3.y) < 18) {
            setActiveDragPoint("p3");
            if (setSimIsDragging) setSimIsDragging(true);
            return;
          }
        }
        return;
      }

      if (simDrawMode === 'select') {
        let hitNodeIndex: number | null = null;
        let hitType: 'anchor' | 'handleIn' | 'handleOut' | null = null;
        const hitRadiusPx = 15;

        for (let i = 0; i < simRawPoints.length; i++) {
          const wp = simRawPoints[i];
          const screenAnchor = worldToScreen(wp.x / simConfig.scale, wp.y / simConfig.scale);
          if (Math.hypot(sx - screenAnchor.x, sy - screenAnchor.y) < hitRadiusPx) {
            hitNodeIndex = i;
            hitType = 'anchor';
            break;
          }

          if (wp.handleIn) {
            const screenIn = worldToScreen((wp.x + wp.handleIn.x) / simConfig.scale, (wp.y + wp.handleIn.y) / simConfig.scale);
            if (Math.hypot(sx - screenIn.x, sy - screenIn.y) < hitRadiusPx) {
              hitNodeIndex = i;
              hitType = 'handleIn';
              break;
            }
          }
          if (wp.handleOut) {
            const screenOut = worldToScreen((wp.x + wp.handleOut.x) / simConfig.scale, (wp.y + wp.handleOut.y) / simConfig.scale);
            if (Math.hypot(sx - screenOut.x, sy - screenOut.y) < hitRadiusPx) {
              hitNodeIndex = i;
              hitType = 'handleOut';
              break;
            }
          }
        }

        if (hitNodeIndex !== null && hitType !== null && setSimDraggingWaypointIndex && setSimDraggingHandleType) {
          setSimDraggingWaypointIndex(hitNodeIndex);
          setSimDraggingHandleType(hitType);
          if (setSimIsPlaying) setSimIsPlaying(false);
          if (setSimIsDragging) setSimIsDragging(true);
          return;
        }

        // 如果沒有點到點或手柄，檢測是否點拉了該軌跡的路徑連線部分，以供整條軌跡平移
        let hitWholePath = false;
        if (simRawPoints.length >= 2) {
          for (let i = 0; i < simRawPoints.length - 1; i++) {
            const wp0 = simRawPoints[i];
            const wp1 = simRawPoints[i + 1];
            const p0 = { x: wp0.x, y: wp0.y };
            const cp0 = { x: wp0.x + wp0.handleOut.x, y: wp0.y + wp0.handleOut.y };
            const cp1 = { x: wp1.x + wp1.handleIn.x, y: wp1.y + wp1.handleIn.y };
            const p1 = { x: wp1.x, y: wp1.y };

            const samples = sampleCubicBezier(p0, cp0, cp1, p1, 15);
            for (let j = 0; j < samples.length - 1; j++) {
              const sPt1 = worldToScreen(samples[j].x / simConfig.scale, samples[j].y / simConfig.scale);
              const sPt2 = worldToScreen(samples[j + 1].x / simConfig.scale, samples[j + 1].y / simConfig.scale);
              const res = projectPointOnSegment({ x: sx, y: sy }, sPt1, sPt2);
              if (res.dist < 12) {
                hitWholePath = true;
                break;
              }
            }
            if (hitWholePath) break;
          }
        }

        if (hitWholePath) {
          setIsDraggingWholePath(true);
          setPathDragStartWorld(clickPt);
          setPathDragStartPoints([...simRawPoints]);
          if (setSimIsPlaying) setSimIsPlaying(false);
          if (setSimIsDragging) setSimIsDragging(true);
          return;
        }

        if (simLockedPaths && simLockedPaths.length > 0) {
          for (let lpIdx = 0; lpIdx < simLockedPaths.length; lpIdx++) {
            const lp = simLockedPaths[lpIdx];
            const lpScale = lp.config.scale;
            let hitLp = false;
            for (let i = 0; i < lp.rawPoints.length; i++) {
              const wp = lp.rawPoints[i];
              const screenAnchor = worldToScreen(wp.x / lpScale, wp.y / lpScale);
              if (Math.hypot(sx - screenAnchor.x, sy - screenAnchor.y) < hitRadiusPx) {
                hitLp = true;
                break;
              }
            }
            if (hitLp) {
              if (onSelectLockedPath) {
                onSelectLockedPath(lp.id);
              }
              return;
            }
          }
        }
        return;
      }

      if (simRawPoints.length === 0) {
        if (simDrawMode !== 'drag') {
          if (setSimIsDraggingFirstVec && setSimFirstVecStart && setSimFirstVecEnd && setSimCurrentStepIndex && simFractionalStepRef) {
            setSimIsDraggingFirstVec(true);
            setSimFirstVecStart({ x: pxX, y: pxY });
            setSimFirstVecEnd({ x: pxX, y: pxY });
            if (simClickStartHeadingRef) simClickStartHeadingRef.current = null;
            setSimCurrentStepIndex(0);
            simFractionalStepRef.current = 0;
            if (setSimIsDragging) setSimIsDragging(true);
          }
          return;
        } else {
          if (setSimRawPoints) {
            isSimDrawingDragRef.current = true;
            setSimRawPoints([{ x: pxX, y: pxY, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }]);
            if (setSimCurrentStepIndex) setSimCurrentStepIndex(0);
            if (simFractionalStepRef) simFractionalStepRef.current = 0;
            if (setSimIsPlaying) setSimIsPlaying(false);
            if (setSimIsDragging) setSimIsDragging(true);
          }
          return;
        }
      }

      if (simDrawMode === 'drag' && setSimRawPoints) {
        isSimDrawingDragRef.current = true;
        const newWp: Waypoint = {
          x: pxX,
          y: pxY,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 }
        };
        setSimRawPoints([newWp]);
        if (setSimIsPlaying) setSimIsPlaying(false);
        if (setSimCurrentStepIndex) setSimCurrentStepIndex(0);
        if (simFractionalStepRef) simFractionalStepRef.current = 0;
        if (setSimIsDragging) setSimIsDragging(true);
        return;
      }

      if (simDrawMode === 'click' && setSimRawPoints) {
        const newWp: Waypoint = {
          x: pxX,
          y: pxY,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 }
        };
        setSimRawPoints([...simRawPoints, newWp]);
        if (setSimIsPlaying) setSimIsPlaying(false);
        if (setSimCurrentStepIndex) setSimCurrentStepIndex(0);
        if (simFractionalStepRef) simFractionalStepRef.current = 0;
        return;
      }

      let hitNodeIndex: number | null = null;
      let hitType: 'anchor' | 'handleIn' | 'handleOut' | null = null;
      const hitRadiusPx = 25; // 依照原版 simulator 設計使用 25px 便於點擊

      for (let i = 0; i < simRawPoints.length; i++) {
        const wp = simRawPoints[i];
        
        const screenAnchor = worldToScreen(wp.x / simConfig.scale, wp.y / simConfig.scale);
        if (Math.hypot(sx - screenAnchor.x, sy - screenAnchor.y) < hitRadiusPx) {
          hitNodeIndex = i;
          hitType = 'anchor';
          break;
        }

        if (wp.handleIn) {
          const screenIn = worldToScreen((wp.x + wp.handleIn.x) / simConfig.scale, (wp.y + wp.handleIn.y) / simConfig.scale);
          if (Math.hypot(sx - screenIn.x, sy - screenIn.y) < hitRadiusPx) {
            hitNodeIndex = i;
            hitType = 'handleIn';
            break;
          }
        }
        if (wp.handleOut) {
          const screenOut = worldToScreen((wp.x + wp.handleOut.x) / simConfig.scale, (wp.y + wp.handleOut.y) / simConfig.scale);
          if (Math.hypot(sx - screenOut.x, sy - screenOut.y) < hitRadiusPx) {
            hitNodeIndex = i;
            hitType = 'handleOut';
            break;
          }
        }
      }

      if (hitNodeIndex !== null && hitType !== null && setSimDraggingWaypointIndex && setSimDraggingHandleType) {
        if (hitType === 'anchor' && hitNodeIndex === simRawPoints.length - 1) {
          const wp = simRawPoints[hitNodeIndex];
          const isCurve = (wp.handleIn && (wp.handleIn.x !== 0 || wp.handleIn.y !== 0)) ||
                          (wp.handleOut && (wp.handleOut.x !== 0 || wp.handleOut.y !== 0));
          if (isCurve && setSimRawPoints) {
            const updated = [...simRawPoints];
            updated[hitNodeIndex] = {
              ...wp,
              handleIn: { x: 0, y: 0 },
              handleOut: { x: 0, y: 0 }
            };
            setSimRawPoints(updated);
            return;
          }
        }

        setSimDraggingWaypointIndex(hitNodeIndex);
        setSimDraggingHandleType(hitType);
        if (setSimIsPlaying) setSimIsPlaying(false);
        if (setSimIsDragging) setSimIsDragging(true);
      } else if (setSimRawPoints) {
        const newWp: Waypoint = {
          x: pxX,
          y: pxY,
          handleIn: { x: 0, y: 0 },
          handleOut: { x: 0, y: 0 }
        };

        const nextPts = [...simRawPoints, newWp];
        setSimRawPoints(nextPts);

        if (setSimDraggingWaypointIndex && setSimDraggingHandleType) {
          setSimDraggingWaypointIndex(nextPts.length - 1);
          setSimDraggingHandleType('handleOut');
        }

        if (setSimIsPlaying) setSimIsPlaying(false);
        if (setSimCurrentStepIndex) setSimCurrentStepIndex(0);
        if (simFractionalStepRef) simFractionalStepRef.current = 0;
      }
      return;
    }

    // Middle click OR Left-click with Spacebar executes Panning standard
    if (e.button === 1 || (e.button === 0 && spacePressed)) {
      if (activeTool === 'map_scale') {
        // Disable panning under calibration mode to avoid conflict with dragging a scale ruler
        return;
      }
      setIsPanning(true);
      setPanStart({ x: sx, y: sy });
      e.preventDefault();
      return;
    }

    if (e.button === 2) {
      // Right click to cancel or complete
      if (spPoints.length === 1) {
        setSpPoints([]);
        setSpCpLeft([]);
        setSpCpRight([]);
      } else if (spPoints.length >= 2) {
        handleCompleteSmartPath(spPoints, spCpLeft, spCpRight);
      }
      if (draftPoints.length === 1) {
        setDraftPoints([]);
      }
      e.preventDefault();
      return;
    }

    if (e.button !== 0) return; // Only process left clicks below

    const clickPt = snapTarget ? snapTarget.point : screenToWorld(sx, sy);

    if (yieldLineDecisionState) {
      if (e.button === 0) {
        const chosenSign = getSelectedYieldLineSign(yieldLineDecisionState, clickPt);
        const yieldEl: CadElement = {
          id: `yield_line-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          type: 'yield_line',
          points: [...yieldLineDecisionState.points],
          cpLeft: [...yieldLineDecisionState.cpLeft],
          cpRight: [...yieldLineDecisionState.cpRight],
          minRadius: yieldLineDecisionState.minRadius,
          isValid: yieldLineDecisionState.isValid,
          sgn: chosenSign
        } as any;

        onAddElement(yieldEl);
        onSelectElement(yieldEl);
        setYieldLineDecisionState(null);
      }
      return;
    }

    if (activeTool === 'map_scale') {
      if (!scaleStartPt) {
        // First click
        setScaleStartPt(clickPt);
        setScaleEndPt(clickPt);
        setScalingStartScreen({ x: sx, y: sy });
        setScalingEndScreen({ x: sx, y: sy });
        setIsScalingDrag(true);
      } else {
        // Second click - complete calibration!
        const screenDist = Math.hypot(sx - scalingStartScreen.x, sy - scalingStartScreen.y);
        if (screenDist > 10.0) {
          // Reset immediately
          setScaleStartPt(null);
          setScaleEndPt(null);
          setScalingStartScreen(null);
          setScalingEndScreen(null);
          setIsScalingDrag(false);

          setTimeout(() => {
            setCalibrationDialog({ screenDist, rawInput: '' });
          }, 50);
        } else {
          // If clicked too close to start, reset drawing
          setScaleStartPt(null);
          setScaleEndPt(null);
          setScalingStartScreen(null);
          setScalingEndScreen(null);
          setIsScalingDrag(false);
        }
      }
      return;
    }

    // 1. SELECT tool operations: check handle clicking for segment dragging, smart_paths, or sketch_circles
    if (activeTool === 'select' && selectedElement) {
      const el = selectedElement;

      // Class R: Rotate handle lever check
      const box = getElementBoundingBox(el);
      if (box.maxX !== -Infinity) {
        const midX = (box.minX + box.maxX) / 2;
        const sTop = worldToScreen(midX, box.maxY);
        const sRot = { x: sTop.x, y: sTop.y - 35 };

        if (Math.hypot(sx - sRot.x, sy - sRot.y) < 14) {
          onSaveHistoryBeforeDrag();
          setIsRotatingElement(true);
          const center = getElementCenter(el);
          setElementRotateCenter(center);
          const startAngle = Math.atan2(clickPt.y - center.y, clickPt.x - center.x);
          setElementRotateStartAngle(startAngle);
          setElementInitialStateForRot(JSON.parse(JSON.stringify(el)));
          return;
        }
      }

      // Class A: Line drag handles for any Bezier-represented element
      const ref = getLineBezierRepresentation(el);
      if (ref) {
        // Check anchor clicks
        for (let j = 0; j < ref.points.length; j++) {
          const sPt = worldToScreen(ref.points[j].x, ref.points[j].y);
          if (Math.hypot(sx - sPt.x, sy - sPt.y) < 12) {
            // Normal click: set selection to just this anchor and drag!
            if (setSelectedAnchorIndices) {
              setSelectedAnchorIndices([j]);
            }
            onSaveHistoryBeforeDrag();
            setDraggedSmartPathItem({ elementId: el.id, nodeIndex: j, type: 'anchor' });
            
            // Record original positions to lock angles on shift drag modifier modifies length
            const pStart = ref.points[j];
            setDragStartAnchor({ ...pStart });
            const neighborIdx = j > 0 ? j - 1 : (ref.points.length > 1 ? 1 : null);
            if (neighborIdx !== null) {
              setDragStartRefPoint({ ...ref.points[neighborIdx] });
            } else {
              setDragStartRefPoint(null);
            }
            return;
          }
          // Check handle clicks
          if (ref.cpLeft && ref.cpRight && ref.cpLeft[j] && ref.cpRight[j]) {
            const sCpL = worldToScreen(ref.cpLeft[j].x, ref.cpLeft[j].y);
            const sCpR = worldToScreen(ref.cpRight[j].x, ref.cpRight[j].y);
            if (Math.hypot(sx - sCpL.x, sy - sCpL.y) < 12) {
              onSaveHistoryBeforeDrag();
              setDraggedSmartPathItem({ elementId: el.id, nodeIndex: j, type: 'cpLeft' });
              return;
            }
            if (Math.hypot(sx - sCpR.x, sy - sCpR.y) < 12) {
              onSaveHistoryBeforeDrag();
              setDraggedSmartPathItem({ elementId: el.id, nodeIndex: j, type: 'cpRight' });
              return;
            }
          }
        }
      }

      // Class B: Sketch Circles drag handles
      if (el.type === 'sketch_circle') {
        const circ = el as any;
        const sCenter = worldToScreen(circ.center.x, circ.center.y);
        const sPerim = worldToScreen(circ.center.x + circ.radius, circ.center.y);
        if (Math.hypot(sx - sCenter.x, sy - sCenter.y) < 12) {
          onSaveHistoryBeforeDrag();
          setActiveHandle({ elementId: el.id, nodeIndex: 10 }); // Center drag code
          return;
        }
        if (Math.hypot(sx - sPerim.x, sy - sPerim.y) < 15) {
          onSaveHistoryBeforeDrag();
          setActiveHandle({ elementId: el.id, nodeIndex: 11 }); // Radius resizing code
          return;
        }
      }

      // Class B.5: Parking space drag handles - modified to center point rotation handle
      if (el.type === 'parking_space') {
        const pk = el as any;
        const center = getParkingSpaceCenter(pk);
        const sCenter = worldToScreen(center.x, center.y);

        if (Math.hypot(sx - sCenter.x, sy - sCenter.y) < 12) {
          onSaveHistoryBeforeDrag();
          setActiveHandle({ elementId: el.id, nodeIndex: 25 }); // 25 representing center rotation handle
          
          rotatingCenterRef.current = center;
          detectionRefPointRef.current = center;
          latestMouseWorldPosRef.current = clickPt;
          
          if (rotationIntervalRef.current) {
            clearInterval(rotationIntervalRef.current);
          }
          
          let lastProcessedMousePos: { x: number; y: number } | null = null;
          let isMouseStationary = false;
          
          rotationIntervalRef.current = setInterval(() => {
            if (!rotatingCenterRef.current || !latestMouseWorldPosRef.current) return;
            
            const curMouse = {
              x: latestMouseWorldPosRef.current.x,
              y: latestMouseWorldPosRef.current.y
            };
            
            const didMouseNotMove = lastProcessedMousePos &&
                                    lastProcessedMousePos.x === curMouse.x &&
                                    lastProcessedMousePos.y === curMouse.y;
            
            if (didMouseNotMove) {
              isMouseStationary = true;
            } else {
              if (isMouseStationary && lastProcessedMousePos) {
                detectionRefPointRef.current = { ...lastProcessedMousePos };
              }
              isMouseStationary = false;
            }
            
            lastProcessedMousePos = { ...curMouse };
            
            const curElements = latestElementsRef.current;
            const currentPk = curElements.find(item => item.id === el.id) as any;
            if (!currentPk) return;
            
            const detPt = detectionRefPointRef.current || rotatingCenterRef.current;
            const d = distance(curMouse, detPt);
            const isUp = curMouse.y > detPt.y;
            
            const baseDelta = (1 * Math.PI) / 180; // 1 degree per 100ms -> 10 degrees per second
            const speedFactor = Math.max(0.5, d / 3.0);
            const angleDelta = baseDelta * speedFactor;
            
            const currentAngle = currentPk.angle !== undefined 
              ? currentPk.angle 
              : (currentPk.p2 && currentPk.p1 ? Math.atan2(currentPk.p2.y - currentPk.p1.y, currentPk.p2.x - currentPk.p1.x) : 0);
            
            let newAngle = isUp ? (currentAngle + angleDelta) : (currentAngle - angleDelta);
            while (newAngle > Math.PI) newAngle -= 2 * Math.PI;
            while (newAngle < -Math.PI) newAngle += 2 * Math.PI;
            
            const L = currentPk.length || 5.5;
            const W = currentPk.width || 2.5;
            const cos = Math.cos(newAngle);
            const sin = Math.sin(newAngle);
            
            const newP1 = {
              x: rotatingCenterRef.current.x - (L / 2) * cos + (W / 2) * sin,
              y: rotatingCenterRef.current.y - (L / 2) * sin - (W / 2) * cos
            };
            
            const newP2 = {
              x: newP1.x + cos * L,
              y: newP1.y + sin * L
            };
            
            const updatedPk = {
              ...currentPk,
              angle: newAngle,
              p1: newP1,
              p2: newP2
            };
            
            onUpdateElement(updatedPk);
            
            if (setParkingStampConfig) {
              setParkingStampConfig({
                slotType: currentPk.slotType,
                width: W,
                length: L,
                angle: newAngle
              });
            }
          }, 100);
          return;
        }
      }

      // Class B.6: Road arrow rotation handle
      if (el.type === 'road_arrow') {
        const arrow = el as any;
        const sCenter = worldToScreen(arrow.p.x, arrow.p.y);

        if (Math.hypot(sx - sCenter.x, sy - sCenter.y) < 12) {
          onSaveHistoryBeforeDrag();
          setActiveHandle({ elementId: el.id, nodeIndex: 30 }); // 30 representing road arrow rotation handle
          
          rotatingCenterRef.current = arrow.p;
          detectionRefPointRef.current = arrow.p;
          latestMouseWorldPosRef.current = clickPt;
          
          if (rotationIntervalRef.current) {
            clearInterval(rotationIntervalRef.current);
          }
          
          let lastProcessedMousePos: { x: number; y: number } | null = null;
          let isMouseStationary = false;
          
          rotationIntervalRef.current = setInterval(() => {
            if (!rotatingCenterRef.current || !latestMouseWorldPosRef.current) return;
            
            const curMouse = {
              x: latestMouseWorldPosRef.current.x,
              y: latestMouseWorldPosRef.current.y
            };
            
            const didMouseNotMove = lastProcessedMousePos &&
                                    lastProcessedMousePos.x === curMouse.x &&
                                    lastProcessedMousePos.y === curMouse.y;
            
            if (didMouseNotMove) {
              isMouseStationary = true;
            } else {
              if (isMouseStationary && lastProcessedMousePos) {
                detectionRefPointRef.current = { ...lastProcessedMousePos };
              }
              isMouseStationary = false;
            }
            
            lastProcessedMousePos = { ...curMouse };
            
            const curElements = latestElementsRef.current;
            const currentArrow = curElements.find(item => item.id === el.id) as any;
            if (!currentArrow) return;
            
            const detPt = detectionRefPointRef.current || rotatingCenterRef.current;
            const d = distance(curMouse, detPt);
            const isUp = curMouse.y > detPt.y;
            
            const baseDelta = (1 * Math.PI) / 180;
            const speedFactor = Math.max(0.5, d / 3.0);
            const angleDelta = baseDelta * speedFactor;
            
            const currentAngle = currentArrow.angle !== undefined ? currentArrow.angle : 0;
            
            let newAngle = isUp ? (currentAngle + angleDelta) : (currentAngle - angleDelta);
            while (newAngle > Math.PI) newAngle -= 2 * Math.PI;
            while (newAngle < -Math.PI) newAngle += 2 * Math.PI;
            
            const updatedArrow = {
              ...currentArrow,
              angle: newAngle
            };
            
            onUpdateElement(updatedArrow);
            
            if (setRoadArrowConfig) {
              setRoadArrowConfig({
                arrowType: currentArrow.arrowType,
                length: currentArrow.length,
                angle: newAngle
              });
            }
          }, 100);
          return;
        }
      }

      // Class C: Crosswalk drag handles
      if (el.type === 'crosswalk') {
        const cw = el as any;
        const sA1 = worldToScreen(cw.pA1.x, cw.pA1.y);
        const sA2 = worldToScreen(cw.pA2.x, cw.pA2.y);
        const sB1 = worldToScreen(cw.pB1.x, cw.pB1.y);
        const sB2 = worldToScreen(cw.pB2.x, cw.pB2.y);

        if (Math.hypot(sx - sA1.x, sy - sA1.y) < 12) {
          onSaveHistoryBeforeDrag();
          setDraggedCrosswalkItem({ elementId: el.id, pointKey: 'pA1' });
          return;
        }
        if (Math.hypot(sx - sA2.x, sy - sA2.y) < 12) {
          onSaveHistoryBeforeDrag();
          setDraggedCrosswalkItem({ elementId: el.id, pointKey: 'pA2' });
          return;
        }
        if (Math.hypot(sx - sB1.x, sy - sB1.y) < 12) {
          onSaveHistoryBeforeDrag();
          setDraggedCrosswalkItem({ elementId: el.id, pointKey: 'pB1' });
          return;
        }
        if (Math.hypot(sx - sB2.x, sy - sB2.y) < 12) {
          onSaveHistoryBeforeDrag();
          setDraggedCrosswalkItem({ elementId: el.id, pointKey: 'pB2' });
          return;
        }
      }
    }

    // 2. Select Tool Hit-checking itself (if no handle was captured)
    if (activeTool === 'select') {
      let selected: CadElement | null = null;
      let minDistanceScreen = 25;

      elements.forEach(el => {
        if (
          el.type === 'guideline' || 
          el.type === 'yellow_double' || 
          el.type === 'white_double' || 
          el.type === 'white_dashed' || 
          el.type === 'yellow_dashed' || 
          el.type === 'white_solid' || 
          el.type === 'smart_path' ||
          el.type === 'BuildingLine' ||
          el.type === 'crossing_dashed' ||
          el.type === 'stop_line' ||
          el.type === 'yield_line' ||
          el.type === 'Sidewalk' ||
          el.type === 'reversible_lane' ||
          el.type === 'bicycle_lane'
        ) {
          const line = el as any;
          const ref = getLineBezierRepresentation(line);
          if (ref) {
            let shortestWorldDist = Infinity;
            
            // Uniformly discrete-sample the bezier segment into 25 pieces (yielding 25 micro-line-segments)
            for (let k = 0; k < ref.points.length - 1; k++) {
              const bPts = sampleCubicBezier(
                ref.points[k], 
                ref.cpRight[k] || ref.points[k], 
                ref.cpLeft[k+1] || ref.points[k+1], 
                ref.points[k+1], 
                25
              );
              
              for (let i = 0; i < bPts.length - 1; i++) {
                const segStart = bPts[i];
                const segEnd = bPts[i + 1];
                const proj = projectPointOnSegment(clickPt, segStart, segEnd);
                if (proj.dist < shortestWorldDist) {
                  shortestWorldDist = proj.dist;
                }
              }
            }

            const screenDist = shortestWorldDist * viewport.zoom;
            if (shortestWorldDist < 1.2 || screenDist < 25) {
              if (screenDist < minDistanceScreen) {
                minDistanceScreen = screenDist;
                selected = el;
              }
            }
          }
        } else if (el.type === 'parking_space') {
          const pk = el as any;
          const dx = pk.p2.x - pk.p1.x;
          const dy = pk.p2.y - pk.p1.y;
          const len = Math.hypot(dx, dy);
          const ux = len > 0.0001 ? dx / len : 1;
          const uy = len > 0.0001 ? dy / len : 0;
          const vx = -uy;
          const vy = ux;

          const L = pk.length || 5.0;
          const W = pk.width || 2.0;

          const c1 = pk.p1;
          const c2 = { x: pk.p1.x + ux * L, y: pk.p1.y + uy * L };
          const c3 = { x: pk.p1.x + ux * L + vx * W, y: pk.p1.y + uy * L + vy * W };
          const c4 = { x: pk.p1.x + vx * W, y: pk.p1.y + vy * W };

          let inside = false;
          const quad = [c1, c2, c3, c4];
          for (let h = 0, k = quad.length - 1; h < quad.length; k = h++) {
            const xi = quad[h].x, yi = quad[h].y;
            const xj = quad[k].x, yj = quad[k].y;
            const intersect = ((yi > clickPt.y) !== (yj > clickPt.y))
                && (clickPt.x < (xj - xi) * (clickPt.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }

          if (inside) {
            selected = el;
            minDistanceScreen = 0;
          } else {
            const edges = [
              { p1: c1, p2: c2 },
              { p1: c2, p2: c3 },
              { p1: c3, p2: c4 },
              { p1: c4, p2: c1 }
            ];
            for (const edge of edges) {
              const proj = projectPointOnSegment(clickPt, edge.p1, edge.p2);
              const screenProj = worldToScreen(proj.point.x, proj.point.y);
              const d = Math.hypot(sx - screenProj.x, sy - screenProj.y);
              if (d < minDistanceScreen) {
                minDistanceScreen = d;
                selected = el;
              }
            }
          }
        } else if (el.type === 'sketch_circle') {
          const circ = el as any;
          const sCenter = worldToScreen(circ.center.x, circ.center.y);
          const dCenter = Math.hypot(sx - sCenter.x, sy - sCenter.y);
          const sRad = circ.radius * viewport.zoom;
          const offsetDist = Math.abs(dCenter - sRad);
          if (offsetDist < minDistanceScreen || dCenter < 12) {
            minDistanceScreen = Math.min(offsetDist, dCenter);
            selected = el;
          }
        } else if (el.type === 'island') {
          const island = el as IslandElement;
          let inside = false;
          for (let i = 0, j = island.points.length - 1; i < island.points.length; j = i++) {
            const xi = island.points[i].x, yi = island.points[i].y;
            const xj = island.points[j].x, yj = island.points[j].y;
            const intersect = ((yi > clickPt.y) !== (yj > clickPt.y))
                && (clickPt.x < (xj - xi) * (clickPt.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }

          if (inside) {
            selected = el;
            minDistanceScreen = 0;
          } else {
            for (let i = 0; i < island.points.length; i++) {
              const p1 = island.points[i];
              const p2 = island.points[(i + 1) % island.points.length];
              const proj = projectPointOnSegment(clickPt, p1, p2);
              const screenProj = worldToScreen(proj.point.x, proj.point.y);
              const d = Math.hypot(sx - screenProj.x, sy - screenProj.y);
              if (d < minDistanceScreen) {
                minDistanceScreen = d;
                selected = el;
              }
            }
          }
        } else if (el.type === 'crosswalk') {
          const cw = el as any;
          const edges = [
            { p1: cw.pA1, p2: cw.pA2 },
            { p1: cw.pB1, p2: cw.pB2 },
            { p1: cw.pA1, p2: cw.pB1 },
            { p1: cw.pA2, p2: cw.pB2 }
          ];

          for (const edge of edges) {
            const proj = projectPointOnSegment(clickPt, edge.p1, edge.p2);
            const screenProj = worldToScreen(proj.point.x, proj.point.y);
            const d = Math.hypot(sx - screenProj.x, sy - screenProj.y);
            if (d < minDistanceScreen) {
              minDistanceScreen = d;
              selected = el;
            }
          }

          // Check inside envelope quadrangle (ray-casting algorithm)
          let inside = false;
          const quad = [cw.pA1, cw.pA2, cw.pB2, cw.pB1];
          for (let h = 0, k = quad.length - 1; h < quad.length; k = h++) {
            const xi = quad[h].x, yi = quad[h].y;
            const xj = quad[k].x, yj = quad[k].y;
            const intersect = ((yi > clickPt.y) !== (yj > clickPt.y))
                && (clickPt.x < (xj - xi) * (clickPt.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
          }

          if (inside) {
            selected = el;
            minDistanceScreen = 0;
          }
        } else if (el.type === 'text') {
          const txt = el as any;
          const screenTxt = worldToScreen(txt.p.x, txt.p.y);
          const d = Math.hypot(sx - screenTxt.x, sy - screenTxt.y);
          if (d < minDistanceScreen + 10) {
            minDistanceScreen = d;
            selected = el;
          }
        } else if (el.type === 'parking_zone') {
          const zone = el as any;
          let insideZone = false;
          try {
            const slots = generateParkingZoneSlots(zone);
            for (const slot of slots) {
              const quad = slot.corners;
              let insideSlot = false;
              for (let h = 0, k = quad.length - 1; h < quad.length; k = h++) {
                const xi = quad[h].x, yi = quad[h].y;
                const xj = quad[k].x, yj = quad[k].y;
                const intersect = ((yi > clickPt.y) !== (yj > clickPt.y))
                    && (clickPt.x < (xj - xi) * (clickPt.y - yi) / (yj - yi) + xi);
                if (intersect) insideSlot = !insideSlot;
              }
              if (insideSlot) {
                insideZone = true;
                break;
              }
            }
          } catch (e) {}

          if (insideZone) {
            selected = el;
            minDistanceScreen = 0;
          } else {
            const ref = getLineBezierRepresentation(zone);
            if (ref) {
              let shortestWorldDist = Infinity;
              for (let k = 0; k < ref.points.length - 1; k++) {
                const bPts = sampleCubicBezier(
                  ref.points[k], 
                  ref.cpRight[k] || ref.points[k], 
                  ref.cpLeft[k+1] || ref.points[k+1], 
                  ref.points[k+1], 
                  25
                );
                for (let i = 0; i < bPts.length - 1; i++) {
                  const segStart = bPts[i];
                  const segEnd = bPts[i + 1];
                  const proj = projectPointOnSegment(clickPt, segStart, segEnd);
                  if (proj.dist < shortestWorldDist) {
                    shortestWorldDist = proj.dist;
                  }
                }
              }
              const screenDist = shortestWorldDist * viewport.zoom;
              if (shortestWorldDist < 1.2 || screenDist < 25) {
                if (screenDist < minDistanceScreen) {
                  minDistanceScreen = screenDist;
                  selected = el;
                }
              }
            }
            
            try {
              const slots = generateParkingZoneSlots(zone);
              for (const slot of slots) {
                const quad = slot.corners;
                const edges = [
                  { p1: quad[0], p2: quad[1] },
                  { p1: quad[1], p2: quad[2] },
                  { p1: quad[2], p2: quad[3] },
                  { p1: quad[3], p2: quad[0] }
                ];
                for (const edge of edges) {
                  const proj = projectPointOnSegment(clickPt, edge.p1, edge.p2);
                  const screenProj = worldToScreen(proj.point.x, proj.point.y);
                  const d = Math.hypot(sx - screenProj.x, sy - screenProj.y);
                  if (d < minDistanceScreen) {
                    minDistanceScreen = d;
                    selected = el;
                  }
                }
              }
            } catch (e) {}
          }
        } else if (el.type === 'road_arrow') {
          const arrow = el as any;
          const boundaryPoints = getRoadArrowOutlinePoints(arrow);
          if (boundaryPoints.length > 0) {
            let inside = false;
            for (let i = 0, j = boundaryPoints.length - 1; i < boundaryPoints.length; j = i++) {
              const xi = boundaryPoints[i].x, yi = boundaryPoints[i].y;
              const xj = boundaryPoints[j].x, yj = boundaryPoints[j].y;
              const intersect = ((yi > clickPt.y) !== (yj > clickPt.y))
                  && (clickPt.x < (xj - xi) * (clickPt.y - yi) / (yj - yi) + xi);
              if (intersect) inside = !inside;
            }

            if (inside) {
              selected = el;
              minDistanceScreen = 0;
            } else {
              for (let i = 0; i < boundaryPoints.length; i++) {
                const p1 = boundaryPoints[i];
                const p2 = boundaryPoints[(i + 1) % boundaryPoints.length];
                const proj = projectPointOnSegment(clickPt, p1, p2);
                const screenProj = worldToScreen(proj.point.x, proj.point.y);
                const d = Math.hypot(sx - screenProj.x, sy - screenProj.y);
                if (d < minDistanceScreen) {
                  minDistanceScreen = d;
                  selected = el;
                }
              }
            }
          }
        }
      });

      onSelectElement(selected);
      if (setSelectedAnchorIndices) {
        setSelectedAnchorIndices([]);
      }
      if (selected) {
        onSaveHistoryBeforeDrag();
        setIsDraggingElement(true);
        setElementDragStartPos(clickPt);
        setElementInitialState(JSON.parse(JSON.stringify(selected)));

        // Multi drag setup: if clicked element is already part of the selection, drag all of them together!
        const isMultiDrag = selectedElementIds.includes(selected.id);
        const dragTargetsList = isMultiDrag ? selectedElementIds : [selected.id];
        const initialStates: { [id: string]: CadElement } = {};
        dragTargetsList.forEach(id => {
          const found = elements.find(el => el.id === id);
          if (found) {
            initialStates[id] = JSON.parse(JSON.stringify(found));
          }
        });
        setDraggedElementsInitialStates(initialStates);
      } else {
        // No element was selected! Start marquee selection dragging
        setIsMarqueeDragging(true);
        setMarqueeStartPos({ x: sx, y: sy });
        setMarqueeEndPos({ x: sx, y: sy });
        onSelectElementIdsChange?.([]);
      }
      return;
    }

    // 3. Curved Line tools or smart path - ALL constructed via our Bezier Pen!
    if (isLineOrPathTool(activeTool)) {
      if (spPoints.length === 0 && selectedElement) {
        const ref = getLineBezierRepresentation(selectedElement);
        if (ref && ref.points.length > 0) {
          const firstPt = ref.points[0];
          const lastPt = ref.points[ref.points.length - 1];
          const sFirst = worldToScreen(firstPt.x, firstPt.y);
          const sLast = worldToScreen(lastPt.x, lastPt.y);
          const distFirst = Math.hypot(sx - sFirst.x, sy - sFirst.y);
          const distLast = Math.hypot(sx - sLast.x, sy - sLast.y);

          if (distFirst < 15) {
            setConnectionStartInfo({ elementId: selectedElement.id, isStart: true });
          } else if (distLast < 15) {
            setConnectionStartInfo({ elementId: selectedElement.id, isStart: false });
          } else {
            setConnectionStartInfo(null);
          }
        } else {
          setConnectionStartInfo(null);
        }
      } else if (spPoints.length === 0) {
        setConnectionStartInfo(null);
      }

      // 3.0 Close path if clicking near first anchor point
      if (spPoints.length >= 2) {
        const firstPt = spPoints[0];
        const screenFirstPt = worldToScreen(firstPt.x, firstPt.y);
        const distScreen = Math.hypot(sx - screenFirstPt.x, sy - screenFirstPt.y);
        if (distScreen < 15) {
          handleCompleteSmartPath(spPoints, spCpLeft, spCpRight);
          setIsClosingPathDrag(false);
          return;
        }
      }
      // 3.1 Cancel curve if clicking the same point again, converting to a straight segment
      if (spPoints.length >= 1) {
        const lastPt = spPoints[spPoints.length - 1];
        const screenLastPt = worldToScreen(lastPt.x, lastPt.y);
        const distScreen = Math.hypot(sx - screenLastPt.x, sy - screenLastPt.y);
        if (distScreen < 15) { // 15px threshold in screen-space
          const updatedCpRight = [...spCpRight];
          updatedCpRight[spPoints.length - 1] = { ...lastPt };
          setSpCpRight(updatedCpRight);
          setSpDraggingIndex(null);
          return;
        }
      }

      const nextPoints = [...spPoints, clickPt];
      let nextCpLeft = [...spCpLeft, { ...clickPt }];
      let nextCpRight = [...spCpRight, { ...clickPt }];

      if (activeTool === 'smart_path') {
        const smoothed = smoothBezierControlPoints(nextPoints);
        nextCpLeft = smoothed.cpLeft;
        nextCpRight = smoothed.cpRight;

        // Restore manually collapsed/straight control points inside smart_path
        for (let idx = 0; idx < spPoints.length; idx++) {
          if (distance(spCpRight[idx], spPoints[idx]) < 0.001) {
            nextCpRight[idx] = { ...spPoints[idx] };
          }
          if (distance(spCpLeft[idx], spPoints[idx]) < 0.001) {
            nextCpLeft[idx] = { ...spPoints[idx] };
          }
        }
      }

      setSpPoints(nextPoints);
      setSpCpLeft(nextCpLeft);
      setSpCpRight(nextCpRight);
      setSpDraggingIndex(activeTool === 'smart_path' ? null : nextPoints.length - 1);
      return;
    }

    // 4. Sketch Circle drafting - Click 1: center, click 2: radius setting
    if (activeTool === 'sketch_circle') {
      if (draftPoints.length === 0) {
        setDraftPoints([clickPt]);
      } else {
        const center = draftPoints[0];
        const r = distance(center, clickPt);
        if (r > 0.1) {
          const circleEl: SketchCircleElement = {
            id: `circle-${Date.now()}`,
            type: 'sketch_circle',
            center,
            radius: r
          };
          onAddElement(circleEl);
          onSelectElement(circleEl);
        }
        setDraftPoints([]);
      }
      return;
    }

    // 4.5. Parking Space drafting - Stamp Mode
    if (activeTool === 'parking_space') {
      const newId = `parking-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const stampAngle = parkingStampConfig?.angle ?? 0;
      const stampLength = parkingStampConfig?.length ?? 5.5;
      const stampWidth = parkingStampConfig?.width ?? 2.5;
      const cos = Math.cos(stampAngle);
      const sin = Math.sin(stampAngle);

      const p1 = {
        x: clickPt.x - (stampLength / 2) * cos + (stampWidth / 2) * sin,
        y: clickPt.y - (stampLength / 2) * sin - (stampWidth / 2) * cos
      };
      const p2 = {
        x: p1.x + cos * stampLength,
        y: p1.y + sin * stampLength
      };

      const parkingEl: CadElement = {
        id: newId,
        type: 'parking_space',
        p1,
        p2,
        slotType: parkingStampConfig?.slotType || 'car',
        width: stampWidth,
        length: stampLength,
        angle: stampAngle
      };

      onAddElement(parkingEl);
      onSelectElement(parkingEl);
      setDraftPoints([]);

      // 立刻啟動旋轉定時器以實現「按下時上下拉旋轉」
      setActiveHandle({ elementId: newId, nodeIndex: 25 });
      rotatingCenterRef.current = clickPt;
      detectionRefPointRef.current = clickPt;
      latestMouseWorldPosRef.current = clickPt;

      if (rotationIntervalRef.current) {
        clearInterval(rotationIntervalRef.current);
      }

      let lastProcessedMousePos: { x: number; y: number } | null = null;
      let isMouseStationary = false;

      rotationIntervalRef.current = setInterval(() => {
        if (!rotatingCenterRef.current || !latestMouseWorldPosRef.current) return;
        
        const curMouse = {
          x: latestMouseWorldPosRef.current.x,
          y: latestMouseWorldPosRef.current.y
        };
        
        const didMouseNotMove = lastProcessedMousePos &&
                                lastProcessedMousePos.x === curMouse.x &&
                                lastProcessedMousePos.y === curMouse.y;
        
        if (didMouseNotMove) {
          isMouseStationary = true;
        } else {
          if (isMouseStationary && lastProcessedMousePos) {
            detectionRefPointRef.current = { ...lastProcessedMousePos };
          }
          isMouseStationary = false;
        }
        
        lastProcessedMousePos = { ...curMouse };
        
        const curElements = latestElementsRef.current;
        const currentPk = curElements.find(item => item.id === newId) as any;
        if (!currentPk) return;
        
        // 旋轉速度與距離成正比的變速計算
        const detPt = detectionRefPointRef.current || rotatingCenterRef.current;
        const d = distance(curMouse, detPt);
        const isUp = curMouse.y > detPt.y;
        
        const baseDelta = (1 * Math.PI) / 180; // 1度/100ms -> 10度/秒
        const speedFactor = Math.max(0.5, d / 3.0);
        const angleDelta = baseDelta * speedFactor;
        
        const currentAngle = currentPk.angle !== undefined 
          ? currentPk.angle 
          : (currentPk.p2 && currentPk.p1 ? Math.atan2(currentPk.p2.y - currentPk.p1.y, currentPk.p2.x - currentPk.p1.x) : 0);
        
        let newAngle = isUp ? (currentAngle + angleDelta) : (currentAngle - angleDelta);
        while (newAngle > Math.PI) newAngle -= 2 * Math.PI;
        while (newAngle < -Math.PI) newAngle += 2 * Math.PI;
        
        const L = currentPk.length || 5.5;
        const W = currentPk.width || 2.5;
        const nextCos = Math.cos(newAngle);
        const nextSin = Math.sin(newAngle);
        
        const newP1 = {
          x: rotatingCenterRef.current.x - (L / 2) * nextCos + (W / 2) * nextSin,
          y: rotatingCenterRef.current.y - (L / 2) * nextSin - (W / 2) * nextCos
        };
        
        const newP2 = {
          x: newP1.x + nextCos * L,
          y: newP1.y + nextSin * L
        };
        
        const updatedPk = {
          ...currentPk,
          angle: newAngle,
          p1: newP1,
          p2: newP2
        };
        
        onUpdateElement(updatedPk);
        
        if (setParkingStampConfig) {
          setParkingStampConfig({
            slotType: currentPk.slotType,
            width: W,
            length: L,
            angle: newAngle
          });
        }
      }, 100);
      return;
    }

    // 4.6. Road Arrow drafting - Stamp Mode
    if (activeTool === 'road_arrow') {
      const newId = `arrow-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const stampType = roadArrowConfig?.arrowType || 'straight';
      const stampLength = roadArrowConfig?.length || 5.0;
      const stampAngle = roadArrowConfig?.angle || 0;

      const arrowEl: CadElement = {
        id: newId,
        type: 'road_arrow',
        p: clickPt,
        arrowType: stampType,
        length: stampLength,
        angle: stampAngle
      };

      onAddElement(arrowEl);
      onSelectElement(arrowEl);
      setDraftPoints([]);

      // 立刻啟動旋轉定時器以實現「按下時上下拉旋轉」
      setActiveHandle({ elementId: newId, nodeIndex: 30 });
      rotatingCenterRef.current = clickPt;
      detectionRefPointRef.current = clickPt;
      latestMouseWorldPosRef.current = clickPt;

      if (rotationIntervalRef.current) {
        clearInterval(rotationIntervalRef.current);
      }

      let lastProcessedMousePos: { x: number; y: number } | null = null;
      let isMouseStationary = false;

      rotationIntervalRef.current = setInterval(() => {
        if (!rotatingCenterRef.current || !latestMouseWorldPosRef.current) return;
        
        const curMouse = {
          x: latestMouseWorldPosRef.current.x,
          y: latestMouseWorldPosRef.current.y
        };
        
        const didMouseNotMove = lastProcessedMousePos &&
                                lastProcessedMousePos.x === curMouse.x &&
                                lastProcessedMousePos.y === curMouse.y;
        
        if (didMouseNotMove) {
          isMouseStationary = true;
        } else {
          if (isMouseStationary && lastProcessedMousePos) {
            detectionRefPointRef.current = { ...lastProcessedMousePos };
          }
          isMouseStationary = false;
        }
        
        lastProcessedMousePos = { ...curMouse };
        
        const curElements = latestElementsRef.current;
        const currentArrow = curElements.find(item => item.id === newId) as any;
        if (!currentArrow) return;
        
        const detPt = detectionRefPointRef.current || rotatingCenterRef.current;
        const d = distance(curMouse, detPt);
        const isUp = curMouse.y > detPt.y;
        
        const baseDelta = (1 * Math.PI) / 180;
        const speedFactor = Math.max(0.5, d / 3.0);
        const angleDelta = baseDelta * speedFactor;
        
        const currentAngle = currentArrow.angle !== undefined ? currentArrow.angle : 0;
        
        let newAngle = isUp ? (currentAngle + angleDelta) : (currentAngle - angleDelta);
        while (newAngle > Math.PI) newAngle -= 2 * Math.PI;
        while (newAngle < -Math.PI) newAngle += 2 * Math.PI;
        
        const updatedArrow = {
          ...currentArrow,
          angle: newAngle
        };
        
        onUpdateElement(updatedArrow);
        
        if (setRoadArrowConfig) {
          setRoadArrowConfig({
            arrowType: stampType,
            length: stampLength,
            angle: newAngle
          });
        }
      }, 100);
      return;
    }

    // 5. Channelization island closed drafting has been moved to Bezier path builder (same as Sidewalk)

    // 5.5. Crosswalk sequential clicks drafting
    if (activeTool === 'crosswalk') {
      if (draftPoints.length === 0) {
        setDraftPoints([clickPt]);
      } else if (draftPoints.length === 1) {
        setDraftPoints([draftPoints[0], clickPt]);
      } else if (draftPoints.length === 2) {
        setDraftPoints([draftPoints[0], draftPoints[1], clickPt]);
      } else if (draftPoints.length === 3) {
        const crosswalkEl: CadElement = {
          id: `crosswalk-${Date.now()}`,
          type: 'crosswalk',
          pA1: draftPoints[0],
          pA2: draftPoints[1],
          pB1: clickPt, // 第四個點
          pB2: draftPoints[2], // 第三個點
          stripeWidth: 0.4,
          stripeGap: 0.4
        };
        onAddElement(crosswalkEl);
        onSelectElement(crosswalkEl);
        setDraftPoints([]);
      }
      return;
    }

    // 6. Text Label Annotation tool: Delay prompt slightly to let pointerDown event cycle release first.
    if (activeTool === 'text_label') {
      e.stopPropagation();
      e.preventDefault();
      
      setTimeout(() => {
        const labelText = prompt('請輸入工程設計備註/標記文字:', '車道安全標線');
        if (labelText && labelText.trim()) {
          const txtEl: CadElement = {
            id: `text-${Date.now()}`,
            type: 'text',
            p: clickPt,
            text: labelText.trim(),
            fontSize: 1.5
          };
          onAddElement(txtEl);
          onSelectElement(txtEl);
        }
      }, 50);
      return;
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);

    if (isDraggingWholePath) {
      setIsDraggingWholePath(false);
      setPathDragStartWorld(null);
      setPathDragStartPoints([]);
    }

    if (appMode === 'simulation') {
      if (setSimIsDragging) setSimIsDragging(false);

      if (simIsIntersectionMode) {
        if (isDraggingRoadA) {
          setIsDraggingRoadA(false);
          if (setSimIntersectionPickState) setSimIntersectionPickState("p3");
        } else if (isDraggingRoadB) {
          setIsDraggingRoadB(false);
          if (setSimIntersectionPickState) setSimIntersectionPickState("none");
          if (setSimDrawMode) setSimDrawMode("select");
        }
        if (activeDragPoint !== "none") {
          setActiveDragPoint("none");
        }
        return;
      }

      if (simIsDraggingFirstVec) {
        if (setSimIsDraggingFirstVec && setSimRawPoints && simFirstVecStart && simFirstVecEnd) {
          setSimIsDraggingFirstVec(false);
          const dx = simFirstVecEnd.x - simFirstVecStart.x;
          const dy = simFirstVecEnd.y - simFirstVecStart.y;
          const heading = Math.hypot(dx, dy) > 4 ? Math.atan2(dy, dx) : 0;
          const len = Math.max(35, Math.hypot(dx, dy));

          const p0: Waypoint = {
            x: simFirstVecStart.x,
            y: simFirstVecStart.y,
            handleIn: { x: -len * Math.cos(heading), y: -len * Math.sin(heading) },
            handleOut: { x: len * Math.cos(heading), y: len * Math.sin(heading) }
          };

          if (simClickStartHeadingRef) simClickStartHeadingRef.current = heading;
          setSimRawPoints([p0]);
        }
        return;
      }

      if (simDrawMode === 'smartpath') {
        if (simDraggingWaypointIndex !== null && setSimDraggingWaypointIndex && setSimDraggingHandleType && setSimRawPoints) {
          const idx = simDraggingWaypointIndex;
          setSimDraggingWaypointIndex(null);
          setSimDraggingHandleType(null);
          setSimRawPoints((prev) => ensureSmoothWaypoint(idx, prev));
        }
        return;
      }

      if (simDrawMode === "drag" && isSimDrawingDragRef.current) {
        isSimDrawingDragRef.current = false;
        if (setSimIsPlaying) setSimIsPlaying(true);
      }

      if (setSimDraggingWaypointIndex && setSimDraggingHandleType) {
        setSimDraggingWaypointIndex(null);
        setSimDraggingHandleType(null);
      }
      return;
    }
    if (rotationIntervalRef.current) {
      clearInterval(rotationIntervalRef.current);
      rotationIntervalRef.current = null;
    }
    setActiveHandle(null);
    setDraggedSmartPathItem(null);
    setDragStartAnchor(null);
    setDragStartRefPoint(null);
    setDraggedCrosswalkItem(null);
    setSpDraggingIndex(null);
    setIsDraggingElement(false);
    setElementDragStartPos(null);
    setElementInitialState(null);
    setIsRotatingElement(false);
    setElementRotateCenter(null);
    setElementInitialStateForRot(null);

    // Reset marquee selection & multi elements states
    setIsMarqueeDragging(false);
    setMarqueeStartPos(null);
    setMarqueeEndPos(null);
    setDraggedElementsInitialStates({});

    if (isClosingPathDrag) {
      setIsClosingPathDrag(false);
      handleCompleteSmartPath(spPoints, spCpLeft, spCpRight);
      return;
    }

    if (activeTool === 'map_scale' && isScalingDrag) {
      setIsScalingDrag(false);
      const stStart = scaleStartPt;
      const stEnd = scaleEndPt;
      const scrStart = scalingStartScreen;
      const scrEnd = scalingEndScreen;

      if (stStart && stEnd && scrStart && scrEnd) {
        const screenDist = Math.hypot(scrEnd.x - scrStart.x, scrEnd.y - scrStart.y);
        if (screenDist > 15.0) {
          // Yes, they dragged standard distance! Trigger calibration!
          setScaleStartPt(null);
          setScaleEndPt(null);
          setScalingStartScreen(null);
          setScalingEndScreen(null);

          setTimeout(() => {
            setCalibrationDialog({ screenDist, rawInput: '' });
          }, 50);
        } else {
          // Simple pointer tap / release. Do NOT reset so click-click can complete!
        }
      } else {
        setScaleStartPt(null);
        setScaleEndPt(null);
        setScalingStartScreen(null);
        setScalingEndScreen(null);
      }
    }
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isLineOrPathTool(activeTool) && spPoints.length >= 2) {
      handleCompleteSmartPath(spPoints, spCpLeft, spCpRight);
    }
  };

  // Zoom standard wheel events
  const handleWheel = (e: React.WheelEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const zoomStep = 1.05;
    const prevZoom = viewport.zoom;
    let nextZoom = e.deltaY < 0 ? prevZoom * zoomStep : prevZoom / zoomStep;
    
    nextZoom = Math.max(1.5, Math.min(220, nextZoom));

    setViewport(prev => {
      const centerX = canvasRef.current!.width / 2;
      const centerY = canvasRef.current!.height / 2;
      
      const wx = (sx - centerX - prev.panX) / prev.zoom;
      const wy = (centerY - sy + prev.panY) / prev.zoom;

      const newPanX = sx - centerX - wx * nextZoom;
      const newPanY = sy - centerY + wy * nextZoom;
      
      return {
        zoom: nextZoom,
        panX: newPanX,
        panY: newPanY
      };
    });
  };

  // CAD 模式下，按 Enter 或 v/V 自動完成標線筆畫
  useEffect(() => {
    const handleCadGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;
      
      if (appMode !== 'simulation' && isLineOrPathTool(activeTool) && spPoints.length >= 2) {
        if (e.key === 'Enter' || (e.key.toLowerCase() === 'v' && !isCmdOrCtrl)) {
          e.preventDefault();
          handleCompleteSmartPath(spPoints, spCpLeft, spCpRight);
        }
      }
    };

    window.addEventListener('keydown', handleCadGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleCadGlobalKeyDown);
  }, [appMode, activeTool, spPoints, spCpLeft, spCpRight]);

  // MASTER CANVAS RENDER LOOP (Triggers whenever viewport, elements, or drafts change)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const isLight = theme === 'light';
    const whiteColor = isLight ? '#1e293b' : '#ffffff';
    const yellowColor = isLight ? '#b45309' : '#f59e0b';
    const yellowDashedColor = isLight ? '#b45309' : '#eab308';
    const primaryLineColor = isLight ? '#1e293b' : '#ffffff';
    const textDrawColor = isLight ? '#0f172a' : '#e2e8f0';

    // Clear Screen
    ctx.fillStyle = isLight ? '#f8fafc' : '#101216';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const { zoom, panX, panY } = viewport;

    // RENDER BACKGROUND IMAGE (IF LOADED)
    if (bgImage && bgImgRef.current) {
      const screenTL = worldToScreen(
        bgImage.x - bgImage.widthMeters / 2,
        bgImage.y + bgImage.heightMeters / 2
      );
      const sW = bgImage.widthMeters * zoom;
      const sH = bgImage.heightMeters * zoom;
      ctx.save();
      ctx.globalAlpha = bgImage.opacity !== undefined ? bgImage.opacity : 0.5;
      ctx.drawImage(bgImgRef.current, screenTL.x, screenTL.y, sW, sH);
      ctx.globalAlpha = 1.0;
      ctx.restore();
    }

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    const shouldShowGrid = showGrid && (!bgImage || bgImage.isCalibrated);

    if (shouldShowGrid) {
      const minXWorld = (-centerX - panX) / zoom;
      const maxXWorld = (canvas.width - centerX - panX) / zoom;
      const minYWorld = (centerY - canvas.height + panY) / zoom;
      const maxYWorld = (centerY + panY) / zoom;

      ctx.lineWidth = 1;
      
      const startX = Math.floor(minXWorld / minorGridInterval) * minorGridInterval;
      const endX = Math.ceil(maxXWorld / minorGridInterval) * minorGridInterval;
      const startY = Math.floor(minYWorld / minorGridInterval) * minorGridInterval;
      const endY = Math.ceil(maxYWorld / minorGridInterval) * minorGridInterval;

      // Minor Grid (dotted slate)
      ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.15)' : '#1a1d24';
      ctx.setLineDash([2, 5]);
      for (let x = startX; x <= endX; x += minorGridInterval) {
        if (x === 0) continue;
        const screenPt = worldToScreen(x, 0);
        ctx.beginPath();
        ctx.moveTo(screenPt.x, 0);
        ctx.lineTo(screenPt.x, canvas.height);
        ctx.stroke();
      }
      for (let y = startY; y <= endY; y += minorGridInterval) {
        if (y === 0) continue;
        const screenPt = worldToScreen(0, y);
        ctx.beginPath();
        ctx.moveTo(0, screenPt.y);
        ctx.lineTo(canvas.width, screenPt.y);
        ctx.stroke();
      }

      // Major Grid & Axes
      ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.35)' : '#292d38';
      ctx.setLineDash([]);
      for (let x = Math.floor(minXWorld / majorGridInterval) * majorGridInterval; x <= maxXWorld; x += majorGridInterval) {
        const screenPt = worldToScreen(x, 0);
        ctx.beginPath();
        ctx.moveTo(screenPt.x, 0);
        ctx.lineTo(screenPt.x, canvas.height);
        ctx.stroke();

        if (zoom > 4) {
          ctx.fillStyle = isLight ? '#64748b' : '#525a6c';
          ctx.font = '8px monospace';
          ctx.fillText(`${x}m`, screenPt.x + 3, canvas.height - 8);
        }
      }
      for (let y = Math.floor(minYWorld / majorGridInterval) * majorGridInterval; y <= maxYWorld; y += majorGridInterval) {
        const screenPt = worldToScreen(0, y);
        ctx.beginPath();
        ctx.moveTo(0, screenPt.y);
        ctx.lineTo(canvas.width, screenPt.y);
        ctx.stroke();

        if (zoom > 4) {
          ctx.fillStyle = isLight ? '#64748b' : '#525a6c';
          ctx.font = '8px monospace';
          ctx.fillText(`${y}m`, 8, screenPt.y - 3);
        }
      }

      // Primary central axes coordinate crosses
      const origin = worldToScreen(0, 0);
      ctx.strokeStyle = isLight ? 'rgba(59, 130, 246, 0.45)' : 'rgba(59, 130, 246, 0.28)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, origin.y); ctx.lineTo(canvas.width, origin.y);
      ctx.moveTo(origin.x, 0); ctx.lineTo(origin.x, canvas.height);
      ctx.stroke();
    }

    // RENDER MAIN GEOMETRIES
    elements.forEach((el) => {
      const isSelected = appMode === 'cad' && (selectedElement?.id === el.id || selectedElementIds.includes(el.id));
      
      if (
        el.type === 'reversible_lane' ||
        el.type === 'bicycle_lane' ||
        el.type === 'guideline' || 
        el.type === 'yellow_double' || 
        el.type === 'white_double' || 
        el.type === 'white_dashed' || 
        el.type === 'yellow_dashed' || 
        el.type === 'white_solid' || 
        el.type === 'BuildingLine' ||
        el.type === 'crossing_dashed' ||
        el.type === 'stop_line' ||
        el.type === 'yield_line' || 
        el.type === 'Sidewalk'
      ) {
        const line = el as any;
        const ref = getLineBezierRepresentation(line);

        if (ref) {
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'miter';
          ctx.setLineDash([]);

          if (el.type === 'guideline') {
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
            ctx.setLineDash([4, 6]);
            ctx.lineWidth = Math.max(1.5, zoom * 0.08);

            const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (el.type === 'yellow_double') {
            ctx.strokeStyle = yellowColor;
            ctx.lineWidth = Math.max(1.5, zoom * 0.1);

            const leftOffset = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0.08, 25);
            const rightOffset = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, -0.08, 25);

            ctx.beginPath();
            leftOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();

            ctx.beginPath();
            rightOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          } else if (el.type === 'white_double') {
            ctx.strokeStyle = primaryLineColor;
            ctx.lineWidth = Math.max(1.5, zoom * 0.1);

            const leftOffset = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0.08, 25);
            const rightOffset = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, -0.08, 25);

            ctx.beginPath();
            leftOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();

            ctx.beginPath();
            rightOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          } else if (el.type === 'white_dashed') {
            const isLeftTurnGuide = (el as any).isLeftTurnGuide;
            ctx.strokeStyle = primaryLineColor;
            if (isLeftTurnGuide) {
              ctx.lineWidth = Math.max(3.0, zoom * 0.3);
              ctx.setLineDash([zoom * 1.0, zoom * 2.0]);
            } else {
              ctx.lineWidth = Math.max(1.5, zoom * 0.1);
              ctx.setLineDash([zoom * 4.0, zoom * 6.0]);
            }

            const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (el.type === 'yellow_dashed') {
            const isLeftTurnGuide = (el as any).isLeftTurnGuide;
            ctx.strokeStyle = yellowDashedColor; // yellow color
            if (isLeftTurnGuide) {
              ctx.lineWidth = Math.max(3.0, zoom * 0.3);
              ctx.setLineDash([zoom * 1.0, zoom * 2.0]);
            } else {
              ctx.lineWidth = Math.max(1.5, zoom * 0.1);
              ctx.setLineDash([zoom * 4.0, zoom * 6.0]);
            }

            const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (el.type === 'white_solid') {
            ctx.strokeStyle = primaryLineColor;
            // Width 15cm
            ctx.lineWidth = Math.max(2, zoom * 0.15);

            const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          } else if (el.type === 'crossing_dashed') {
            // crossing_dashed (30cm wide line, cycle: 1m solid line and 2m gap)
            ctx.strokeStyle = primaryLineColor;
            ctx.lineWidth = Math.max(3.0, zoom * 0.3);
            ctx.setLineDash([zoom * 1.0, zoom * 2.0]);

            const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (el.type === 'stop_line') {
            // stop_line (30cm - 40cm wide white solid, we use 35cm/0.35m)
            ctx.strokeStyle = primaryLineColor;
            ctx.lineWidth = Math.max(3.5, zoom * 0.35);

            const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          } else if (el.type === 'yield_line') {
            // 使用符合台灣交通工程標線法規之讓路線專用繪製邏輯
            drawYieldLineBezier(ctx, ref.points, ref.cpLeft, ref.cpRight, (el as any).sgn ?? 1, zoom, worldToScreen);
          } else if (el.type === 'reversible_lane') {
            // 新增調撥車道線，樣式為雙白虛線
            // 單線寬 10cm (0.1m)，內側間隔 10cm (0.1m) -> 中心間距 20公分 (0.2m) -> 左右各 offset 0.1m
            // 採用標準車道虛線比例（如實線 4m、空白 6m）
            ctx.save();
            ctx.strokeStyle = primaryLineColor;
            ctx.lineWidth = Math.max(1.0, zoom * 0.1); // 線寬 10公分 (0.1m)
            ctx.setLineDash([zoom * 4.0, zoom * 6.0]); // 4米實線, 6米空白

            const leftOffset = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0.1, 25);
            const rightOffset = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, -0.1, 25);

            ctx.beginPath();
            leftOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();

            ctx.beginPath();
            rightOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.restore();
          } else if (el.type === 'bicycle_lane') {
            // 新增腳踏車道(粉紅色)，繪製方法如同車流軌跡，但只留下車流軌跡的底色，點選時出現軌跡，不需要出現腳踏車體。
            const laneWidth = (el as any).width || 1.5;
            const halfW = laneWidth / 2;

            const leftOffset = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, -halfW, 40);
            const rightOffset = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, halfW, 40);

            if (leftOffset.length >= 2 && rightOffset.length >= 2) {
              ctx.save();
              ctx.fillStyle = isSelected ? 'rgba(244, 114, 182, 0.40)' : 'rgba(244, 114, 182, 0.20)'; // pink backdrop fill
              ctx.strokeStyle = '#f472b6'; // pink outer borders
              ctx.lineWidth = Math.max(1.0, zoom * 0.05);

              ctx.beginPath();
              // Left border trace
              leftOffset.forEach((pt, idx) => {
                const s = worldToScreen(pt.x, pt.y);
                if (idx === 0) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.x, s.y);
              });
              // Right border trace back
              for (let i = rightOffset.length - 1; i >= 0; i--) {
                const s = worldToScreen(rightOffset[i].x, rightOffset[i].y);
                ctx.lineTo(s.x, s.y);
              }
              ctx.closePath();
              ctx.fill();
              ctx.stroke();

              // Selected lane path track
              if (isSelected) {
                ctx.strokeStyle = '#ec4899'; // deep pink active path track
                ctx.lineWidth = Math.max(1.5, zoom * 0.04);
                ctx.setLineDash([zoom * 0.2, zoom * 0.3]);

                const centerPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 30);
                ctx.beginPath();
                centerPts.forEach((pt, idx) => {
                  const s = worldToScreen(pt.x, pt.y);
                  if (idx === 0) ctx.moveTo(s.x, s.y);
                  else ctx.lineTo(s.x, s.y);
                });
                ctx.stroke();
              }
              ctx.restore();
            }
          } else if (el.type === 'Sidewalk') {
            // Sidewalk pavement: Solid gray fill + 10cm dark border envelope
            const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 30);
            if (segPts.length >= 2) {
              ctx.save();
              ctx.fillStyle = isLight ? '#cbd5e1' : '#A9A9A9'; // Engineering gray pavement fill
              ctx.strokeStyle = isLight ? '#475569' : '#1e293b'; // 10cm dark gray border
              ctx.lineWidth = Math.max(1.5, zoom * 0.1); // 10cm border

              ctx.beginPath();
              segPts.forEach((pt, idx) => {
                const s = worldToScreen(pt.x, pt.y);
                if (idx === 0) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.x, s.y);
              });
              
              // Close the sidewalk polygon back to start
              const startS = worldToScreen(segPts[0].x, segPts[0].y);
              ctx.lineTo(startS.x, startS.y);
              ctx.closePath();

              // Fill pavement
              ctx.fill();
              
              // Draw outer border
              ctx.stroke();
              ctx.restore();
            }
          } else if (el.type === 'BuildingLine') {
            ctx.strokeStyle = isLight ? '#0891b2' : '#00ffff';
            ctx.lineWidth = 2.5;

            const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          }

          // Render anchors and symmetric guidelines if selected!
          if (isSelected) {
            ref.points.forEach((pt, j) => {
              const ptS = worldToScreen(pt.x, pt.y);

              if (ref.cpLeft[j] && ref.cpRight[j]) {
                ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)';
                ctx.lineWidth = 1;
                const cpLeftS = worldToScreen(ref.cpLeft[j].x, ref.cpLeft[j].y);
                const cpRightS = worldToScreen(ref.cpRight[j].x, ref.cpRight[j].y);

                ctx.beginPath();
                ctx.moveTo(cpLeftS.x, cpLeftS.y);
                ctx.lineTo(cpRightS.x, cpRightS.y);
                ctx.stroke();

                ctx.fillStyle = '#a855f7'; // Purple handles
                ctx.beginPath();
                ctx.arc(cpLeftS.x, cpLeftS.y, 3.5, 0, 2 * Math.PI);
                ctx.arc(cpRightS.x, cpRightS.y, 3.5, 0, 2 * Math.PI);
                ctx.fill();
              }

              const isAnchorSelected = selectedAnchorIndices?.includes(j);
              ctx.fillStyle = isAnchorSelected ? '#10b981' : '#06b6d4'; // Emerald green if selected, cyan if regular
              ctx.strokeStyle = whiteColor;
              ctx.lineWidth = isAnchorSelected ? 2.5 : 1.5;
              ctx.beginPath();
              const size = isAnchorSelected ? 12 : 9;
              ctx.rect(ptS.x - size / 2, ptS.y - size / 2, size, size);
              ctx.fill();
              ctx.stroke();
            });
          }
        }
      } else if (el.type === 'sketch_circle') {
        const circ = el as any;
        const sCenter = worldToScreen(circ.center.x, circ.center.y);
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.35)'; // Blue translucent
        ctx.lineWidth = Math.max(1.5, zoom * 0.08);
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(sCenter.x, sCenter.y, circ.radius * zoom, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);

        // Little dynamic center cursor
        ctx.strokeStyle = 'rgba(14, 165, 233, 0.55)';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(sCenter.x - 6, sCenter.y); ctx.lineTo(sCenter.x + 6, sCenter.y);
        ctx.moveTo(sCenter.x, sCenter.y - 6); ctx.lineTo(sCenter.x, sCenter.y + 6);
        ctx.stroke();

        // Render controls if selected
        if (isSelected) {
          ctx.beginPath();
          ctx.fillStyle = '#0e7490';
          ctx.strokeStyle = whiteColor;
          ctx.lineWidth = 1.5;
          ctx.arc(sCenter.x, sCenter.y, 4, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();

          // Perimeter handle point
          const perimPt = worldToScreen(circ.center.x + circ.radius, circ.center.y);
          ctx.fillStyle = '#a855f7';
          ctx.beginPath();
          ctx.rect(perimPt.x - 5, perimPt.y - 5, 10, 10);
          ctx.fill();
          ctx.stroke();
        }
      } else if (el.type === 'three_center_curve') {
        const curve = el as ThreeCenterCurveElement;
        
        if (isSelected) {
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
          ctx.setLineDash([2, 3]);
          const pvS = worldToScreen(curve.pIntersection.x, curve.pIntersection.y);
          const psS = worldToScreen(curve.pStart.x, curve.pStart.y);
          const peS = worldToScreen(curve.pEnd.x, curve.pEnd.y);
          ctx.beginPath();
          ctx.moveTo(psS.x, psS.y); ctx.lineTo(pvS.x, pvS.y); ctx.lineTo(peS.x, peS.y);
          ctx.stroke();
          ctx.setLineDash([]);
          
          const O1s = worldToScreen(curve.O1.x, curve.O1.y);
          const O2s = worldToScreen(curve.O2.x, curve.O2.y);
          const O3s = worldToScreen(curve.O3.x, curve.O3.y);
          ctx.fillStyle = '#ec4899';
          ctx.beginPath();
          ctx.arc(O1s.x, O1s.y, 4, 0, 2*Math.PI);
          ctx.arc(O2s.x, O2s.y, 4, 0, 2*Math.PI);
          ctx.arc(O3s.x, O3s.y, 4, 0, 2*Math.PI);
          ctx.fill();
        }

        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = Math.max(2, zoom * 0.15);
        ctx.lineCap = 'butt';
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        for (let i = 0; i < curve.points.length; i++) {
          const sPt = worldToScreen(curve.points[i].x, curve.points[i].y);
          if (i === 0) ctx.moveTo(sPt.x, sPt.y);
          else ctx.lineTo(sPt.x, sPt.y);
        }
        ctx.stroke();

        const t1s = worldToScreen(curve.T1.x, curve.T1.y);
        const t2s = worldToScreen(curve.T2.x, curve.T2.y);
        const c12s = worldToScreen(curve.C12.x, curve.C12.y);
        const c23s = worldToScreen(curve.C23.x, curve.C23.y);

        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(t1s.x, t1s.y, 3, 0, 2*Math.PI);
        ctx.arc(t2s.x, t2s.y, 3, 0, 2*Math.PI);
        ctx.arc(c12s.x, c12s.y, 3, 0, 2*Math.PI);
        ctx.arc(c23s.x, c23s.y, 3, 0, 2*Math.PI);
        ctx.fill();
      } else if (el.type === 'island') {
        const island = el as any;
        
        const hasBezier = island.cpLeft && island.cpRight && island.cpLeft.length === island.points.length;
        const boundaryPoints = hasBezier 
          ? sampleClosedBezierLoop(island.points, island.cpLeft, island.cpRight, 20)
          : island.points;

        ctx.beginPath();
        boundaryPoints.forEach((pt: Point2D, idx: number) => {
          const s = worldToScreen(pt.x, pt.y);
          if (idx === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
        
        ctx.fillStyle = isLight ? 'rgba(30, 41, 59, 0.12)' : 'rgba(15, 23, 42, 0.55)';
        ctx.fill();

        ctx.strokeStyle = (island.color || whiteColor);
        ctx.lineWidth = Math.max(1.5, zoom * 0.1);
        ctx.stroke();

        if (island.hasHatching && boundaryPoints.length >= 3) {
          const hatching = generateHatchingLines(boundaryPoints, 0.45, 45);
          
          ctx.strokeStyle = island.color || (isLight ? 'rgba(30, 41, 59, 0.75)' : 'rgba(255, 255, 255, 0.75)');
          ctx.lineWidth = Math.max(1.5, zoom * 0.12);
          ctx.beginPath();
          hatching.forEach((line) => {
            const s1 = worldToScreen(line.p1.x, line.p1.y);
            const s2 = worldToScreen(line.p2.x, line.p2.y);
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
          });
          ctx.stroke();
        }

        if (isSelected) {
          const ref = getLineBezierRepresentation(island);
          if (ref) {
            ref.points.forEach((pt: Point2D, j: number) => {
              const ptS = worldToScreen(pt.x, pt.y);

              if (ref.cpLeft[j] && ref.cpRight[j]) {
                ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)';
                ctx.lineWidth = 1;
                const cpLeftS = worldToScreen(ref.cpLeft[j].x, ref.cpLeft[j].y);
                const cpRightS = worldToScreen(ref.cpRight[j].x, ref.cpRight[j].y);

                ctx.beginPath();
                ctx.moveTo(cpLeftS.x, cpLeftS.y);
                ctx.lineTo(cpRightS.x, cpRightS.y);
                ctx.stroke();

                ctx.fillStyle = '#a855f7'; // Purple handles
                ctx.beginPath();
                ctx.arc(cpLeftS.x, cpLeftS.y, 3.5, 0, 2 * Math.PI);
                ctx.arc(cpRightS.x, cpRightS.y, 3.5, 0, 2 * Math.PI);
                ctx.fill();
              }

              const isAnchorSelected = selectedAnchorIndices?.includes(j);
              ctx.fillStyle = isAnchorSelected ? '#10b981' : '#06b6d4'; // Emerald green if selected, cyan if regular
              ctx.strokeStyle = whiteColor;
              ctx.lineWidth = isAnchorSelected ? 2.5 : 1.5;
              ctx.beginPath();
              const size = isAnchorSelected ? 12 : 9;
              ctx.rect(ptS.x - size / 2, ptS.y - size / 2, size, size);
              ctx.fill();
              ctx.stroke();
            });
          }
        }
      } else if (el.type === 'text') {
        const txt = el as TextElement;
        const screenPt = worldToScreen(txt.p.x, txt.p.y);
        ctx.fillStyle = textDrawColor;
        const pxFontSize = Math.max(9, txt.fontSize * zoom);
        
        ctx.font = `${pxFontSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt.text, screenPt.x, screenPt.y);

        if (isSelected) {
          const boxw = ctx.measureText(txt.text).width + 12;
          const boxh = pxFontSize + 8;
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(screenPt.x - boxw/2, screenPt.y - boxh/2, boxw, boxh);
          ctx.stroke();
        }
      } else if (el.type === 'smart_path') {
        const sp = el as any;
        const isSelected = appMode === 'cad' && (selectedElement?.id === el.id || selectedElementIds.includes(el.id));

        // 1. Generate the vehicle swept path to show bottom ribbon color ALWAYS
        const tempPts: Point2D[] = [];
        if (sp.points && sp.points.length > 1) {
          for (let jj = 0; jj < sp.points.length - 1; jj++) {
            const pStart = sp.points[jj];
            const cpStart = sp.cpRight[jj] || pStart;
            const cpEnd = sp.cpLeft[jj + 1] || sp.points[jj + 1];
            const pEnd = sp.points[jj + 1];
            const samples = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 20);
            tempPts.push(...samples);
          }
        }

        if (tempPts.length >= 2) {
          const pathVehicle = sp.designVehicle || designVehicle;
          const swept = generateVehicleSweptPath(tempPts, pathVehicle);
          const allQuads = [...swept.tractorEnvelopes, ...(swept.trailerEnvelopes || [])];

          // Draw the backdrop bottom background fill color (Deselected is soft, Selected is brighter)
          ctx.fillStyle = isSelected ? 'rgba(6, 182, 212, 0.35)' : 'rgba(6, 182, 212, 0.20)';
          ctx.beginPath();
          allQuads.forEach(quad => {
            const s1 = worldToScreen(quad.p1.x, quad.p1.y);
            const s2 = worldToScreen(quad.p2.x, quad.p2.y);
            const s3 = worldToScreen(quad.p3.x, quad.p3.y);
            const s4 = worldToScreen(quad.p4.x, quad.p4.y);
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
            ctx.lineTo(s3.x, s3.y);
            ctx.lineTo(s4.x, s4.y);
          });
          ctx.closePath();
          ctx.fill();

          // Only if selected, draw track boundaries and vehicle bodies (ghost elements)
          if (isSelected) {
            // Left & Right ribbon borders
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = 1;
            
            ctx.beginPath();
            swept.leftRibbon.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();

            ctx.beginPath();
            swept.rightRibbon.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();

            // Draw ghost vehicles along intervals
            const idxs = [0, Math.floor(allQuads.length / 2), allQuads.length - 1].filter(x => x >= 0 && x < allQuads.length);
            idxs.forEach((idx) => {
              const q = allQuads[idx];
              const s1 = worldToScreen(q.p1.x, q.p1.y);
              const s2 = worldToScreen(q.p2.x, q.p2.y);
              const s3 = worldToScreen(q.p3.x, q.p3.y);
              const s4 = worldToScreen(q.p4.x, q.p4.y);

              ctx.fillStyle = 'rgba(6, 182, 212, 0.16)';
              ctx.strokeStyle = '#67e8f9';
              ctx.lineWidth = 1.6;

              ctx.beginPath();
              ctx.moveTo(s1.x, s1.y);
              ctx.lineTo(s2.x, s2.y);
              ctx.lineTo(s3.x, s3.y);
              ctx.lineTo(s4.x, s4.y);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();

              // Draw wheel caps
              ctx.fillStyle = '#1e293b';
              ctx.beginPath();
              ctx.arc(s3.x, s3.y, 3.2, 0, 2 * Math.PI);
              ctx.arc(s4.x, s4.y, 3.2, 0, 2 * Math.PI);
              ctx.fill();
            });
          }
        }

        // Draw track center curve ONLY when selected
        if (isSelected) {
          const wholePath: Point2D[] = [];
          for (let j = 0; j < sp.points.length - 1; j++) {
            const pStart = sp.points[j];
            const cpStart = sp.cpRight[j];
            const cpEnd = sp.cpLeft[j + 1];
            const pEnd = sp.points[j + 1];
            const bPts = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 30);
            if (j === 0) {
              wholePath.push(...bPts);
            } else {
              wholePath.push(...bPts.slice(1));
            }
          }

          const pathVehicle = sp.designVehicle || designVehicle;
          const wheelbase = getWheelbaseForVehicle(pathVehicle);

          ctx.lineWidth = Math.max(3, zoom * 0.2);
          for (let k = 1; k < wholePath.length - 1; k++) {
            const pPrev = wholePath[k - 1];
            const pCurr = wholePath[k];
            const pNext = wholePath[k + 1];

            const angle = calculateSteeringAngle(pPrev, pCurr, pNext, wheelbase);
            ctx.strokeStyle = angle > 40 ? '#ef4444' : '#06b6d4'; // Red vs Cyan
            ctx.beginPath();
            const s1 = worldToScreen(pCurr.x, pCurr.y);
            const s2 = worldToScreen(pNext.x, pNext.y);
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
            ctx.stroke();
          }
        }

        // Draw handles and nodes if selected
        if (isSelected) {
          sp.points.forEach((pt: Point2D, j: number) => {
            const ptS = worldToScreen(pt.x, pt.y);

            ctx.strokeStyle = 'rgba(168, 85, 247, 0.55)'; // Purple handle line
            ctx.lineWidth = 1;
            const cpLeftS = worldToScreen(sp.cpLeft[j].x, sp.cpLeft[j].y);
            const cpRightS = worldToScreen(sp.cpRight[j].x, sp.cpRight[j].y);

            ctx.beginPath();
            ctx.moveTo(cpLeftS.x, cpLeftS.y);
            ctx.lineTo(cpRightS.x, cpRightS.y);
            ctx.stroke();

            ctx.fillStyle = '#a855f7'; // purple handles
            ctx.beginPath();
            ctx.arc(cpLeftS.x, cpLeftS.y, 3.5, 0, 2 * Math.PI);
            ctx.arc(cpRightS.x, cpRightS.y, 3.5, 0, 2 * Math.PI);
            ctx.fill();

            const isAnchorSelected = selectedAnchorIndices?.includes(j);
            ctx.fillStyle = isAnchorSelected ? '#10b981' : '#06b6d4'; // Emerald green if selected, cyan if regular
            ctx.strokeStyle = whiteColor;
            ctx.lineWidth = isAnchorSelected ? 2.5 : 1.5;
            ctx.beginPath();
            const size = isAnchorSelected ? 12 : 9;
            ctx.rect(ptS.x - size / 2, ptS.y - size / 2, size, size);
            ctx.fill();
            ctx.stroke();
          });
        }
      } else if (el.type === 'crosswalk') {
        const cw = el as any;
        const stripeWidth = cw.stripeWidth ?? 0.4;
        const stripeGap = cw.stripeGap ?? 0.4;
        const stripes = generateCrosswalkStripes(cw.pA1, cw.pA2, cw.pB1, cw.pB2, stripeWidth, stripeGap);

        // Render crosswalk white pillow stripes
        ctx.fillStyle = isLight ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.95)';
        
        stripes.forEach((stripe) => {
          ctx.beginPath();
          const s1 = worldToScreen(stripe.p1.x, stripe.p1.y);
          const s2 = worldToScreen(stripe.p2.x, stripe.p2.y);
          const s3 = worldToScreen(stripe.p3.x, stripe.p3.y);
          const s4 = worldToScreen(stripe.p4.x, stripe.p4.y);

          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.lineTo(s3.x, s3.y);
          ctx.lineTo(s4.x, s4.y);
          ctx.closePath();
          ctx.fill();
        });

        // Handle overlay markings when selected
        if (isSelected) {
          ctx.strokeStyle = '#64748b';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);

          const sA1 = worldToScreen(cw.pA1.x, cw.pA1.y);
          const sA2 = worldToScreen(cw.pA2.x, cw.pA2.y);
          const sB1 = worldToScreen(cw.pB1.x, cw.pB1.y);
          const sB2 = worldToScreen(cw.pB2.x, cw.pB2.y);

          ctx.beginPath();
          ctx.moveTo(sA1.x, sA1.y);
          ctx.lineTo(sA2.x, sA2.y);
          ctx.lineTo(sB2.x, sB2.y);
          ctx.lineTo(sB1.x, sB1.y);
          ctx.closePath();
          ctx.stroke();
          ctx.setLineDash([]);
        }
      } else if (el.type === 'parking_space') {
        const pk = el as any;
        const L = pk.length || 5.0;
        const W = pk.width || 2.0;
        const angle = pk.angle !== undefined ? pk.angle : Math.atan2(pk.p2.y - pk.p1.y, pk.p2.x - pk.p1.x);

        const s1 = worldToScreen(pk.p1.x, pk.p1.y);

        ctx.save();
        ctx.translate(s1.x, s1.y);
        ctx.rotate(-angle);

        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = whiteColor;
        ctx.lineWidth = Math.max(1.5, zoom * 0.1); // 10cm standard paint lines
        ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.22)' : (isLight ? 'rgba(30, 41, 59, 0.05)' : 'rgba(255, 255, 255, 0.05)');

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(L * zoom, 0);
        ctx.lineTo(L * zoom, -W * zoom);
        ctx.lineTo(0, -W * zoom);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (pk.showSizeLabel !== false && zoom > 7) {
          ctx.fillStyle = isSelected ? '#38bdf8' : (isLight ? 'rgba(30, 41, 59, 0.65)' : 'rgba(255, 255, 255, 0.55)');
          ctx.font = '9px JetBrains Mono, monospace, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${pk.slotType === 'car' ? '汽車' : '機車'} ${W}x${L}m`, (L / 2) * zoom, -(W / 2) * zoom);
        }
        ctx.restore();

        // Draw handles in world space - Single Center Rotation Handle
        if (isSelected) {
          const center = getParkingSpaceCenter(pk);
          const hs = worldToScreen(center.x, center.y);
          ctx.fillStyle = '#38bdf8'; // Sky blue handle
          ctx.strokeStyle = whiteColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hs.x, hs.y, 6.5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        }
      } else if (el.type === 'road_arrow') {
        const arrow = el as any;
        const pts = getRoadArrowOutlinePoints(arrow);
        if (pts.length > 0) {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          
          ctx.strokeStyle = isSelected ? '#38bdf8' : whiteColor;
          ctx.lineWidth = isSelected ? Math.max(2, zoom * 0.08) : Math.max(1, zoom * 0.03);
          ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.25)' : whiteColor;

          ctx.beginPath();
          const pStart = worldToScreen(pts[0].x, pts[0].y);
          ctx.moveTo(pStart.x, pStart.y);
          for (let i = 1; i < pts.length; i++) {
            const p = worldToScreen(pts[i].x, pts[i].y);
            ctx.lineTo(p.x, p.y);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();

          if (isSelected) {
            const hs = worldToScreen(arrow.p.x, arrow.p.y);
            ctx.fillStyle = '#a855f7'; // purple lever
            ctx.strokeStyle = whiteColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(hs.x, hs.y, 6.5, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
          }
        }
      } else if (el.type === 'parking_zone') {
        const zone = el as any;
        const ref = getLineBezierRepresentation(zone);
        if (ref) {
          ctx.save();
          ctx.strokeStyle = isSelected ? 'rgba(56, 189, 248, 0.4)' : (isLight ? 'rgba(30, 41, 59, 0.15)' : 'rgba(255, 255, 255, 0.15)');
          ctx.lineWidth = 1.0;
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
          segPts.forEach((pt, j) => {
            const s = worldToScreen(pt.x, pt.y);
            if (j === 0) ctx.moveTo(s.x, s.y);
            else ctx.lineTo(s.x, s.y);
          });
          ctx.stroke();
          ctx.restore();
        }

        const slots = generateParkingZoneSlots(zone);
        slots.forEach((slot) => {
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = whiteColor;
          ctx.lineWidth = Math.max(1.5, zoom * 0.1);
          ctx.fillStyle = isSelected ? 'rgba(56, 189, 248, 0.22)' : (isLight ? 'rgba(30, 41, 59, 0.05)' : 'rgba(255, 255, 255, 0.05)');

          const s1 = worldToScreen(slot.corners[0].x, slot.corners[0].y);
          const s2 = worldToScreen(slot.corners[1].x, slot.corners[1].y);
          const s3 = worldToScreen(slot.corners[2].x, slot.corners[2].y);
          const s4 = worldToScreen(slot.corners[3].x, slot.corners[3].y);

          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.lineTo(s3.x, s3.y);
          ctx.lineTo(s4.x, s4.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          if ((el as any).showSizeLabel !== false && zoom > 7) {
            ctx.fillStyle = isSelected ? '#38bdf8' : (isLight ? 'rgba(30, 41, 59, 0.65)' : 'rgba(255, 255, 255, 0.55)');
            ctx.font = '9px JetBrains Mono, monospace, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const cx = (s1.x + s2.x + s3.x + s4.x) / 4;
            const cy = (s1.y + s2.y + s3.y + s4.y) / 4;
            ctx.fillText(`${slot.slotType === 'car' ? '汽車' : '機車'} ${slot.width}x${slot.length}m`, cx, cy);
          }
          ctx.restore();
        });
      }
    });

    // Stamp Preview for parking_space
    if (activeTool === 'parking_space' && draftPoints.length === 0) {
      const p1 = mouseWorld;
      const stampAngle = parkingStampConfig?.angle ?? 0;
      const stampLength = parkingStampConfig?.length ?? 5.5;
      const stampWidth = parkingStampConfig?.width ?? 2.5;

      ctx.save();
      const s1 = worldToScreen(p1.x, p1.y);
      ctx.translate(s1.x, s1.y);
      ctx.rotate(-stampAngle);
      ctx.translate(-(stampLength / 2) * zoom, (stampWidth / 2) * zoom);

      ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      ctx.lineWidth = Math.max(1.5, zoom * 0.1);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
      ctx.setLineDash([4, 4]);

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(stampLength * zoom, 0);
      ctx.lineTo(stampLength * zoom, -stampWidth * zoom);
      ctx.lineTo(0, -stampWidth * zoom);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.restore();
    }

    // Stamp Preview for road_arrow
    if (activeTool === 'road_arrow' && draftPoints.length === 0) {
      const stampType = roadArrowConfig?.arrowType || 'straight';
      const stampLength = roadArrowConfig?.length || 5.0;
      const stampAngle = roadArrowConfig?.angle || 0;

      const tempArrow = {
        p: mouseWorld,
        arrowType: stampType,
        length: stampLength,
        angle: stampAngle
      };

      const pts = getRoadArrowOutlinePoints(tempArrow);
      if (pts.length > 0) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
        ctx.lineWidth = Math.max(1.5, zoom * 0.05);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
        ctx.setLineDash([4, 4]);

        ctx.beginPath();
        const pStart = worldToScreen(pts[0].x, pts[0].y);
        ctx.moveTo(pStart.x, pStart.y);
        for (let i = 1; i < pts.length; i++) {
          const p = worldToScreen(pts[i].x, pts[i].y);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // DRAW INTERACTIVE DRAFT TEMPORARY GRAPHICS
    if (draftPoints.length > 0) {
      ctx.setLineDash([4, 4]);

      if (activeTool === 'sketch_circle') {
        if (draftPoints.length === 1) {
          const sCenter = worldToScreen(draftPoints[0].x, draftPoints[0].y);
          const r = distance(draftPoints[0], mouseWorld);
          ctx.strokeStyle = 'rgba(14, 165, 233, 0.55)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sCenter.x, sCenter.y, r * zoom, 0, 2 * Math.PI);
          ctx.stroke();
        }
      } else if (activeTool === 'parking_space') {
        if (draftPoints.length === 1) {
          const p1 = draftPoints[0];
          const dx = mouseWorld.x - p1.x;
          const dy = mouseWorld.y - p1.y;
          const len = Math.hypot(dx, dy);
          const ux = len > 0.0001 ? dx / len : 1;
          const uy = len > 0.0001 ? dy / len : 0;
          const vx = -uy;
          const vy = ux;

          const L = 5.0; // default length
          const W = 2.0; // default width

          const c1 = p1;
          const c2 = { x: p1.x + ux * L, y: p1.y + uy * L };
          const c3 = { x: p1.x + ux * L + vx * W, y: p1.y + uy * L + vy * W };
          const c4 = { x: p1.x + vx * W, y: p1.y + vy * W };

          const s1 = worldToScreen(c1.x, c1.y);
          const s2 = worldToScreen(c2.x, c2.y);
          const s3 = worldToScreen(c3.x, c3.y);
          const s4 = worldToScreen(c4.x, c4.y);

          ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
          ctx.lineWidth = Math.max(1.5, zoom * 0.1);
          ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';

          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.lineTo(s3.x, s3.y);
          ctx.lineTo(s4.x, s4.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Connect p1 to cursor as helper axis line
          const sMouse = worldToScreen(mouseWorld.x, mouseWorld.y);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(sMouse.x, sMouse.y);
          ctx.stroke();
        }
      } else if (activeTool === 'crosswalk') {
        ctx.strokeStyle = '#34d399'; // Emerald outlines
        ctx.lineWidth = 1.5;

        const sA1 = draftPoints[0] ? worldToScreen(draftPoints[0].x, draftPoints[0].y) : null;
        const sA2 = draftPoints[1] ? worldToScreen(draftPoints[1].x, draftPoints[1].y) : null;
        const sB1 = draftPoints[2] ? worldToScreen(draftPoints[2].x, draftPoints[2].y) : null;
        const sMouse = worldToScreen(mouseWorld.x, mouseWorld.y);

        if (draftPoints.length === 1 && sA1) {
          // Drawing Line A (from A1 to Mouse)
          ctx.beginPath();
          ctx.moveTo(sA1.x, sA1.y);
          ctx.lineTo(sMouse.x, sMouse.y);
          ctx.stroke();

          // Green start anchor
          ctx.fillStyle = '#10b981';
          ctx.fillRect(sA1.x - 4, sA1.y - 4, 8, 8);
        } else if (draftPoints.length === 2 && sA1 && sA2) {
          // Line A is fixed. From A2, drawing to click B1
          ctx.beginPath();
          ctx.moveTo(sA1.x, sA1.y);
          ctx.lineTo(sA2.x, sA2.y);
          ctx.stroke();

          ctx.strokeStyle = 'rgba(52, 211, 153, 0.45)';
          ctx.beginPath();
          ctx.moveTo(sA2.x, sA2.y);
          ctx.lineTo(sMouse.x, sMouse.y);
          ctx.stroke();

          ctx.fillStyle = '#10b981';
          ctx.fillRect(sA1.x - 4, sA1.y - 4, 8, 8);
          ctx.fillRect(sA2.x - 4, sA2.y - 4, 8, 8);
        } else if (draftPoints.length === 3 && sA1 && sA2 && sB1) {
          // Line A fixed, B1 fixed, drawing to click B2
          ctx.beginPath();
          ctx.moveTo(sA1.x, sA1.y);
          ctx.lineTo(sA2.x, sA2.y);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(sB1.x, sB1.y);
          ctx.lineTo(sMouse.x, sMouse.y);
          ctx.stroke();

          // envelope edges
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.4)'; // amber translucency
          ctx.beginPath();
          ctx.moveTo(sA1.x, sA1.y);
          ctx.lineTo(sB1.x, sB1.y);
          ctx.moveTo(sA2.x, sA2.y);
          ctx.lineTo(sMouse.x, sMouse.y);
          ctx.stroke();

          // Generate translucent preview stripes!
          const tempStripes = generateCrosswalkStripes(draftPoints[0], draftPoints[1], mouseWorld, draftPoints[2], 0.4, 0.4);
          ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
          tempStripes.forEach((stripe) => {
            const st1 = worldToScreen(stripe.p1.x, stripe.p1.y);
            const st2 = worldToScreen(stripe.p2.x, stripe.p2.y);
            const st3 = worldToScreen(stripe.p3.x, stripe.p3.y);
            const st4 = worldToScreen(stripe.p4.x, stripe.p4.y);
            ctx.beginPath();
            ctx.moveTo(st1.x, st1.y);
            ctx.lineTo(st2.x, st2.y);
            ctx.lineTo(st3.x, st3.y);
            ctx.lineTo(st4.x, st4.y);
            ctx.closePath();
            ctx.fill();
          });

          ctx.fillStyle = '#10b981';
          ctx.fillRect(sA1.x - 4, sA1.y - 4, 8, 8);
          ctx.fillRect(sA2.x - 4, sA2.y - 4, 8, 8);
          ctx.fillStyle = '#3b82f6';
          ctx.fillRect(sB1.x - 4, sB1.y - 4, 8, 8);
        }
      }
      ctx.setLineDash([]);
    }

    // 繪製已選取物件的所有節點以供接續吸附 (高亮)
    if (selectedElement && isLineOrPathTool(activeTool)) {
      const ref = getLineBezierRepresentation(selectedElement);
      if (ref) {
        ref.points.forEach((pt: Point2D, idx: number) => {
          const sPt = worldToScreen(pt.x, pt.y);
          const isEndpoint = (idx === 0 || idx === ref.points.length - 1);
          
          ctx.save();
          ctx.shadowBlur = 10;
          ctx.shadowColor = isEndpoint ? '#22c55e' : '#3b82f6';
          ctx.fillStyle = isEndpoint ? '#22c55e' : '#3b82f6';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sPt.x, sPt.y, isEndpoint ? 6 : 4.5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        });
      }
    }

    // DRAW ACTIVE BEZIER PEN CURVE DRAFTS (shared by guideline, yellow_double, white_dashed, white_solid, and smart_path!)
    if (isLineOrPathTool(activeTool) && spPoints.length > 0) {
      ctx.lineWidth = Math.max(2, zoom * 0.15);
      
      const lastPtS = worldToScreen(spPoints[spPoints.length - 1].x, spPoints[spPoints.length - 1].y);
      const mS = worldToScreen(mouseWorld.x, mouseWorld.y);

      // Special Dynamic Pavement Enclosure preview for Sidewalk & channelization tool
      if (activeTool === 'Sidewalk' || activeTool === 'channelization') {
        const allPts: Point2D[] = [];
        for (let j = 0; j < spPoints.length - 1; j++) {
          const pStart = spPoints[j];
          const cpStart = spCpRight[j];
          const cpEnd = spCpLeft[j + 1];
          const pEnd = spPoints[j + 1];
          const bPts = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 15);
          allPts.push(...bPts);
        }
        if (allPts.length === 0 && spPoints.length > 0) {
          allPts.push(spPoints[0]);
        }
        allPts.push(mouseWorld);

        ctx.save();
        ctx.fillStyle = activeTool === 'channelization'
          ? 'rgba(15, 23, 42, 0.45)' // Channelizing darker area
          : 'rgba(169, 169, 169, 0.25)'; // translucent grey pavement (#A9A9A9)
        ctx.beginPath();
        allPts.forEach((pt, idx) => {
          const s = worldToScreen(pt.x, pt.y);
          if (idx === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
        ctx.fill();

        // Connect back to start via helper pink dashed closing stroke
        ctx.strokeStyle = 'rgba(236, 72, 153, 0.45)';
        ctx.setLineDash([2, 3]);
        const firstPtS = worldToScreen(spPoints[0].x, spPoints[0].y);
        ctx.beginPath();
        ctx.moveTo(mS.x, mS.y);
        ctx.lineTo(firstPtS.x, firstPtS.y);
        ctx.stroke();
        ctx.restore();
      }

      // Temporary dashed connector to cursor (only for smart_path and pavement tools)
      const isSmartPath = activeTool === 'smart_path';
      const isPavement = activeTool === 'Sidewalk' || activeTool === 'channelization';
      if (isSmartPath || isPavement) {
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.4)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(lastPtS.x, lastPtS.y);
        ctx.lineTo(mS.x, mS.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw all current Bezier segments
      if (activeTool === 'smart_path') {
        const wholeActivePath: Point2D[] = [];
        for (let j = 0; j < spPoints.length - 1; j++) {
          const pStart = spPoints[j];
          const cpStart = spCpRight[j];
          const cpEnd = spCpLeft[j + 1];
          const pEnd = spPoints[j + 1];
          const bPts = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 30);
          if (j === 0) {
            wholeActivePath.push(...bPts);
          } else {
            wholeActivePath.push(...bPts.slice(1));
          }
        }

        const wheelbase = getWheelbaseForVehicle(designVehicle);
        ctx.lineWidth = Math.max(3, zoom * 0.2);
        for (let k = 1; k < wholeActivePath.length - 1; k++) {
          const pPrev = wholeActivePath[k - 1];
          const pCurr = wholeActivePath[k];
          const pNext = wholeActivePath[k + 1];

          const angle = calculateSteeringAngle(pPrev, pCurr, pNext, wheelbase);
          ctx.strokeStyle = angle > 40 ? '#ef4444' : '#06b6d4'; // Red vs Cyan
          ctx.beginPath();
          const s1 = worldToScreen(pCurr.x, pCurr.y);
          const s2 = worldToScreen(pNext.x, pNext.y);
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.stroke();
        }
      } else if (activeTool !== 'Sidewalk' && activeTool !== 'channelization') {
        // 構造預覽點陣列（整合已點點與滑鼠點/閉合點）
        const previewPoints = [...spPoints];
        const previewCpLeft = [...spCpLeft];
        const previewCpRight = [...spCpRight];

        const isDrawing = true;
        const shouldConnectToMouse = isDrawing && !isClosingPathDrag && spPoints.length > 0;

        if (isClosingPathDrag && spPoints.length >= 2) {
          previewPoints.push(spPoints[0]);
          previewCpLeft.push(spCpLeft[0]);
          previewCpRight.push(spCpRight[0]);
        } else if (shouldConnectToMouse) {
          previewPoints.push(mouseWorld);
          previewCpLeft.push(mouseWorld);
          previewCpRight.push(mouseWorld);
        }

        if (previewPoints.length >= 2) {
          // 繪製與實體完全相同樣式的線條
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'miter';
          ctx.setLineDash([]);

          if (activeTool === 'guideline') {
            ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
            ctx.setLineDash([4, 6]);
            ctx.lineWidth = Math.max(1.5, zoom * 0.08);

            const segPts = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (activeTool === 'yellow_double') {
            ctx.strokeStyle = yellowColor;
            ctx.lineWidth = Math.max(1.5, zoom * 0.1);

            const leftOffset = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0.08, 25);
            const rightOffset = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, -0.08, 25);

            ctx.beginPath();
            leftOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();

            ctx.beginPath();
            rightOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          } else if (activeTool === 'white_double') {
            ctx.strokeStyle = primaryLineColor;
            ctx.lineWidth = Math.max(1.5, zoom * 0.1);

            const leftOffset = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0.08, 25);
            const rightOffset = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, -0.08, 25);

            ctx.beginPath();
            leftOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();

            ctx.beginPath();
            rightOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          } else if (activeTool === 'white_dashed') {
            ctx.strokeStyle = primaryLineColor;
            ctx.lineWidth = Math.max(1.5, zoom * 0.1);
            ctx.setLineDash([zoom * 4.0, zoom * 6.0]);

            const segPts = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (activeTool === 'yellow_dashed') {
            ctx.strokeStyle = yellowDashedColor;
            ctx.lineWidth = Math.max(1.5, zoom * 0.1);
            ctx.setLineDash([zoom * 4.0, zoom * 6.0]);

            const segPts = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (activeTool === 'white_solid') {
            ctx.strokeStyle = primaryLineColor;
            ctx.lineWidth = Math.max(2, zoom * 0.15);

            const segPts = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          } else if (activeTool === 'crossing_dashed') {
            ctx.strokeStyle = primaryLineColor;
            ctx.lineWidth = Math.max(3.0, zoom * 0.3);
            ctx.setLineDash([zoom * 1.0, zoom * 2.0]);

            const segPts = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.setLineDash([]);
          } else if (activeTool === 'stop_line') {
            ctx.strokeStyle = primaryLineColor;
            ctx.lineWidth = Math.max(3.5, zoom * 0.35);

            const segPts = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          } else if (activeTool === 'yield_line') {
            drawYieldLineBezier(ctx, previewPoints, previewCpLeft, previewCpRight, 1, zoom, worldToScreen);
          } else if (activeTool === 'reversible_lane') {
            ctx.save();
            ctx.strokeStyle = primaryLineColor;
            ctx.lineWidth = Math.max(1.0, zoom * 0.1);
            ctx.setLineDash([zoom * 4.0, zoom * 6.0]);

            const leftOffset = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0.1, 25);
            const rightOffset = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, -0.1, 25);

            ctx.beginPath();
            leftOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();

            ctx.beginPath();
            rightOffset.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.restore();
          } else if (activeTool === 'bicycle_lane') {
            const laneWidth = 1.5;
            const halfW = laneWidth / 2;

            const leftOffset = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, -halfW, 40);
            const rightOffset = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, halfW, 40);

            if (leftOffset.length >= 2 && rightOffset.length >= 2) {
              ctx.save();
              ctx.fillStyle = 'rgba(244, 114, 182, 0.20)';
              ctx.strokeStyle = '#f472b6';
              ctx.lineWidth = Math.max(1.0, zoom * 0.05);

              ctx.beginPath();
              leftOffset.forEach((pt, idx) => {
                const s = worldToScreen(pt.x, pt.y);
                if (idx === 0) ctx.moveTo(s.x, s.y);
                else ctx.lineTo(s.x, s.y);
              });
              for (let i = rightOffset.length - 1; i >= 0; i--) {
                const s = worldToScreen(rightOffset[i].x, rightOffset[i].y);
                ctx.lineTo(s.x, s.y);
              }
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
              ctx.restore();
            }
          } else if (activeTool === 'BuildingLine') {
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2.5;

            const segPts = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0, 25);
            ctx.beginPath();
            segPts.forEach((pt, idx) => {
              const s = worldToScreen(pt.x, pt.y);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          } else if (activeTool === 'parking_zone') {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
            ctx.lineWidth = 1.0;
            ctx.setLineDash([4, 6]);
            ctx.beginPath();
            const segPts = getPathOffsetCurves(previewPoints, previewCpLeft, previewCpRight, 0, 25);
            segPts.forEach((pt, j) => {
              const s = worldToScreen(pt.x, pt.y);
              if (j === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
            ctx.restore();
          }
        }
      }

      // Draw interactive handles
      spPoints.forEach((pt, j) => {
        const ptS = worldToScreen(pt.x, pt.y);

        ctx.strokeStyle = 'rgba(236, 72, 153, 0.45)';
        ctx.lineWidth = 1;
        const cpLeftS = worldToScreen(spCpLeft[j].x, spCpLeft[j].y);
        const cpRightS = worldToScreen(spCpRight[j].x, spCpRight[j].y);

        ctx.beginPath();
        ctx.moveTo(cpLeftS.x, cpLeftS.y);
        ctx.lineTo(cpRightS.x, cpRightS.y);
        ctx.stroke();

        ctx.fillStyle = '#ec4899';
        ctx.beginPath();
        ctx.arc(cpLeftS.x, cpLeftS.y, 3, 0, 2 * Math.PI);
        ctx.arc(cpRightS.x, cpRightS.y, 3, 0, 2 * Math.PI);
        ctx.fill();

        const isFirstAndClosing = (j === 0 && isClosingPathDrag);
        ctx.fillStyle = isFirstAndClosing ? '#22c55e' : '#06b6d4';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = isFirstAndClosing ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.arc(ptS.x, ptS.y, isFirstAndClosing ? 7.5 : 4.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
      });
    }

    // DRAW VEHICLE SWEPT PATH RIBBONS AND RUN COLISION GRAPHICS
    let auditPts: Point2D[] = [];
    if (activeTool === 'smart_path' && spPoints.length > 1) {
      const tempPts: Point2D[] = [];
      for (let j = 0; j < spPoints.length - 1; j++) {
        const pStart = spPoints[j];
        const cpStart = spCpRight[j] || pStart;
        const cpEnd = spCpLeft[j + 1] || spPoints[j + 1];
        const pEnd = spPoints[j + 1];
        const samples = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 20);
        tempPts.push(...samples);
      }
      auditPts = tempPts;
    } else if (selectedElement && selectedElement.type === 'smart_path') {
      const sp = selectedElement as any;
      if (sp.points && sp.points.length > 1) {
        const tempPts: Point2D[] = [];
        for (let j = 0; j < sp.points.length - 1; j++) {
          const pStart = sp.points[j];
          const cpStart = sp.cpRight[j] || pStart;
          const cpEnd = sp.cpLeft[j + 1] || sp.points[j + 1];
          const pEnd = sp.points[j + 1];
          const samples = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 20);
          tempPts.push(...samples);
        }
        auditPts = tempPts;
      }
    }

    if (auditPts.length >= 2) {
      const swept = generateVehicleSweptPath(auditPts, designVehicle);
      const allQuads = [...swept.tractorEnvelopes, ...(swept.trailerEnvelopes || [])];

      let isHardCollision = false;
      let isSoftCollision = false;

      // Local helper polyline resolver
      const getLocalPoly = (el: any): Point2D[] => {
        if (el.type === 'BuildingLine' || el.type === 'guideline' || el.type === 'yellow_double' || el.type === 'white_dashed' || el.type === 'yellow_dashed' || el.type === 'white_solid' || el.type === 'smart_path' || el.type === 'parking_zone') {
          const ref = getLineBezierRepresentation(el);
          if (ref) {
            return getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
          }
        }
        if (el.points) return el.points;
        return [];
      };

      for (const quad of allQuads) {
        const quadEdges = [
          { a: quad.p1, b: quad.p2 },
          { a: quad.p2, b: quad.p3 },
          { a: quad.p3, b: quad.p4 },
          { a: quad.p4, b: quad.p1 }
        ];

        // 1. Hard Collision
        for (const bl of elements.filter(e => e.type === 'BuildingLine')) {
          const poly = getLocalPoly(bl);
          for (let k = 0; k < poly.length - 1; k++) {
            if (lineSegmentsIntersect(quadEdges[0].a, quadEdges[0].b, poly[k], poly[k+1]) ||
                lineSegmentsIntersect(quadEdges[1].a, quadEdges[1].b, poly[k], poly[k+1]) ||
                lineSegmentsIntersect(quadEdges[2].a, quadEdges[2].b, poly[k], poly[k+1]) ||
                lineSegmentsIntersect(quadEdges[3].a, quadEdges[3].b, poly[k], poly[k+1])) {
              isHardCollision = true;
              break;
            }
          }
          if (isHardCollision) break;
        }

        // 2. Soft Collision
        if (!isHardCollision) {
          for (const lineEl of elements.filter(e => e.type === 'yellow_double' || e.type === 'white_solid' || e.type === 'white_dashed' || e.type === 'yellow_dashed')) {
            const poly = getLocalPoly(lineEl);
            for (let k = 0; k < poly.length - 1; k++) {
              if (lineSegmentsIntersect(quadEdges[0].a, quadEdges[0].b, poly[k], poly[k+1]) ||
                  lineSegmentsIntersect(quadEdges[1].a, quadEdges[1].b, poly[k], poly[k+1]) ||
                  lineSegmentsIntersect(quadEdges[2].a, quadEdges[2].b, poly[k], poly[k+1]) ||
                  lineSegmentsIntersect(quadEdges[3].a, quadEdges[3].b, poly[k], poly[k+1])) {
                isSoftCollision = true;
                break;
              }
            }
            if (isSoftCollision) break;
          }
        }
      }

      // Draw Ribbon Fills if actively drafting
      if (activeTool === 'smart_path') {
        ctx.fillStyle = isHardCollision 
          ? 'rgba(239, 68, 68, 0.15)' 
          : isSoftCollision 
            ? 'rgba(234, 179, 8, 0.15)' 
            : 'rgba(16, 185, 129, 0.08)';

        ctx.strokeStyle = isHardCollision 
          ? 'rgba(239, 68, 68, 0.5)' 
          : isSoftCollision 
            ? 'rgba(234, 179, 8, 0.5)' 
            : 'rgba(56, 189, 248, 0.35)';
        ctx.lineWidth = 1.5;

        // Left rib
        ctx.beginPath();
        swept.leftRibbon.forEach((pt, j) => {
          const s = worldToScreen(pt.x, pt.y);
          if (j === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();

        // Right rib
        ctx.beginPath();
        swept.rightRibbon.forEach((pt, j) => {
          const s = worldToScreen(pt.x, pt.y);
          if (j === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();

        // Fill tracks
        ctx.beginPath();
        for (let i = 0; i < allQuads.length; i += 3) {
          const q = allQuads[i];
          const s1 = worldToScreen(q.p1.x, q.p1.y);
          const s2 = worldToScreen(q.p2.x, q.p2.y);
          const s3 = worldToScreen(q.p3.x, q.p3.y);
          const s4 = worldToScreen(q.p4.x, q.p4.y);

          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.lineTo(s3.x, s3.y);
          ctx.lineTo(s4.x, s4.y);
          ctx.closePath();
        }
        ctx.fill();

        // Render 3 intervals of Ghost Vehicles
        const ghostIdxs = [0, Math.floor(allQuads.length / 2), allQuads.length - 1].filter(x => x >= 0 && x < allQuads.length);
        ghostIdxs.forEach((idx) => {
          const q = allQuads[idx];
          const s1 = worldToScreen(q.p1.x, q.p1.y);
          const s2 = worldToScreen(q.p2.x, q.p2.y);
          const s3 = worldToScreen(q.p3.x, q.p3.y);
          const s4 = worldToScreen(q.p4.x, q.p4.y);

          ctx.fillStyle = isHardCollision ? 'rgba(239, 68, 68, 0.28)' : 'rgba(56, 189, 248, 0.12)';
          ctx.strokeStyle = isHardCollision ? '#ef4444' : '#00ffff';
          ctx.lineWidth = 1.8;

          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.lineTo(s3.x, s3.y);
          ctx.lineTo(s4.x, s4.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Little dynamic indicator text on vehicle roof
          ctx.fillStyle = isHardCollision ? '#f87171' : '#38bdf8';
          ctx.font = '8px sans-serif';
          ctx.fillText(designVehicle === 'articulated' ? '聯結車' : designVehicle === 'semi_trailer' ? '大客車/大貨車' : '自小客車', s1.x, s1.y - 4);

          // Wheel Hubs
          ctx.fillStyle = '#1e293b';
          ctx.beginPath();
          ctx.arc(s3.x, s3.y, 4, 0, 2*Math.PI);
          ctx.arc(s4.x, s4.y, 4, 0, 2*Math.PI);
          ctx.fill();
          ctx.stroke();
        });
      }
    }

    // DRAW COHESIVE SELECTION ROTATION LEVER INDICATOR ON TOP OF SELECTED ELEMENT
    if (appMode === 'cad' && activeTool === 'select' && selectedElement) {
      const box = getElementBoundingBox(selectedElement);
      if (box.maxX !== -Infinity) {
        const midX = (box.minX + box.maxX) / 2;
        const sTop = worldToScreen(midX, box.maxY);
        const sRot = { x: sTop.x, y: sTop.y - 35 };

        ctx.save();
        ctx.strokeStyle = '#a855f7'; // Purple lever line
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(sTop.x, sTop.y);
        ctx.lineTo(sRot.x, sRot.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#a855f7'; // Purple circle rotate knob
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sRot.x, sRot.y, 6.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // --- 車流軌跡模擬 (Bicycle Trajectory Simulator Rendering) ---
    if (appMode === 'simulation') {
      const scale = simConfig.scale;
      const isEditing = editingPathId !== null && editingPathId !== undefined;

      // Helper function to map simulator pixel coordinate to screen coordinate
      const simToScreen = (sx: number, sy: number) => {
        return worldToScreen(sx / scale, sy / scale);
      };

      const getSteerColor = (
        themeColor: "indigo" | "emerald" | "amber" | "rose" | "sky" | undefined,
        steerAngleDeg: number,
        maxSteerLimit: number
      ) => {
        const limit = maxSteerLimit || 40;
        if (Math.abs(steerAngleDeg) > limit) {
          return '#ef4444'; // 超限顯示紅色
        }
        const rgbMap: Record<string, string> = {
          indigo: '99, 102, 241',
          emerald: '16, 185, 129',
          amber: '245, 158, 11',
          rose: '244, 63, 94',
          sky: '14, 165, 233'
        };
        const rgb = rgbMap[themeColor || 'indigo'] || '99, 102, 241';
        const ratio = Math.min(1, Math.abs(steerAngleDeg) / limit);
        const alpha = 0.25 + 0.75 * ratio;
        return `rgba(${rgb}, ${alpha})`;
      };

      // 1. 繪製所有已儲存/鎖定的軌跡 (Locked Paths)
      simLockedPaths.forEach((lp) => {
        if (editingPathId && lp.id === editingPathId) return;
        const lpColor = lp.themeColor;
        const colorHex: Record<string, string> = {
          indigo: '#6366f1',
          emerald: '#10b981',
          amber: '#f59e0b',
          rose: '#f43f5e',
          sky: '#0ea5e9'
        };
        const activeColor = colorHex[lpColor] || '#6366f1';
        const rgbMap: Record<string, string> = {
          indigo: '99, 102, 241',
          emerald: '16, 185, 129',
          amber: '245, 158, 11',
          rose: '244, 63, 94',
          sky: '14, 165, 233'
        };
        const colorRgb = rgbMap[lpColor] || '99, 102, 241';

        // A. 繪製已鎖定軌跡的包絡線 (Swept Path)
        if (!isEditing && simShowSweptPath && lp.trajectory && lp.trajectory.length > 0) {
          ctx.save();
          ctx.fillStyle = activeColor;
          ctx.globalAlpha = simSweptOpacity * 0.5; // 已鎖定軌跡的掃掠稍微調淡

          lp.trajectory.forEach((state: any) => {
            // Tractor corners
            ctx.beginPath();
            const sFl = simToScreen(state.corners.fl.x, state.corners.fl.y);
            const sFr = simToScreen(state.corners.fr.x, state.corners.fr.y);
            const sRr = simToScreen(state.corners.rr.x, state.corners.rr.y);
            const sRl = simToScreen(state.corners.rl.x, state.corners.rl.y);

            ctx.moveTo(sFl.x, sFl.y);
            ctx.lineTo(sFr.x, sFr.y);
            ctx.lineTo(sRr.x, sRr.y);
            ctx.lineTo(sRl.x, sRl.y);
            ctx.closePath();
            ctx.fill();

            // Trailer corners (if enabled)
            if (state.trailerCorners) {
              ctx.beginPath();
              const stFl = simToScreen(state.trailerCorners.fl.x, state.trailerCorners.fl.y);
              const stFr = simToScreen(state.trailerCorners.fr.x, state.trailerCorners.fr.y);
              const stRr = simToScreen(state.trailerCorners.rr.x, state.trailerCorners.rr.y);
              const stRl = simToScreen(state.trailerCorners.rl.x, state.trailerCorners.rl.y);

              ctx.moveTo(stFl.x, stFl.y);
              ctx.lineTo(stFr.x, stFr.y);
              ctx.lineTo(stRr.x, stRr.y);
              ctx.lineTo(stRl.x, stRl.y);
              ctx.closePath();
              ctx.fill();
            }
          });
          ctx.restore();
        }

        // B. 繪製已鎖定軌跡引導路徑
        if (lp.trajectory && lp.trajectory.length > 1) {
          ctx.save();
          ctx.lineWidth = 1.8;
          const limit = lp.config?.maxSteerLimit ?? 40;
          for (let i = 0; i < lp.trajectory.length - 1; i++) {
            const stateStart = lp.trajectory[i];
            const stateEnd = lp.trajectory[i + 1];
            
            const steerAngleDeg = Math.abs((stateStart.steering * 180) / Math.PI);
            ctx.strokeStyle = getSteerColor(lp.themeColor, steerAngleDeg, limit);
            
            ctx.beginPath();
            const s1 = simToScreen(stateStart.rearAxle.x, stateStart.rearAxle.y);
            const s2 = simToScreen(stateEnd.rearAxle.x, stateEnd.rearAxle.y);
            ctx.moveTo(s1.x, s1.y);
            ctx.lineTo(s2.x, s2.y);
            ctx.stroke();
          }
          ctx.restore();
        }

        // C. 繪製已鎖定車輛末端位置 (Ghost Vehicle at End)
        if (!isEditing && lp.trajectory && lp.trajectory.length > 0) {
          ctx.save();
          const state = lp.trajectory[lp.trajectory.length - 1];
          ctx.strokeStyle = activeColor;
          ctx.lineWidth = 1.5;
          ctx.fillStyle = 'rgba(30, 41, 59, 0.4)';

          // Tractor
          ctx.beginPath();
          const sFl = simToScreen(state.corners.fl.x, state.corners.fl.y);
          const sFr = simToScreen(state.corners.fr.x, state.corners.fr.y);
          const sRr = simToScreen(state.corners.rr.x, state.corners.rr.y);
          const sRl = simToScreen(state.corners.rl.x, state.corners.rl.y);
          ctx.moveTo(sFl.x, sFl.y);
          ctx.lineTo(sFr.x, sFr.y);
          ctx.lineTo(sRr.x, sRr.y);
          ctx.lineTo(sRl.x, sRl.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Trailer
          if (state.trailerCorners) {
            ctx.beginPath();
            const stFl = simToScreen(state.trailerCorners.fl.x, state.trailerCorners.fl.y);
            const stFr = simToScreen(state.trailerCorners.fr.x, state.trailerCorners.fr.y);
            const stRr = simToScreen(state.trailerCorners.rr.x, state.trailerCorners.rr.y);
            const stRl = simToScreen(state.trailerCorners.rl.x, state.trailerCorners.rl.y);
            ctx.moveTo(stFl.x, stFl.y);
            ctx.lineTo(stFr.x, stFr.y);
            ctx.lineTo(stRr.x, stRr.y);
            ctx.lineTo(stRl.x, stRl.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          ctx.restore();
        }

        // D. 繪製已鎖定軌跡的 Corner 輪胎/角點軌跡線 (Corner Tracks)
        if (!isEditing && simShowCornerTracks && lp.trajectory && lp.trajectory.length > 1) {
          ctx.save();
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = `rgba(${colorRgb}, 0.45)`;

          // fl
          ctx.beginPath();
          lp.trajectory.forEach((state: any, idx: number) => {
            const pt = simToScreen(state.corners.fl.x, state.corners.fl.y);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();

          // fr
          ctx.beginPath();
          lp.trajectory.forEach((state: any, idx: number) => {
            const pt = simToScreen(state.corners.fr.x, state.corners.fr.y);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();

          // rl / rr
          ctx.beginPath();
          lp.trajectory.forEach((state: any, idx: number) => {
            const pt = simToScreen(state.corners.rl.x, state.corners.rl.y);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();

          ctx.beginPath();
          lp.trajectory.forEach((state: any, idx: number) => {
            const pt = simToScreen(state.corners.rr.x, state.corners.rr.y);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();

          // Trailer corner tracks
          if (lp.config?.enableTrailer) {
            ctx.strokeStyle = `rgba(${colorRgb}, 0.35)`;
            ctx.beginPath();
            lp.trajectory.forEach((state: any, idx: number) => {
              if (state.trailerCorners) {
                const pt = simToScreen(state.trailerCorners.rl.x, state.trailerCorners.rl.y);
                if (idx === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
              }
            });
            ctx.stroke();

            ctx.beginPath();
            lp.trajectory.forEach((state: any, idx: number) => {
              if (state.trailerCorners) {
                const pt = simToScreen(state.trailerCorners.rr.x, state.trailerCorners.rr.y);
                if (idx === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
              }
            });
            ctx.stroke();
          }
          ctx.restore();
        }

        // E. 繪製已鎖定軌跡的前後軸中心軌跡 (Axle Tracks)
        if (!isEditing && simShowAxleTracks && lp.trajectory && lp.trajectory.length > 1) {
          ctx.save();
          ctx.lineWidth = 1.2;

          // Rear Axle (RED for rear center)
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.7)';
          ctx.beginPath();
          lp.trajectory.forEach((state: any, idx: number) => {
            const pt = simToScreen(state.rearAxle.x, state.rearAxle.y);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();

          // Front Axle (BLUE for front center)
          ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
          ctx.beginPath();
          lp.trajectory.forEach((state: any, idx: number) => {
            const pt = simToScreen(state.frontAxle.x, state.frontAxle.y);
            if (idx === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          });
          ctx.stroke();

          // Trailer Rear Axle
          if (lp.config?.enableTrailer) {
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.7)';
            ctx.beginPath();
            lp.trajectory.forEach((state: any, idx: number) => {
              if (state.trailerRearAxle) {
                const pt = simToScreen(state.trailerRearAxle.x, state.trailerRearAxle.y);
                if (idx === 0) ctx.moveTo(pt.x, pt.y);
                else ctx.lineTo(pt.x, pt.y);
              }
            });
            ctx.stroke();
          }
          ctx.restore();
        }

        // F. 繪製已鎖定軌跡的連續骨架投影 (Body Wireframes)
        if (!isEditing && simShowBodyWireframe && lp.trajectory && lp.trajectory.length > 0) {
          ctx.save();
          ctx.strokeStyle = `rgba(${colorRgb}, 0.25)`;
          ctx.lineWidth = 0.8;

          const interval = 18;
          for (let i = 0; i < lp.trajectory.length; i += interval) {
            const state = lp.trajectory[i];
            if (!state) continue;

            // 主車線框
            const sFl = simToScreen(state.corners.fl.x, state.corners.fl.y);
            const sFr = simToScreen(state.corners.fr.x, state.corners.fr.y);
            const sRr = simToScreen(state.corners.rr.x, state.corners.rr.y);
            const sRl = simToScreen(state.corners.rl.x, state.corners.rl.y);

            ctx.beginPath();
            ctx.moveTo(sFl.x, sFl.y);
            ctx.lineTo(sFr.x, sFr.y);
            ctx.lineTo(sRr.x, sRr.y);
            ctx.lineTo(sRl.x, sRl.y);
            ctx.closePath();
            ctx.stroke();

            // 拖車線框
            if (state.trailerCorners) {
              const stFl = simToScreen(state.trailerCorners.fl.x, state.trailerCorners.fl.y);
              const stFr = simToScreen(state.trailerCorners.fr.x, state.trailerCorners.fr.y);
              const stRr = simToScreen(state.trailerCorners.rr.x, state.trailerCorners.rr.y);
              const stRl = simToScreen(state.trailerCorners.rl.x, state.trailerCorners.rl.y);

              ctx.beginPath();
              ctx.moveTo(stFl.x, stFl.y);
              ctx.lineTo(stFr.x, stFr.y);
              ctx.lineTo(stRr.x, stRr.y);
              ctx.lineTo(stRl.x, stRl.y);
              ctx.closePath();
              ctx.stroke();
            }
          }
          ctx.restore();
        }
      });

      // 2. 繪製目前編輯/播放的引導路徑
      if ((simDrawMode !== 'select' || simIsIntersectionMode || isEditing) && simInterpolatedPath && simInterpolatedPath.length > 1) {
        ctx.save();
        ctx.lineWidth = 2.5;
        const limit = simConfig.maxSteerLimit ?? 40;
        for (let i = 0; i < simInterpolatedPath.length - 1; i++) {
          const ptStart = simInterpolatedPath[i];
          const ptEnd = simInterpolatedPath[i + 1];
          
          const steerAngleDeg = ptStart.steerAngleDeg ?? 0;
          ctx.strokeStyle = getSteerColor(simThemeColor, steerAngleDeg, limit);
          
          ctx.beginPath();
          const s1 = simToScreen(ptStart.x, ptStart.y);
          const s2 = simToScreen(ptEnd.x, ptEnd.y);
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.stroke();
        }
        ctx.restore();
      }

      // 3. 繪製路口引導線輔助圖形 或 Raw Points 的 Anchor 與手柄輔助線
      if (simIsIntersectionMode) {
        const hasP0 = simP0X !== null && simP0Y !== null;
        const hasP3 = simP3X !== null && simP3Y !== null;

        // 當前正在拖曳定位起點/終點角度時，繪製滑鼠虛線引導線
        if (isDraggingRoadA && hasP0) {
          const sP0 = simToScreen(simP0X, simP0Y);
          const sMouse = worldToScreen(mouseWorld.x, mouseWorld.y);
          ctx.save();
          ctx.strokeStyle = "rgba(99, 102, 241, 0.75)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sP0.x, sP0.y);
          ctx.lineTo(sMouse.x, sMouse.y);
          ctx.stroke();
          ctx.restore();
        }
        if (isDraggingRoadB && hasP3) {
          const sP3 = simToScreen(simP3X, simP3Y);
          const sMouse = worldToScreen(mouseWorld.x, mouseWorld.y);
          ctx.save();
          ctx.strokeStyle = "rgba(236, 72, 153, 0.75)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sP3.x, sP3.y);
          ctx.lineTo(sMouse.x, sMouse.y);
          ctx.stroke();
          ctx.restore();
        }

        // B. 繪製起終點方向向量箭頭的輔助函數與呼叫
        const drawArrow = (from: Point, angle_deg: number, label: string, color: string) => {
          const rad = (angle_deg * Math.PI) / 180;
          const len = 40;
          const to = {
            x: from.x + len * Math.cos(rad),
            y: from.y + len * Math.sin(rad),
          };
          const sFrom = simToScreen(from.x, from.y);
          const sTo = simToScreen(to.x, to.y);

          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(sFrom.x, sFrom.y);
          ctx.lineTo(sTo.x, sTo.y);
          ctx.stroke();

          // 箭頭
          const arrowSize = 7;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(sTo.x, sTo.y);
          
          const toRad = Math.atan2(sTo.y - sFrom.y, sTo.x - sFrom.x);
          ctx.lineTo(
            sTo.x - arrowSize * Math.cos(toRad - Math.PI / 6),
            sTo.y - arrowSize * Math.sin(toRad - Math.PI / 6)
          );
          ctx.lineTo(
            sTo.x - arrowSize * Math.cos(toRad + Math.PI / 6),
            sTo.y - arrowSize * Math.sin(toRad + Math.PI / 6)
          );
          ctx.closePath();
          ctx.fill();

          // 標籤
          ctx.font = "bold 11px sans-serif";
          ctx.fillStyle = color;
          ctx.fillText(label, sFrom.x - 12, sFrom.y - 12);
        };

        if (hasP0) {
          ctx.save();
          drawArrow({ x: simP0X, y: simP0Y }, simP0Angle, "P0 起點", "rgb(99, 102, 241)");
          ctx.restore();
        }
        if (hasP3) {
          ctx.save();
          drawArrow({ x: simP3X, y: simP3Y }, simP3Angle, "P3 終點", "rgb(236, 72, 153)");
          ctx.restore();
        }

        if (simShowIntersectionHelpers && hasP0 && hasP3) {
          const p0 = { x: simP0X, y: simP0Y };
          const p3 = { x: simP3X, y: simP3Y };
          const { I, p1, p2, I1, I2, I1_base, I2_base } = calculateIntersectionCurve(
            p0,
            simP0Angle,
            p3,
            simP3Angle,
            simP1RatioPercent / 100,
            simP2RatioPercent / 100,
            simEnableOutswing,
            scale,
            simI1RatioPercent,
            simI1OffsetDistance,
            simI2RatioPercent,
            simI2OffsetDistance,
            simStartExtensionM,
            simEndExtensionM
          );

          ctx.save();
          // A. 繪製虛擬交角中心點輔助線
          ctx.strokeStyle = "rgba(239, 68, 68, 0.4)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);

          const sP0 = simToScreen(p0.x, p0.y);
          const sP3 = simToScreen(p3.x, p3.y);
          const sI = simToScreen(I.x, I.y);

          ctx.beginPath();
          ctx.moveTo(sP0.x, sP0.y);
          ctx.lineTo(sI.x, sI.y);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(sP3.x, sP3.y);
          ctx.lineTo(sI.x, sI.y);
          ctx.stroke();
          ctx.setLineDash([]);

          // 繪製虛擬交點 I 標記
          ctx.fillStyle = "rgb(239, 68, 68)";
          ctx.beginPath();
          ctx.arc(sI.x, sI.y, 6, 0, 2 * Math.PI);
          ctx.fill();
          ctx.strokeStyle = "white";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
          ctx.font = "bold 10px sans-serif";
          ctx.fillText("虛擬交點 I", sI.x + 10, sI.y + 4);

          // C. 繪製 P1, P2 控制點
          const drawControlPt = (pt: Point, name: string, color: string) => {
            const sPt = simToScreen(pt.x, pt.y);
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(sPt.x, sPt.y, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = "white";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.font = "bold 9px monospace";
            ctx.fillText(name, sPt.x + 8, sPt.y + 3);
          };

          drawControlPt(p1, `P1 (${simP1RatioPercent}%)`, "rgb(99, 102, 241)");
          drawControlPt(p2, `P2 (${simP2RatioPercent}%)`, "rgb(236, 72, 153)");

          // D. Outswing 偏移控制點
          if (simEnableOutswing) {
            const sI1Base = simToScreen(I1_base.x, I1_base.y);
            const sI1 = simToScreen(I1.x, I1.y);
            const sI2Base = simToScreen(I2_base.x, I2_base.y);
            const sI2 = simToScreen(I2.x, I2.y);

            ctx.strokeStyle = "rgba(16, 185, 129, 0.6)"; // emerald
            ctx.lineWidth = 1.25;
            ctx.setLineDash([3, 3]);

            ctx.beginPath();
            ctx.moveTo(sI1Base.x, sI1Base.y);
            ctx.lineTo(sI1.x, sI1.y);
            ctx.stroke();

            ctx.strokeStyle = "rgba(236, 72, 153, 0.6)"; // pink
            ctx.beginPath();
            ctx.moveTo(sI2Base.x, sI2Base.y);
            ctx.lineTo(sI2.x, sI2.y);
            ctx.stroke();

            ctx.setLineDash([]);

            // 繪製投射點
            ctx.fillStyle = "rgba(148, 163, 184, 0.8)";
            ctx.beginPath();
            ctx.arc(sI1Base.x, sI1Base.y, 4, 0, 2 * Math.PI);
            ctx.arc(sI2Base.x, sI2Base.y, 4, 0, 2 * Math.PI);
            ctx.fill();

            // 繪製 I1/I2 控制點
            ctx.fillStyle = "rgb(16, 185, 129)"; // emerald
            ctx.beginPath();
            ctx.arc(sI1.x, sI1.y, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.strokeStyle = "white";
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.font = "bold 9px monospace";
            ctx.fillText(`I1 (偏移點)`, sI1.x + 8, sI1.y + 3);

            ctx.fillStyle = "rgb(236, 72, 153)"; // pink
            ctx.beginPath();
            ctx.arc(sI2.x, sI2.y, 6, 0, 2 * Math.PI);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
            ctx.fillText(`I2 (偏移點)`, sI2.x + 8, sI2.y + 3);
          }

          ctx.restore();
        }
      } else {
        // 3. 繪製 Raw Points 的 Anchor 與手柄輔助線
        if (simRawPoints.length > 1) {
          ctx.save();
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          const sStart = simToScreen(simRawPoints[0].x, simRawPoints[0].y);
          ctx.moveTo(sStart.x, sStart.y);
          for (let i = 1; i < simRawPoints.length; i++) {
            const sNext = simToScreen(simRawPoints[i].x, simRawPoints[i].y);
            ctx.lineTo(sNext.x, sNext.y);
          }
          ctx.stroke();
          ctx.restore();
        }

        // 車流軌跡模擬的鋼筆與點擊繪圖預覽線
        if (simRawPoints.length > 0 && (simDrawMode === 'smartpath' || simDrawMode === 'click')) {
          ctx.save();
          ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)'; // 預覽線顏色 (indigo)
          ctx.lineWidth = 1.5;
          ctx.setLineDash([3, 3]);

          const lastPt = simRawPoints[simRawPoints.length - 1];
          const sStart = simToScreen(lastPt.x, lastPt.y);
          const sEnd = simToScreen(mouseWorld.x * simConfig.scale, mouseWorld.y * simConfig.scale);

          // 如果是 smartpath 並且最後一個點有 handleOut，則繪製貝茲曲線預覽
          if (simDrawMode === 'smartpath' && lastPt.handleOut && (lastPt.handleOut.x !== 0 || lastPt.handleOut.y !== 0)) {
            const A = { x: lastPt.x, y: lastPt.y };
            const B = { x: lastPt.x + lastPt.handleOut.x, y: lastPt.y + lastPt.handleOut.y };
            // 下一個點（滑鼠點）尚未決定手柄，所以 C 和 D 都重合在滑鼠點上
            const C = { x: mouseWorld.x * simConfig.scale, y: mouseWorld.y * simConfig.scale };
            const D = C;
            
            // 將 A, B, C, D 縮放到物理座標以進行 sampleCubicBezier
            const scale = simConfig.scale;
            const bPts = sampleCubicBezier(
              { x: A.x / scale, y: A.y / scale },
              { x: B.x / scale, y: B.y / scale },
              { x: C.x / scale, y: C.y / scale },
              { x: D.x / scale, y: D.y / scale },
              20
            );

            ctx.beginPath();
            bPts.forEach((pt, idx) => {
              const s = simToScreen(pt.x * scale, pt.y * scale);
              if (idx === 0) ctx.moveTo(s.x, s.y);
              else ctx.lineTo(s.x, s.y);
            });
            ctx.stroke();
          } else {
            // 普通折線預覽
            ctx.beginPath();
            ctx.moveTo(sStart.x, sStart.y);
            ctx.lineTo(sEnd.x, sEnd.y);
            ctx.stroke();
          }
          ctx.restore();
        }

        simRawPoints.forEach((wp, idx) => {
          const sAnchor = simToScreen(wp.x, wp.y);

          ctx.save();
          ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)'; // 紫色控制柄輔助線
          ctx.lineWidth = 1;

          if (wp.handleIn && (wp.handleIn.x !== 0 || wp.handleIn.y !== 0)) {
            const sIn = simToScreen(wp.x + wp.handleIn.x, wp.y + wp.handleIn.y);
            ctx.beginPath();
            ctx.moveTo(sAnchor.x, sAnchor.y);
            ctx.lineTo(sIn.x, sIn.y);
            ctx.stroke();

            ctx.fillStyle = '#a855f7';
            ctx.beginPath();
            ctx.arc(sIn.x, sIn.y, 3, 0, 2 * Math.PI);
            ctx.fill();
          }

          if (wp.handleOut && (wp.handleOut.x !== 0 || wp.handleOut.y !== 0)) {
            const sOut = simToScreen(wp.x + wp.handleOut.x, wp.y + wp.handleOut.y);
            ctx.beginPath();
            ctx.moveTo(sAnchor.x, sAnchor.y);
            ctx.lineTo(sOut.x, sOut.y);
            ctx.stroke();

            ctx.fillStyle = '#a855f7';
            ctx.beginPath();
            ctx.arc(sOut.x, sOut.y, 3, 0, 2 * Math.PI);
            ctx.fill();
          }

          // Anchor 點繪製
          const isDraggingThis = simDraggingWaypointIndex === idx;
          ctx.fillStyle = isDraggingThis ? '#10b981' : '#6366f1';
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(sAnchor.x, sAnchor.y, 5, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        });
      }

    // 4. 繪製目前播放中軌跡的包絡線 (Swept Path)
      if (!isEditing && simShowSweptPath && simTrajectory && simTrajectory.length > 0) {
        ctx.save();
        const rgbMap: Record<string, string> = {
          indigo: '99, 102, 241',
          emerald: '16, 185, 129',
          amber: '245, 158, 11',
          rose: '244, 63, 94',
          sky: '14, 165, 233'
        };
        const currentRgb = rgbMap[simThemeColor || 'indigo'] || '99, 102, 241';
        const stepsToRender = simTrajectory.slice(0, simCurrentStepIndex + 1);

        stepsToRender.forEach((state: any) => {
          // Tractor
          ctx.fillStyle = 'rgba(' + currentRgb + ', ' + simSweptOpacity + ')';
          ctx.beginPath();
          const sFl = simToScreen(state.corners.fl.x, state.corners.fl.y);
          const sFr = simToScreen(state.corners.fr.x, state.corners.fr.y);
          const sRr = simToScreen(state.corners.rr.x, state.corners.rr.y);
          const sRl = simToScreen(state.corners.rl.x, state.corners.rl.y);

          ctx.moveTo(sFl.x, sFl.y);
          ctx.lineTo(sFr.x, sFr.y);
          ctx.lineTo(sRr.x, sRr.y);
          ctx.lineTo(sRl.x, sRl.y);
          ctx.closePath();
          ctx.fill();

          // Trailer
          if (state.trailerCorners) {
            ctx.fillStyle = 'rgba(' + currentRgb + ', ' + simSweptOpacity + ')';
            ctx.beginPath();
            const stFl = simToScreen(state.trailerCorners.fl.x, state.trailerCorners.fl.y);
            const stFr = simToScreen(state.trailerCorners.fr.x, state.trailerCorners.fr.y);
            const stRr = simToScreen(state.trailerCorners.rr.x, state.trailerCorners.rr.y);
            const stRl = simToScreen(state.trailerCorners.rl.x, state.trailerCorners.rl.y);

            ctx.moveTo(stFl.x, stFl.y);
            ctx.lineTo(stFr.x, stFr.y);
            ctx.lineTo(stRr.x, stRr.y);
            ctx.lineTo(stRl.x, stRl.y);
            ctx.closePath();
            ctx.fill();
          }
        });
        ctx.restore();
      }

      // 5. 繪製 Corner 輪胎/角點軌跡線 (Corner Tracks)
      if (!isEditing && simShowCornerTracks && simTrajectory && simTrajectory.length > 1) {
        ctx.save();
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);

        const stepsToTrack = simTrajectory.slice(0, simCurrentStepIndex + 1);

        // fl
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
        ctx.beginPath();
        stepsToTrack.forEach((state: any, idx: number) => {
          const pt = simToScreen(state.corners.fl.x, state.corners.fl.y);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        // fr
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
        ctx.beginPath();
        stepsToTrack.forEach((state: any, idx: number) => {
          const pt = simToScreen(state.corners.fr.x, state.corners.fr.y);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        // rl / rr
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)';
        ctx.beginPath();
        stepsToTrack.forEach((state: any, idx: number) => {
          const pt = simToScreen(state.corners.rl.x, state.corners.rl.y);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        ctx.beginPath();
        stepsToTrack.forEach((state: any, idx: number) => {
          const pt = simToScreen(state.corners.rr.x, state.corners.rr.y);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        // Trailer corner tracks
        if (simConfig.enableTrailer) {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.3)';
          ctx.beginPath();
          stepsToTrack.forEach((state: any, idx: number) => {
            if (state.trailerCorners) {
              const pt = simToScreen(state.trailerCorners.rl.x, state.trailerCorners.rl.y);
              if (idx === 0) ctx.moveTo(pt.x, pt.y);
              else ctx.lineTo(pt.x, pt.y);
            }
          });
          ctx.stroke();

          ctx.beginPath();
          stepsToTrack.forEach((state: any, idx: number) => {
            if (state.trailerCorners) {
              const pt = simToScreen(state.trailerCorners.rr.x, state.trailerCorners.rr.y);
              if (idx === 0) ctx.moveTo(pt.x, pt.y);
              else ctx.lineTo(pt.x, pt.y);
            }
          });
          ctx.stroke();
        }
        ctx.restore();
      }

      // 6. 繪製前後軸中心軌跡 (Axle Tracks)
      if (!isEditing && simShowAxleTracks && simTrajectory && simTrajectory.length > 1) {
        ctx.save();
        ctx.lineWidth = 1.2;
        const stepsToTrack = simTrajectory.slice(0, simCurrentStepIndex + 1);

        // Rear Axle (The standard followed curve path)
        ctx.strokeStyle = '#ef4444'; // 紅色後軸中心線
        ctx.beginPath();
        stepsToTrack.forEach((state: any, idx: number) => {
          const pt = simToScreen(state.rearAxle.x, state.rearAxle.y);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        // Front Axle
        ctx.strokeStyle = '#3b82f6'; // 藍色前軸中心線
        ctx.beginPath();
        stepsToTrack.forEach((state: any, idx: number) => {
          const pt = simToScreen(state.frontAxle.x, state.frontAxle.y);
          if (idx === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        });
        ctx.stroke();

        // Trailer Rear Axle
        if (simConfig.enableTrailer) {
          ctx.strokeStyle = '#f59e0b'; // 橘色拖車後軸線
          ctx.beginPath();
          stepsToTrack.forEach((state: any, idx: number) => {
            if (state.trailerRearAxle) {
              const pt = simToScreen(state.trailerRearAxle.x, state.trailerRearAxle.y);
              if (idx === 0) ctx.moveTo(pt.x, pt.y);
              else ctx.lineTo(pt.x, pt.y);
            }
          });
          ctx.stroke();
        }
        ctx.restore();
      }

      // 6.5 繪製連續骨架投影 (Body Wireframes)
      if (!isEditing && simShowBodyWireframe && simTrajectory && simTrajectory.length > 0) {
        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1;
        
        const interval = 18;
        // 繪製從第 0 步到當前播放步驟之間的線框
        for (let i = 0; i <= simCurrentStepIndex; i += interval) {
          const state = simTrajectory[i];
          if (!state) continue;

          // 主車線框
          const sFl = simToScreen(state.corners.fl.x, state.corners.fl.y);
          const sFr = simToScreen(state.corners.fr.x, state.corners.fr.y);
          const sRr = simToScreen(state.corners.rr.x, state.corners.rr.y);
          const sRl = simToScreen(state.corners.rl.x, state.corners.rl.y);

          ctx.beginPath();
          ctx.moveTo(sFl.x, sFl.y);
          ctx.lineTo(sFr.x, sFr.y);
          ctx.lineTo(sRr.x, sRr.y);
          ctx.lineTo(sRl.x, sRl.y);
          ctx.closePath();
          ctx.stroke();

          // 拖車線框
          if (state.trailerCorners) {
            const stFl = simToScreen(state.trailerCorners.fl.x, state.trailerCorners.fl.y);
            const stFr = simToScreen(state.trailerCorners.fr.x, state.trailerCorners.fr.y);
            const stRr = simToScreen(state.trailerCorners.rr.x, state.trailerCorners.rr.y);
            const stRl = simToScreen(state.trailerCorners.rl.x, state.trailerCorners.rl.y);

            ctx.beginPath();
            ctx.moveTo(stFl.x, stFl.y);
            ctx.lineTo(stFr.x, stFr.y);
            ctx.lineTo(stRr.x, stRr.y);
            ctx.lineTo(stRl.x, stRl.y);
            ctx.closePath();
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // 7. 繪製車體本體 (Active Vehicle Tractor & Trailer)
      let stateToRender: any = null;
      if (!isEditing) {
        if (simTrajectory && simTrajectory.length > 0 && simCurrentStepIndex < simTrajectory.length) {
          stateToRender = simTrajectory[simCurrentStepIndex];
        } else if (simIsDraggingFirstVec && simFirstVecStart && simFirstVecEnd) {
          const fx = simFirstVecStart.x;
          const fy = simFirstVecStart.y;
          const dx = simFirstVecEnd.x - fx;
          const dy = simFirstVecEnd.y - fy;
          const heading = Math.hypot(dx, dy) > 4 ? Math.atan2(dy, dx) : 0;

          const L_px = simConfig.L * scale;
          const rx = fx - L_px * Math.cos(heading);
          const ry = fy - L_px * Math.sin(heading);

          const corners = calculateCorners({ x: rx, y: ry }, heading, simConfig);
          let trailerState = {};
          if (simConfig.enableTrailer) {
            const Lt_px = (simConfig.Lt ?? 7.5) * scale;
            const trx = rx - Lt_px * Math.cos(heading);
            const try_ = ry - Lt_px * Math.sin(heading);
            const trailerCorners = calculateTrailerCorners({ x: trx, y: try_ }, heading, simConfig);
            trailerState = {
              trailerRearAxle: { x: trx, y: try_ },
              trailerHeading: heading,
              trailerCorners
            };
          }

          stateToRender = {
            frontAxle: { x: fx, y: fy },
            rearAxle: { x: rx, y: ry },
            heading: heading,
            steering: 0,
            corners,
            ...trailerState
          };
        } else if (simRawPoints && simRawPoints.length === 1) {
          const fx = simRawPoints[0].x;
          const fy = simRawPoints[0].y;
          const dx = simRawPoints[0].handleOut.x;
          const dy = simRawPoints[0].handleOut.y;
          const heading = Math.atan2(dy, dx);

          const L_px = simConfig.L * scale;
          const rx = fx - L_px * Math.cos(heading);
          const ry = fy - L_px * Math.sin(heading);

          const corners = calculateCorners({ x: rx, y: ry }, heading, simConfig);
          let trailerState = {};
          if (simConfig.enableTrailer) {
            const Lt_px = (simConfig.Lt ?? 7.5) * scale;
            const trx = rx - Lt_px * Math.cos(heading);
            const try_ = ry - Lt_px * Math.sin(heading);
            const trailerCorners = calculateTrailerCorners({ x: trx, y: try_ }, heading, simConfig);
            trailerState = {
              trailerRearAxle: { x: trx, y: try_ },
              trailerHeading: heading,
              trailerCorners
            };
          }

          stateToRender = {
            frontAxle: { x: fx, y: fy },
            rearAxle: { x: rx, y: ry },
            heading: heading,
            steering: 0,
            corners,
            ...trailerState
          };
        }
      }

      if (stateToRender) {
        ctx.save();
        const state = stateToRender;

        // Helper function to draw a wheel (黑色輪胎，帶有中線以反饋角度)
        const drawWheel = (sCenter: Point, angleRad: number, isSteered: boolean) => {
          ctx.save();
          // 物理世界上輪寬 0.35m，長 0.9m。
          const wWidth = 0.35 * viewport.zoom;
          const wLength = 0.9 * viewport.zoom;
          ctx.translate(sCenter.x, sCenter.y);
          ctx.rotate(-angleRad);
          
          ctx.fillStyle = '#020617';
          ctx.fillRect(-wLength / 2, -wWidth / 2, wLength, wWidth);
          
          ctx.strokeStyle = isSteered ? '#6366f1' : '#94a3b8';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(-wLength * 0.3, 0);
          ctx.lineTo(wLength * 0.3, 0);
          ctx.stroke();
          ctx.restore();
        };

        // Tractor Corners mapped to screen
        const sFl = simToScreen(state.corners.fl.x, state.corners.fl.y);
        const sFr = simToScreen(state.corners.fr.x, state.corners.fr.y);
        const sRr = simToScreen(state.corners.rr.x, state.corners.rr.y);
        const sRl = simToScreen(state.corners.rl.x, state.corners.rl.y);

        // A. Draw Tractor Body
        ctx.fillStyle = 'rgba(30, 41, 59, 0.9)'; // Slate fill
        ctx.strokeStyle = whiteColor; // Dynamic outline (主車車身邊框白色/暗色化)
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sFl.x, sFl.y);
        ctx.lineTo(sFr.x, sFr.y);
        ctx.lineTo(sRr.x, sRr.y);
        ctx.lineTo(sRl.x, sRl.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // B. Draw Left & Right Wheels for Tractor
        const bodyHeading = state.heading;
        const cosH = Math.cos(bodyHeading);
        const sinH = Math.sin(bodyHeading);
        const orthoX = -sinH;
        const orthoY = cosH;
        // halfW (像素單位) ＝ (simConfig.W * scale) / 2
        const halfW = (simConfig.W * scale) / 2;

        const rearLeftWheelCenter = {
          x: state.rearAxle.x + halfW * orthoX,
          y: state.rearAxle.y + halfW * orthoY
        };
        const rearRightWheelCenter = {
          x: state.rearAxle.x - halfW * orthoX,
          y: state.rearAxle.y - halfW * orthoY
        };
        const frontLeftWheelCenter = {
          x: state.frontAxle.x + halfW * orthoX,
          y: state.frontAxle.y + halfW * orthoY
        };
        const frontRightWheelCenter = {
          x: state.frontAxle.x - halfW * orthoX,
          y: state.frontAxle.y - halfW * orthoY
        };

        // Draw rear axle wheels (非轉向輪)
        drawWheel(simToScreen(rearLeftWheelCenter.x, rearLeftWheelCenter.y), bodyHeading, false);
        drawWheel(simToScreen(rearRightWheelCenter.x, rearRightWheelCenter.y), bodyHeading, false);

        // Draw front axle wheels (轉向輪，前輪轉向角＝bodyHeading + state.steering)
        const frontSteeringAngle = bodyHeading + state.steering;
        drawWheel(simToScreen(frontLeftWheelCenter.x, frontLeftWheelCenter.y), frontSteeringAngle, true);
        drawWheel(simToScreen(frontRightWheelCenter.x, frontRightWheelCenter.y), frontSteeringAngle, true);

        // C. Draw Trailer (if active)
        if (state.trailerCorners) {
          const stFl = simToScreen(state.trailerCorners.fl.x, state.trailerCorners.fl.y);
          const stFr = simToScreen(state.trailerCorners.fr.x, state.trailerCorners.fr.y);
          const stRr = simToScreen(state.trailerCorners.rr.x, state.trailerCorners.rr.y);
          const stRl = simToScreen(state.trailerCorners.rl.x, state.trailerCorners.rl.y);

          ctx.fillStyle = 'rgba(71, 85, 105, 0.9)'; // Slate-600 fill
          ctx.strokeStyle = yellowColor; // Amber outline
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(stFl.x, stFl.y);
          ctx.lineTo(stFr.x, stFr.y);
          ctx.lineTo(stRr.x, stRr.y);
          ctx.lineTo(stRl.x, stRl.y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // draw hitch connector line from rearAxle of tractor to front of trailer
          const sTrailerFrontMid = {
            x: (stFl.x + stFr.x) / 2,
            y: (stFl.y + stFr.y) / 2
          };
          ctx.strokeStyle = yellowColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const sRearAxle = simToScreen(state.rearAxle.x, state.rearAxle.y);
          ctx.moveTo(sRearAxle.x, sRearAxle.y);
          ctx.lineTo(sTrailerFrontMid.x, sTrailerFrontMid.y);
          ctx.stroke();

          // Draw Trailer Wheels (Tandem double axles)
          if (state.trailerRearAxle) {
            const tHeading = state.trailerHeading ?? state.heading;
            const cosTH = Math.cos(tHeading);
            const sinTH = Math.sin(tHeading);
            const tOrthoX = -sinTH;
            const tOrthoY = cosTH;
            const tHalfW = ((simConfig.Wt ?? 2.5) * scale) / 2;

            // Rear Axle 1 wheels
            const rx1 = state.trailerRearAxle.x;
            const ry1 = state.trailerRearAxle.y;
            const wl1 = { x: rx1 + tHalfW * tOrthoX, y: ry1 + tHalfW * tOrthoY };
            const wr1 = { x: rx1 - tHalfW * tOrthoX, y: ry1 - tHalfW * tOrthoY };
            drawWheel(simToScreen(wl1.x, wl1.y), tHeading, false);
            drawWheel(simToScreen(wr1.x, wr1.y), tHeading, false);

            // Rear Axle 2 wheels (Tandem axle spaced 1.1m back)
            const tandemSpacing = 1.1 * scale;
            const rx2 = rx1 - tandemSpacing * cosTH;
            const ry2 = ry1 - tandemSpacing * sinTH;
            const wl2 = { x: rx2 + tHalfW * tOrthoX, y: ry2 + tHalfW * tOrthoY };
            const wr2 = { x: rx2 - tHalfW * tOrthoX, y: ry2 - tHalfW * tOrthoY };
            drawWheel(simToScreen(wl2.x, wl2.y), tHeading, false);
            drawWheel(simToScreen(wr2.x, wr2.y), tHeading, false);
          }
        }
        ctx.restore();
      }
    }

    // DRAW INFINITE COORDINATE CROSSHAIR CURSOR ON SCREEN
    if (viewport.zoom > 1.5) {
      const mouseS = worldToScreen(mouseWorld.x, mouseWorld.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      
      ctx.beginPath();
      ctx.moveTo(0, mouseS.y); ctx.lineTo(canvas.width, mouseS.y);
      ctx.moveTo(mouseS.x, 0); ctx.lineTo(mouseS.x, canvas.height);
      ctx.stroke();

      ctx.fillStyle = '#a1a1aa';
      ctx.font = '9px monospace';
      ctx.fillText(`X: ${mouseWorld.x.toFixed(2)}m  Y: ${mouseWorld.y.toFixed(2)}m`, mouseS.x + 12, mouseS.y - 12);
    }

    // DRAW ACTIVE CAD GEOMETRIC SNAP DECORATION INDICATOR
    if (snapTarget) {
      const snapS = worldToScreen(snapTarget.point.x, snapTarget.point.y);
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.8;
      
      if (snapTarget.type === 'endpoint') {
        ctx.beginPath();
        ctx.rect(snapS.x - 5, snapS.y - 5, 10, 10);
        ctx.stroke();
      } else if (snapTarget.type === 'midpoint') {
        ctx.beginPath();
        ctx.moveTo(snapS.x, snapS.y - 6);
        ctx.lineTo(snapS.x - 6, snapS.y + 4);
        ctx.lineTo(snapS.x + 6, snapS.y + 4);
        ctx.closePath();
        ctx.stroke();
      } else if (snapTarget.type === 'nearest') {
        ctx.beginPath();
        ctx.moveTo(snapS.x - 4, snapS.y - 4);
        ctx.lineTo(snapS.x + 4, snapS.y - 4);
        ctx.lineTo(snapS.x - 4, snapS.y + 4);
        ctx.lineTo(snapS.x + 4, snapS.y + 4);
        ctx.closePath();
        ctx.stroke();
      } else if (snapTarget.type === 'grid') {
        ctx.beginPath();
        ctx.arc(snapS.x, snapS.y, 4, 0, 2*Math.PI);
        ctx.stroke();
      }
    }

    // DRAW RED CALIBRATION SCALE ASSIST RULER LINE
    if (activeTool === 'map_scale' && scaleStartPt && scaleEndPt) {
      const s1 = worldToScreen(scaleStartPt.x, scaleStartPt.y);
      const s2 = worldToScreen(scaleEndPt.x, scaleEndPt.y);
      
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();

      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(s1.x, s1.y, 5, 0, 2*Math.PI);
      ctx.arc(s2.x, s2.y, 5, 0, 2*Math.PI);
      ctx.fill();

      // Measurement tag
      const mid = { x: (s1.x + s2.x)/2, y: (s1.y + s2.y)/2 };
      const curDist = distance(scaleStartPt, scaleEndPt);
      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      const showEquiv = !bgImage || bgImage.isCalibrated;
      const scaleText = showEquiv 
        ? `📐 像素: ${(curDist * zoom).toFixed(0)} px (相當於 ${curDist.toFixed(2)} 公尺)`
        : `📐 像素: ${(curDist * zoom).toFixed(0)} px`;
      ctx.fillText(scaleText, mid.x, mid.y - 12);
      ctx.restore();
    }

    // RENDER LIVE PREVIEW FOR YIELD LINE SELECTION DIRECTION (sgn = 1 vs -1)
    if (yieldLineDecisionState) {
      const { points, cpLeft, cpRight } = yieldLineDecisionState;
      const previewSign = getSelectedYieldLineSign(yieldLineDecisionState, mouseWorld);

      // Draw normal option (sgn = 1)
      ctx.save();
      ctx.globalAlpha = previewSign === 1 ? 1.0 : 0.25;
      drawYieldLineBezier(ctx, points, cpLeft, cpRight, 1, zoom, worldToScreen);
      ctx.restore();

      // Draw opposite option (sgn = -1)
      ctx.save();
      ctx.globalAlpha = previewSign === -1 ? 1.0 : 0.25;
      drawYieldLineBezier(ctx, points, cpLeft, cpRight, -1, zoom, worldToScreen);
      ctx.restore();

      // Draw helpful text indicator at mouse
      const mouseS = worldToScreen(mouseWorld.x, mouseWorld.y);
      ctx.save();
      ctx.fillStyle = '#22c55e'; // Emerald green
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText("✦ 移動游標選擇三角形朝向，左鍵點擊確認 ✦", mouseS.x, mouseS.y - 30);
      ctx.restore();
    }

    // RENDER HELP TEXT DURING INTERSECTION P0/P3 POSITIONING
    if (simIsIntersectionMode && simIntersectionPickState !== "none") {
      const mouseS = worldToScreen(mouseWorld.x, mouseWorld.y);
      ctx.save();
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 4;
      
      if (simIntersectionPickState === "p0") {
        ctx.fillStyle = 'rgb(99, 102, 241)';
        ctx.fillText("✦ 請點擊並拖曳以定位起點 P0 的位置與朝向 ✦", mouseS.x, mouseS.y - 30);
      } else if (simIntersectionPickState === "p3") {
        ctx.fillStyle = 'rgb(236, 72, 153)';
        ctx.fillText("✦ 請點擊並拖曳以定位終點 P3 的位置與朝向 ✦", mouseS.x, mouseS.y - 30);
      }
      ctx.restore();
    }

    // DRAW AUTOCAD-STYLE SELECTION MARQUEE OVERLAY (SCREEN-SPACE OVERLAY)
    if (isMarqueeDragging && marqueeStartPos && marqueeEndPos) {
      ctx.save();
      const minX = Math.min(marqueeStartPos.x, marqueeEndPos.x);
      const maxX = Math.max(marqueeStartPos.x, marqueeEndPos.x);
      const minY = Math.min(marqueeStartPos.y, marqueeEndPos.y);
      const maxY = Math.max(marqueeStartPos.y, marqueeEndPos.y);
      const w = maxX - minX;
      const h = maxY - minY;

      const isEncloseMode = marqueeEndPos.x >= marqueeStartPos.x && marqueeEndPos.y >= marqueeStartPos.y;

      if (isEncloseMode) {
        // Enclose mode (AutoCAD Left-to-Right layout: Blue tint, solid boundary)
        ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
      } else {
        // Touch mode (AutoCAD Right-to-Left layout: Green tint, dashed boundary)
        ctx.fillStyle = 'rgba(74, 222, 128, 0.15)';
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
      }

      ctx.fillRect(minX, minY, w, h);
      ctx.beginPath();
      ctx.rect(minX, minY, w, h);
      ctx.stroke();
      ctx.restore();
    }
  }, [
    elements, viewport, selectedElement, activeTool, draftPoints, spPoints, spCpLeft, spCpRight, mouseWorld, snapTarget, 
    spacePressed, R2, designVehicle, snapToGrid, snapToEndpoint, snapToMidpoint, scaleStartPt, scaleEndPt, isScalingDrag, 
    bgImage, scalingStartScreen, scalingEndScreen, showGrid, minorGridInterval, majorGridInterval, isMarqueeDragging, 
    marqueeStartPos, marqueeEndPos, selectedElementIds, yieldLineDecisionState,
    
    // Simulation Modes dependencies to drive fluid rendering
    appMode, simConfig, simControllerMode, simRawPoints, simDrawMode, simIsPlaying, simCurrentStepIndex, simTrajectory, 
    simInterpolatedPath, simLockedPaths, simThemeColor, simShowSweptPath, simShowCornerTracks, simShowAxleTracks, 
    simShowBodyWireframe, simSweptOpacity, simDraggingWaypointIndex, simDraggingHandleType, simIsDraggingFirstVec, 
    simFirstVecStart, simFirstVecEnd, simIsIntersectionMode, simP0X, simP0Y, simP0Angle, simP3X, simP3Y, simP3Angle, 
    simP1RatioPercent, simP2RatioPercent, simIntersectionPickState, simShowIntersectionHelpers, simEnableOutswing, 
    simI1RatioPercent, simI1OffsetDistance, simI2RatioPercent, simI2OffsetDistance, simStartExtensionM, simEndExtensionM, 
    simIsCalibrating,
    theme
  ]);

  // Curvature check for floating top error warnings
  let liveMinRadius = Infinity;
  let hasCurvatureWarning = false;
  const activeVehicle = (selectedElement && selectedElement.type === 'smart_path') 
    ? ((selectedElement as any).designVehicle || designVehicle)
    : designVehicle;
  const limitRadius = activeVehicle === 'passenger' ? 4.5 : activeVehicle === 'semi_trailer' ? 12.5 : 13.5;

  if (isLineOrPathTool(activeTool) && spPoints.length > 1) {
    for (let j = 0; j < spPoints.length - 1; j++) {
      const r = getBezierMinRadiusOfCurvature(spPoints[j], spCpRight[j], spCpLeft[j + 1], spPoints[j + 1]);
      if (r < liveMinRadius) {
        liveMinRadius = r;
      }
    }
    if (liveMinRadius < limitRadius) {
      hasCurvatureWarning = true;
    }
  } else if (selectedElement && (selectedElement.type === 'guideline' || selectedElement.type === 'yellow_double' || selectedElement.type === 'white_dashed' || selectedElement.type === 'yellow_dashed' || selectedElement.type === 'white_solid' || selectedElement.type === 'smart_path')) {
    const sp = selectedElement as any;
    if (sp.points && sp.points.length > 1) {
      for (let j = 0; j < sp.points.length - 1; j++) {
        const r = getBezierMinRadiusOfCurvature(sp.points[j], sp.cpRight[j], sp.cpLeft[j + 1], sp.points[j + 1]);
        if (r < liveMinRadius) {
          liveMinRadius = r;
        }
      }
    }
    if (liveMinRadius < limitRadius) {
      hasCurvatureWarning = true;
    }
  }

  // Real-time HUD collisions calculation
  let hasHardCollision = false;
  let hasSoftCollision = false;

  let cadAuditPts: Point2D[] = [];
  if (appMode !== 'simulation') {
    if (activeTool === 'smart_path' && spPoints.length > 1) {
      const tempPts: Point2D[] = [];
      for (let j = 0; j < spPoints.length - 1; j++) {
        const pStart = spPoints[j];
        const cpStart = spCpRight[j] || pStart;
        const cpEnd = spCpLeft[j + 1] || spPoints[j + 1];
        const pEnd = spPoints[j + 1];
        const samples = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 20);
        tempPts.push(...samples);
      }
      cadAuditPts = tempPts;
    } else if (selectedElement && selectedElement.type === 'smart_path') {
      const sp = selectedElement as any;
      if (sp.points && sp.points.length > 1) {
        const tempPts: Point2D[] = [];
        for (let j = 0; j < sp.points.length - 1; j++) {
          const pStart = sp.points[j];
          const cpStart = sp.cpRight[j] || pStart;
          const cpEnd = sp.cpLeft[j + 1] || sp.points[j + 1];
          const pEnd = sp.points[j + 1];
          const samples = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 20);
          tempPts.push(...samples);
        }
        cadAuditPts = tempPts;
      }
    }
  }

  const getElementPolyline = (el: any): Point2D[] => {
    if (el.type === 'BuildingLine' || el.type === 'guideline' || el.type === 'yellow_double' || el.type === 'white_double' || el.type === 'white_dashed' || el.type === 'yellow_dashed' || el.type === 'white_solid' || el.type === 'smart_path' || el.type === 'reversible_lane' || el.type === 'crossing_dashed' || el.type === 'stop_line' || el.type === 'Sidewalk' || el.type === 'bicycle_lane' || el.type === 'parking_zone') {
      const ref = getLineBezierRepresentation(el);
      if (ref) {
        return getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
      }
    }
    if (el.points) return el.points;
    return [];
  };

  const getElementEdges = (el: CadElement): Array<{ p1: Point2D; p2: Point2D }> => {
    const edges: Array<{ p1: Point2D; p2: Point2D }> = [];
    const ref = getLineBezierRepresentation(el);
    if (ref && ref.points && ref.points.length > 1) {
      for (let k = 0; k < ref.points.length - 1; k++) {
        const bPts = sampleCubicBezier(
          ref.points[k], 
          ref.cpRight[k] || ref.points[k], 
          ref.cpLeft[k+1] || ref.points[k+1], 
          ref.points[k+1], 
          10
        );
        for (let i = 0; i < bPts.length - 1; i++) {
          edges.push({ p1: bPts[i], p2: bPts[i + 1] });
        }
      }
    } else if ('p1' in el && 'p2' in el && (el as any).p1 && (el as any).p2) {
      edges.push({ p1: (el as any).p1, p2: (el as any).p2 });
    } else if ('points' in el && (el as any).points && (el as any).points.length > 1) {
      const pts = (el as any).points;
      for (let i = 0; i < pts.length - 1; i++) {
        edges.push({ p1: pts[i], p2: pts[i + 1] });
      }
      if ((el as any).closed) {
        edges.push({ p1: pts[pts.length - 1], p2: pts[0] });
      }
    }
    return edges;
  };

  if (appMode === 'simulation') {
    const isCurrentlyDragging = 
      activeDragPoint !== 'none' || 
      isDraggingRoadA || 
      isDraggingRoadB || 
      (simDraggingWaypointIndex !== null && simDraggingWaypointIndex !== undefined) || 
      isDraggingWholePath;

    if (!isCurrentlyDragging && simTrajectory && simTrajectory.length > 0) {
      const stepsToTest = simTrajectory.slice(0, simCurrentStepIndex + 1);
      const scale = simConfig.scale;

      // 1. Red warnings - BuildingLine
      const buildingLines = elements.filter(el => el.type === 'BuildingLine');
      let hitRed = false;

      for (const stepState of stepsToTest) {
        const tVerts = [
          { x: stepState.corners.fl.x / scale, y: stepState.corners.fl.y / scale },
          { x: stepState.corners.fr.x / scale, y: stepState.corners.fr.y / scale },
          { x: stepState.corners.rr.x / scale, y: stepState.corners.rr.y / scale },
          { x: stepState.corners.rl.x / scale, y: stepState.corners.rl.y / scale }
        ];
        const tEdges = [
          { p1: tVerts[0], p2: tVerts[1] },
          { p1: tVerts[1], p2: tVerts[2] },
          { p1: tVerts[2], p2: tVerts[3] },
          { p1: tVerts[3], p2: tVerts[0] }
        ];

        const trVerts = stepState.trailerCorners ? [
          { x: stepState.trailerCorners.fl.x / scale, y: stepState.trailerCorners.fl.y / scale },
          { x: stepState.trailerCorners.fr.x / scale, y: stepState.trailerCorners.fr.y / scale },
          { x: stepState.trailerCorners.rr.x / scale, y: stepState.trailerCorners.rr.y / scale },
          { x: stepState.trailerCorners.rl.x / scale, y: stepState.trailerCorners.rl.y / scale }
        ] : [];
        const trEdges = stepState.trailerCorners ? [
          { p1: trVerts[0], p2: trVerts[1] },
          { p1: trVerts[1], p2: trVerts[2] },
          { p1: trVerts[2], p2: trVerts[3] },
          { p1: trVerts[3], p2: trVerts[0] }
        ] : [];

        const allVehicleEdges = [...tEdges, ...trEdges];

        for (const bl of buildingLines) {
          const blEdges = getElementEdges(bl);
          for (const ve of allVehicleEdges) {
            for (const ble of blEdges) {
              if (lineSegmentsIntersect(ve.p1, ve.p2, ble.p1, ble.p2)) {
                hitRed = true;
                break;
              }
            }
            if (hitRed) break;
          }
          if (hitRed) break;
        }
        if (hitRed) {
          hasHardCollision = true;
          break;
        }
      }

      // 2. Yellow warnings - Lane Lines
      if (!hasHardCollision) {
        const laneTypes = [
          'yellow_double', 'white_double', 'white_solid', 'white_dashed', 
          'yellow_dashed', 'reversible_lane', 'crossing_dashed', 'stop_line'
        ];
        const laneElements = elements.filter(el => laneTypes.includes(el.type));
        let hitYellow = false;

        for (const stepState of stepsToTest) {
          const tVerts = [
            { x: stepState.corners.fl.x / scale, y: stepState.corners.fl.y / scale },
            { x: stepState.corners.fr.x / scale, y: stepState.corners.fr.y / scale },
            { x: stepState.corners.rr.x / scale, y: stepState.corners.rr.y / scale },
            { x: stepState.corners.rl.x / scale, y: stepState.corners.rl.y / scale }
          ];
          const tEdges = [
            { p1: tVerts[0], p2: tVerts[1] },
            { p1: tVerts[1], p2: tVerts[2] },
            { p1: tVerts[2], p2: tVerts[3] },
            { p1: tVerts[3], p2: tVerts[0] }
          ];

          const trVerts = stepState.trailerCorners ? [
            { x: stepState.trailerCorners.fl.x / scale, y: stepState.trailerCorners.fl.y / scale },
            { x: stepState.trailerCorners.fr.x / scale, y: stepState.trailerCorners.fr.y / scale },
            { x: stepState.trailerCorners.rr.x / scale, y: stepState.trailerCorners.rr.y / scale },
            { x: stepState.trailerCorners.rl.x / scale, y: stepState.trailerCorners.rl.y / scale }
          ] : [];
          const trEdges = stepState.trailerCorners ? [
            { p1: trVerts[0], p2: trVerts[1] },
            { p1: trVerts[1], p2: trVerts[2] },
            { p1: trVerts[2], p2: trVerts[3] },
            { p1: trVerts[3], p2: trVerts[0] }
          ] : [];

          const allVehicleEdges = [...tEdges, ...trEdges];

          for (const le of laneElements) {
            const leEdges = getElementEdges(le);
            for (const ve of allVehicleEdges) {
              for (const lee of leEdges) {
                if (lineSegmentsIntersect(ve.p1, ve.p2, lee.p1, lee.p2)) {
                  hitYellow = true;
                  break;
                }
              }
              if (hitYellow) break;
            }
            if (hitYellow) break;
          }
          if (hitYellow) {
            hasSoftCollision = true;
            break;
          }
        }
      }
    }
  } else {
    if (cadAuditPts.length >= 2) {
      const swept = generateVehicleSweptPath(cadAuditPts, designVehicle);
      const allQuads = [...swept.tractorEnvelopes, ...(swept.trailerEnvelopes || [])];

      for (const quad of allQuads) {
        const quadEdges = [
          { a: quad.p1, b: quad.p2 },
          { a: quad.p2, b: quad.p3 },
          { a: quad.p3, b: quad.p4 },
          { a: quad.p4, b: quad.p1 }
        ];

        // 1. Hard Collision
        for (const bl of elements.filter(e => e.type === 'BuildingLine')) {
          const poly = getElementPolyline(bl);
          for (let k = 0; k < poly.length - 1; k++) {
            if (lineSegmentsIntersect(quadEdges[0].a, quadEdges[0].b, poly[k], poly[k+1]) ||
                lineSegmentsIntersect(quadEdges[1].a, quadEdges[1].b, poly[k], poly[k+1]) ||
                lineSegmentsIntersect(quadEdges[2].a, quadEdges[2].b, poly[k], poly[k+1]) ||
                lineSegmentsIntersect(quadEdges[3].a, quadEdges[3].b, poly[k], poly[k+1])) {
              hasHardCollision = true;
              break;
            }
          }
          if (hasHardCollision) break;
        }

        // 2. Soft Collision
        if (!hasSoftCollision) {
          for (const lineEl of elements.filter(e => e.type === 'yellow_double' || e.type === 'white_solid' || e.type === 'white_dashed' || e.type === 'yellow_dashed')) {
            const poly = getElementPolyline(lineEl);
            for (let k = 0; k < poly.length - 1; k++) {
              if (lineSegmentsIntersect(quadEdges[0].a, quadEdges[0].b, poly[k], poly[k+1]) ||
                  lineSegmentsIntersect(quadEdges[1].a, quadEdges[1].b, poly[k], poly[k+1]) ||
                  lineSegmentsIntersect(quadEdges[2].a, quadEdges[2].b, poly[k], poly[k+1]) ||
                  lineSegmentsIntersect(quadEdges[3].a, quadEdges[3].b, poly[k], poly[k+1])) {
                hasSoftCollision = true;
                break;
              }
            }
            if (hasSoftCollision) break;
          }
        }
      }
    }
  }

  // Dynamic scale bar calculations
  const scaleCandidates = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  let bestScaleCandidate = 10;
  for (const cand of scaleCandidates) {
    const pxWidth = cand * viewport.zoom;
    if (pxWidth >= 60) {
      bestScaleCandidate = cand;
      break;
    }
  }
  const scalePixelWidth = bestScaleCandidate * viewport.zoom;
  const scaleLabel = bestScaleCandidate >= 1 ? `${bestScaleCandidate} m` : `${bestScaleCandidate * 100} cm`;

  const getCursorStyle = () => {
    if (isPanning) return 'grabbing';
    if (spacePressed) return 'grab';
    
    if (appMode === 'simulation') {
      if (simDrawMode === 'select') return 'crosshair';
      
      const penSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
        <path d="M0 0 L14 4 L10 8 L18 16 L14 20 L6 12 L2 14 Z" fill="rgba(15,23,42,0.95)" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
        <circle cx="6" cy="6" r="1.5" fill="white"/>
        <line x1="0" y1="0" x2="5" y2="5" stroke="white" stroke-width="1.5"/>
      </svg>`;
      const escaped = encodeURIComponent(penSvg);
      return `url("data:image/svg+xml;utf8,${escaped}") 0 0, auto`;
    }

    if (activeTool === 'select') return 'crosshair';

    // 鋼筆圖樣 (Beautiful high-fidelity custom SVG pen tool cursor)
    const penSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <path d="M0 0 L14 4 L10 8 L18 16 L14 20 L6 12 L2 14 Z" fill="rgba(15,23,42,0.95)" stroke="white" stroke-width="1.5" stroke-linejoin="round"/>
      <circle cx="6" cy="6" r="1.5" fill="white"/>
      <line x1="0" y1="0" x2="5" y2="5" stroke="white" stroke-width="1.5"/>
    </svg>`;
    const escaped = encodeURIComponent(penSvg);
    return `url("data:image/svg+xml;utf8,${escaped}") 0 0, auto`;
  };

  return (
    <div 
      ref={containerRef} 
      tabIndex={0}
      className="flex-1 h-full relative overflow-hidden bg-[#0c0d11] select-none focus:outline-none"
      style={{ cursor: getCursorStyle() }}
    >
      <canvas
        ref={canvasRef}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
        className="w-full h-full block"
      />

      {/* Real-time Engineering CAD HUD Collision Alerts Overlay */}
      {hasHardCollision && (
        <div 
          id="hard-collision-warning-hud"
          className="absolute top-4 left-1/2 transform -translate-x-1/2 z-33 flex items-center gap-3 px-5 py-3 bg-red-950 border border-red-500 rounded-xl shadow-2xl backdrop-blur-md text-red-200 animate-pulse max-w-xl"
        >
          <span className="text-base text-red-400">🚨</span>
          <div className="text-xs font-bold leading-snug">
            轉彎半徑不足，大車內輪差侵犯建築線！
          </div>
        </div>
      )}

      {!hasHardCollision && hasSoftCollision && (
        <div 
          id="soft-collision-warning-hud"
          className="absolute top-4 left-1/2 transform -translate-x-1/2 z-33 flex items-center gap-3 px-5 py-3 bg-yellow-950 border border-yellow-500/80 rounded-xl shadow-2xl backdrop-blur-md text-yellow-100 max-w-xl"
        >
          <span className="text-base text-yellow-400">⚠️</span>
          <div className="text-xs font-bold leading-snug">
            此線形大車轉彎會發生侵線/借道行為，建議優化槽化島。
          </div>
        </div>
      )}

      {/* Floating Canvas Controls */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2 z-10 select-none">
        {/* Zoom to Fit Button */}
        <button
          id="btn-zoom-to-fit"
          onClick={handleZoomToFit}
          title="Zoom to Fit & Center (🔍 視窗導正 / 回歸全圖中心)"
          className="flex items-center justify-center w-10 h-10 rounded-lg bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800/85 text-zinc-300 hover:text-white shadow-2xl backdrop-blur-md transition-all cursor-pointer"
        >
          <Search className="w-5 h-5 text-zinc-300" />
        </button>
      </div>

      {/* Floating SmartPath Draw Actions Box */}
      {isLineOrPathTool(activeTool) && spPoints.length >= 1 && (
        <div id="smartpath-floating-draw-bar" className="absolute bottom-16 left-1/2 transform -translate-x-1/2 z-25 flex gap-2 p-2 bg-zinc-900/95 border border-zinc-800/80 rounded-xl shadow-2xl backdrop-blur-md">
          <button
            id="btn-complete-smartpath"
            onClick={() => handleCompleteSmartPath(spPoints, spCpLeft, spCpRight)}
            disabled={spPoints.length < 2}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer ${
              spPoints.length >= 2 
                ? 'bg-blue-600 hover:bg-blue-500 text-white' 
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            }`}
          >
            完成路徑 (Enter/雙擊起點)
          </button>
          <button
            onClick={() => {
              setSpPoints([]);
              setSpCpLeft([]);
              setSpCpRight([]);
              setActiveTool('select');
            }}
            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-zinc-850 hover:bg-zinc-800 text-zinc-300 transition-all cursor-pointer"
          >
            取消
          </button>
        </div>
      )}

      {/* Floating Instructions Banner */}
      {activeTool !== 'select' && (
      <div className="absolute top-4 left-4 pointer-events-none bg-zinc-900/90 border border-zinc-800/80 px-4 py-3 rounded-lg shadow-2xl backdrop-blur-md max-w-sm flex flex-col gap-1 transition-all z-10">
        <h4 className="text-xs font-bold text-zinc-300 tracking-wider">
          {activeTool === 'guideline' && '✦ 繪製道路切基準線 (鋼筆模式)'}
          {activeTool === 'yellow_double' && '✦ 繪製黃雙線分向線 (鋼筆模式)'}
          {activeTool === 'white_double' && '✦ 繪製白雙線分向線 (鋼筆模式)'}
          {activeTool === 'white_dashed' && '✦ 繪製車道白虛線 (鋼筆模式)'}
          {activeTool === 'yellow_dashed' && '✦ 繪製車道黃虛線 (鋼筆模式)'}
          {activeTool === 'white_solid' && '✦ 繪製車道實線 (鋼筆模式)'}
          {activeTool === 'sketch_circle' && '✦ 繪製 Sketch 草稿圓 (圓心 -> 半徑)'}
          {activeTool === 'channelization' && '✦ 繪製自定義導流區 (點頂點，近起點閉合)'}
          {activeTool === 'text_label' && '✦ 標註工程說明文字 (點擊選位)'}
          {activeTool === 'smart_path' && '✦ 繪製自由貝茲標線 (點擊描端，壓拖拉把)'}
        </h4>
        <p className="text-[10px] text-zinc-500 leading-snug">
          {activeTool === 'sketch_circle' && `目前步驟: ${draftPoints.length === 0 ? '第一點點擊決定「圓心軸」' : '第二點壓拖決定「草稿半徑」'}`}
          {activeTool === 'channelization' && `已點擊 ${draftPoints.length} 個控制點。鄰近第一個點點擊可閉合生成島嶼。`}
          {isLineOrPathTool(activeTool) && `已選定 ${spPoints.length} 個錨點。左鍵點擊增加節點，按住拖拽調整切線。雙擊起點閉合完成。`}
          {activeTool === 'text_label' && '在想要擺設說明的實體位置點擊滑鼠左鍵即可。'}
        </p>
      </div>
      )}

      {/* Touch Navigation Helpers on Right Bottom corner */}
      <div className="absolute bottom-4 left-4 flex gap-4 text-[10px] font-mono text-zinc-500 bg-zinc-900/60 border border-zinc-800/20 px-3 py-1.5 rounded-md pointer-events-none backdrop-blur-sm z-10">
        <span>縮放: {Math.round(viewport.zoom * 10)}%</span>
        <span>Space拖移/滑鼠中鍵: 平移圖面</span>
      </div>

      {/* Dynamic Scale Bar on Right Bottom corner */}
      <div className="absolute bottom-4 right-4 flex flex-col items-center select-none pointer-events-none z-10 text-slate-200 font-mono text-[10px] gap-1 transition-all drop-shadow-[0_2px_2px_rgba(0,0,0,0.8)]">
        <span className="font-bold tracking-wider">{scaleLabel}</span>
        <div className="relative h-1 border-b border-white" style={{ width: `${scalePixelWidth}px` }}>
          <div className="absolute left-0 bottom-0 w-[1px] h-1.5 bg-white"></div>
          <div className="absolute left-1/2 bottom-0 w-[1px] h-1 bg-white/70 transform -translate-x-1/2"></div>
          <div className="absolute right-0 bottom-0 w-[1px] h-1.5 bg-white"></div>
        </div>
      </div>

      {calibrationDialog && (
        <div className="absolute inset-0 z-[100] bg-black/75 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#14161c] border border-zinc-800 p-5 rounded-2xl max-w-sm w-full shadow-2xl flex flex-col gap-4">
            <div className="flex items-center gap-2 text-red-400 border-b border-zinc-800 pb-2.5">
              <span className="text-lg">📐</span>
              <h3 className="text-xs font-bold text-white tracking-wider">校正背景底圖比例尺</h3>
            </div>
            
            <div className="space-y-2 text-xs">
              <p className="text-zinc-400 leading-relaxed">
                您拖曳選取的紅色比例尺長度為 <span className="font-mono text-zinc-100 font-bold">{calibrationDialog.screenDist.toFixed(1)}</span> 像素 (px)。
              </p>
              <label className="block text-zinc-300 font-medium">
                請輸入此紅色長度在真實世界的實地距離（公尺）：
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="any"
                  placeholder="例如: 10 或 3.5"
                  value={calibrationDialog.rawInput}
                  onChange={(e) => {
                    setCalibrationError(null);
                    setCalibrationDialog({
                      ...calibrationDialog,
                      rawInput: e.target.value
                    });
                  }}
                  autoFocus
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-blue-500 rounded-xl px-3 py-2 text-sm text-white font-mono placeholder-zinc-650 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleSaveCalibration();
                    }
                  }}
                />
                <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-xs text-zinc-500 font-bold">公尺 (m)</span>
              </div>
            </div>

            {calibrationError && (
              <div className="text-[11px] text-red-400 bg-red-950/25 border border-red-900/30 rounded-xl px-3 py-2 leading-tight">
                ⚠️ {calibrationError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-880">
              <button
                onClick={() => {
                  setCalibrationDialog(null);
                  setCalibrationError(null);
                  setScaleStartPt(null);
                  setScaleEndPt(null);
                  setScalingStartScreen(null);
                  setScalingEndScreen(null);
                  setIsScalingDrag(false);
                  setActiveTool('select');
                }}
                className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-zinc-850 hover:bg-zinc-800 text-zinc-300 transition-all cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleSaveCalibration}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-500 text-white shadow-lg transition-all cursor-pointer"
              >
                確認設定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
