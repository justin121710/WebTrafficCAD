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
  Point,
  MeasurementElement,
  AngularDimensionElement
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
  getMaxSteerForVehicle,
  getRoadArrowOutlinePoints,
  getArcFromThreePoints,
  getLineIntersection,
  solveThreeCenteredCurve
} from '../geometry';
import { arrowData } from '../arrowData';
import { getElementPrimitives, suggestHeading, getMotoBoxCorners, MARKING_NAMES, PATH_LINE_TYPES, primitivesBounds, roadTextOutline } from '../markings';
import { renderPrimitives } from '../renderPrimitives';
import SimulationLayer from '../simulation/SimulationLayer';
import { simStore } from '../simulation/store';
import { cadMinPathRadius } from '../simulation/vehicles';
import { SimInteraction, SimPointer } from '../simulation/interaction';
import { Search, Ruler } from 'lucide-react';

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
  if (el.type === 'road_text') {
    const o = roadTextOutline(el);
    return { x: o.reduce((a, q) => a + q.x, 0) / o.length, y: o.reduce((a, q) => a + q.y, 0) / o.length };
  }
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
    case 'red_solid':
    case 'yellow_solid':
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
    case 'road_text':
      return [(el as any).p];
    case 'moto_box':
    case 'moto_turn_box':
      return getMotoBoxCorners(el);
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
    case 'measurement': {
      const meas = el as MeasurementElement;
      return (meas.points || []).filter(Boolean);
    }
    case 'angular_dimension': {
      const ang = el as AngularDimensionElement;
      return [ang.center, ang.pStart1, ang.pStart2].filter(Boolean);
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

export function transformElement(
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

  // 旋轉時同步更新具方向性的物件
  if (angleRad && (copy.type === 'road_arrow' || copy.type === 'road_text' || copy.type === 'text' || (copy.type === 'parking_space' && copy.angle !== undefined))) {
    copy.angle = (copy.angle || 0) + angleRad;
  }

  return copy;
}

export function getElementBoundingBox(el: any): { minX: number; maxX: number; minY: number; maxY: number } {
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
  if (el.type === 'road_text') collect.push(...roadTextOutline(el));
  if (el.type === 'moto_box' || el.type === 'moto_turn_box') collect.push(...getMotoBoxCorners(el));

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
  /** 右鍵選單動作 */
  onContextAction?: (action: 'copy' | 'paste' | 'duplicate' | 'rotate90' | 'rotate-90' | 'delete') => void;
  canPaste?: boolean;
  /** 畫布底色（依介面風格） */
  canvasBackground?: string;
  /** 畫布上浮動面板佔用的邊距（px），讓提示、狀態列、比例尺避開 */
  insets?: { top: number; right: number; bottom: number; left: number };
  /** 數值改變時將視圖縮放至全圖（載入專案／範本時由 App 觸發） */
  fitRequest?: number;
  /** 游標世界座標與縮放（px/m）變動時通知外層狀態列 */
  onCursorMove?: (x: number, y: number, zoom: number) => void;
  /** 由外層狀態列顯示座標時，隱藏畫布內建的座標列 */
  hideStatusBar?: boolean;
  /** 繪製工具的游標樣式 */
  drawCursor?: DrawCursorStyle;
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
  snapToIntersection?: boolean;

  onSaveHistoryBeforeDrag: () => void;
  bgImage: any;
  setBgImage: React.Dispatch<React.SetStateAction<any>>;

  showGrid: boolean;
  minorGridInterval: number;
  majorGridInterval: number;

  selectedElementIds?: string[];
  onSelectElementIdsChange?: (ids: string[]) => void;
  onUpdateElements?: (elements: CadElement[]) => void;
  // 軌跡模擬模式（模擬的狀態與操作在 src/simulation，這裡只轉交指標事件與顯示覆蓋層）
  appMode?: 'cad' | 'simulation';
  /** 畫布定位請求（例如點擊衝突清單） */
  focusRequest?: { pt: Point2D; seq: number } | null;
  roadArrowConfig?: { arrowType: 'straight' | 'left' | 'right' | 'straight_left' | 'straight_right', length: number, angle: number };
  setRoadArrowConfig?: (cfg: any) => void;
}

/**
 * 繪製工具的游標（32×32 SVG，白線加深色描邊，淺色或深色底都看得清楚）。
 * hot：游標熱點，也就是實際點下的位置。
 */
export type DrawCursorStyle = 'cross' | 'pen' | 'precision';
const DARK = '#111317', LIGHT = '#f2f3f5';
export const DRAW_CURSORS: Record<DrawCursorStyle, { label: string; svg: string; hot: [number, number] }> = {
  cross: {
    label: '精準十字',
    hot: [16, 16],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M16 2V12.5M16 19.5V30M2 16H12.5M19.5 16H30" stroke="${DARK}" stroke-width="3"/><path d="M16 2V12.5M16 19.5V30M2 16H12.5M19.5 16H30" stroke="${LIGHT}" stroke-width="1"/><rect x="15" y="15" width="2" height="2" fill="${LIGHT}" stroke="${DARK}" stroke-width="0.5"/></svg>`,
  },
  pen: {
    label: '筆尖',
    hot: [2, 2],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M2 2L15 6.5L22 13.5L13.5 22L6.5 15Z" fill="${DARK}" stroke="${LIGHT}" stroke-width="1.3" stroke-linejoin="miter"/><path d="M2 2L9.6 9.6" stroke="${LIGHT}" stroke-width="1.2"/><rect x="9.4" y="9.4" width="3" height="3" fill="none" stroke="${LIGHT}" stroke-width="1.1" transform="rotate(45 10.9 10.9)"/><path d="M15.5 20L20 15.5L23.5 19L19 23.5Z" fill="${LIGHT}" stroke="${DARK}" stroke-width="0.8"/></svg>`,
  },
  precision: {
    label: '十字＋筆尖',
    hot: [9, 9],
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path d="M9 1V6.5M9 11.5V17M1 9H6.5M11.5 9H17" stroke="${DARK}" stroke-width="3"/><path d="M9 1V6.5M9 11.5V17M1 9H6.5M11.5 9H17" stroke="${LIGHT}" stroke-width="1"/><path d="M17 17L25 19.5L29.5 24L24 29.5L19.5 25Z" fill="${DARK}" stroke="${LIGHT}" stroke-width="1.1" stroke-linejoin="miter"/><path d="M17 17L21.6 21.6" stroke="${LIGHT}" stroke-width="1"/></svg>`,
  },
};
export const drawCursorUrl = (k: DrawCursorStyle) => `data:image/svg+xml;utf8,${encodeURIComponent(DRAW_CURSORS[k].svg)}`;

/** 編輯介面（選取、夾點、把手、草稿線、鎖點）統一使用單一顏色 */
const EDIT = '#4c9eff';
const EDIT_BG = '#1d2127';
const editA = (a: number) => `rgba(76, 158, 255, ${a})`;

export default function CadCanvas({
  onContextAction,
  canPaste = false,
  canvasBackground = '#101216',
  insets = { top: 0, right: 0, bottom: 0, left: 0 },
  fitRequest,
  onCursorMove,
  hideStatusBar = false,
  drawCursor = 'cross',
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
  snapToIntersection = true,
  onSaveHistoryBeforeDrag,
  bgImage,
  setBgImage,
  showGrid,
  minorGridInterval,
  majorGridInterval,
  selectedElementIds = [],
  onSelectElementIdsChange,
  onUpdateElements,
  appMode = 'cad',
  focusRequest = null,
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
  useEffect(() => { onCursorMove?.(mouseWorld.x, mouseWorld.y, viewport.zoom); }, [mouseWorld, viewport.zoom]);
  const [snapTarget, setSnapTarget] = useState<SnapTarget | null>(null);

  // Advanced Tools States and Refs


  const isPerpSnappedRef = useRef<boolean>(false);
  const perpSnapLineRef = useRef<{ p1: Point2D; p2: Point2D; targetA: Point2D; targetB: Point2D } | null>(null);

  // Interactive drawings draft states (used by polygon channels & circles)
  const [draftPoints, setDraftPoints] = useState<Point2D[]>([]);
  // 內嵌文字輸入框（文字標註／路面標字）
  const [contextMenu, setContextMenu] = useState<{ sx: number; sy: number } | null>(null);
  const [textDraft, setTextDraft] = useState<{ kind: 'text' | 'road_text'; p: Point2D; sx: number; sy: number; value: string } | null>(null);
  const lastRoadTextRef = useRef<string>('慢');

  const commitTextDraft = () => {
    if (!textDraft) return;
    const value = textDraft.value.trim();
    if (value) {
      if (textDraft.kind === 'road_text') {
        lastRoadTextRef.current = value;
        const heading = suggestHeading(textDraft.p, elements, Math.PI / 2);
        const el: CadElement = {
          id: `road_text-${Date.now()}`,
          type: 'road_text',
          p: textDraft.p,
          text: value,
          charHeight: 2.5,
          angle: heading ?? Math.PI / 2,
          widthFactor: 0.4,
          charGap: 0.6,
        } as any;
        onAddElement(el);
        onSelectElement(el);
      } else {
        const el: CadElement = {
          id: `text-${Date.now()}`,
          type: 'text',
          p: textDraft.p,
          text: value,
          fontSize: 1.5,
        };
        onAddElement(el);
        onSelectElement(el);
      }
    }
    setTextDraft(null);
  };

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
      setSpPoints([]);
      setSpCpLeft([]);
      setSpCpRight([]);
      setDraftPoints([]);
      prevActiveToolRef.current = activeTool;
    }
  }, [activeTool]);

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

  // 軌跡模擬：指標事件轉交給 SimInteraction（鎖點與平移仍由本元件處理）
  const simInputRef = useRef<SimInteraction | null>(null);
  if (!simInputRef.current) simInputRef.current = new SimInteraction(simStore);
  const simInput = simInputRef.current;
  const lastSimPointer = useRef<SimPointer | null>(null);
  const simPointer = (e: React.PointerEvent | React.MouseEvent, sx: number, sy: number, world: Point2D): SimPointer => {
    const p: SimPointer = {
      sx, sy, world,
      shift: e.shiftKey,
      alt: e.altKey,
      button: e.button ?? 0,
      pointerType: (e as React.PointerEvent).pointerType || 'mouse',
      w2s: worldToScreen,
      elements,
    };
    lastSimPointer.current = p;
    return p;
  };

  // 定位請求：把指定點移到畫面中央
  useEffect(() => {
    if (!focusRequest) return;
    setViewport(prev => ({ ...prev, zoom: Math.max(prev.zoom, 8), panX: -focusRequest.pt.x * Math.max(prev.zoom, 8), panY: focusRequest.pt.y * Math.max(prev.zoom, 8) }));
  }, [focusRequest?.seq]);

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
           tool === 'parking_zone' ||
           tool === 'measurement' ||
           tool === 'red_solid' ||
           tool === 'yellow_solid' ||
           tool === 'grid_box';
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

    // 以實際繪製的幾何計算範圍，所有標線類型（含標字、行穿線、停等區）一致
    const { minX, minY, maxX, maxY } = primitivesBounds(elements.flatMap(el => getElementPrimitives(el)));

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

  // 只在明確要求時縮放至全圖（載入專案／範本），手動繪圖不會跳動視角
  useEffect(() => {
    if (!fitRequest) return;
    const t = setTimeout(() => handleZoomToFit(), 50);
    return () => clearTimeout(t);
  }, [fitRequest]);

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
      // 模擬模式的快捷鍵由 App 統一處理
      if (appMode === 'simulation') return;
      if (e.code === 'Enter') {
        if (appMode === 'cad') {
          e.preventDefault();
          if (isLineOrPathTool(activeTool) && spPoints.length >= 2) {
            handleCompleteSmartPath(spPoints, spCpLeft, spCpRight);
          }
        }
      }
      if ((e.key === 'v' || e.key === 'V' || e.code === 'KeyV') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (appMode === 'cad') {
          e.preventDefault();
          if (isLineOrPathTool(activeTool) && spPoints.length >= 2) {
            handleCompleteSmartPath(spPoints, spCpLeft, spCpRight);
          } else if (spPoints.length === 1) {
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
        // 第一次 Esc：完成（≥2 點）或放棄進行中的繪製並保留工具；沒有進行中的繪製時才回到選取工具
        if (appMode === 'cad' && isLineOrPathTool(activeTool) && spPoints.length >= 2 && activeTool !== 'measurement') {
          handleCompleteSmartPath(spPoints, spCpLeft, spCpRight);
          return;
        }
        if (appMode === 'cad' && (spPoints.length > 0 || draftPoints.length > 0)) {
          setSpPoints([]);
          setSpCpLeft([]);
          setSpCpRight([]);
          setDraftPoints([]);
          return;
        }
        setSpPoints([]);
        setSpCpLeft([]);
        setSpCpRight([]);
        setDraftPoints([]);
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
  }, [spPoints, spCpLeft, spCpRight, activeTool, draftPoints, appMode, selectedElement, connectionStartInfo, elements, designVehicle]);

  const normalize = (v: { x: number; y: number }): { x: number; y: number } => {
    const len = Math.hypot(v.x, v.y);
    return len > 0.001 ? { x: v.x / len, y: v.y / len } : { x: 1, y: 0 };
  };

  const findPerpendicularSnap = (p1: Point2D, mousePt: Point2D): { point: Point2D; targetA: Point2D; targetB: Point2D } | null => {
    let bestSnapPt: Point2D | null = null;
    let bestTargetA: Point2D | null = null;
    let bestTargetB: Point2D | null = null;
    let closestDistScreen = 20; // snapping radius threshold in pixels

    elements.forEach(el => {
      if (!el) return;

      // Handle simple lines
      if (
        el.type === 'guideline' || 
        el.type === 'yellow_double' || 
        el.type === 'white_double' || 
        el.type === 'white_dashed' || 
        el.type === 'yellow_dashed' || 
        el.type === 'white_solid' || el.type === 'red_solid' || el.type === 'yellow_solid' || 
        el.type === 'reversible_lane' ||
        el.type === 'stop_line' ||
        el.type === 'yield_line'
      ) {
        const line = el as any;
        if (line.p1 && line.p2) {
          const a = line.p1;
          const b = line.p2;
          
          // Calculate mouse projection on this segment to see if mouse is close
          const mouseProj = projectPointOnSegment(mousePt, a, b);
          const screenMouseProj = worldToScreen(mouseProj.point.x, mouseProj.point.y);
          const screenMouse = worldToScreen(mousePt.x, mousePt.y);
          const distToSegmentScreen = Math.hypot(screenMouse.x - screenMouseProj.x, screenMouse.y - screenMouseProj.y);

          if (distToSegmentScreen < closestDistScreen) {
            // Project initial point p1 onto this line segment
            const p1Proj = projectPointOnSegment(p1, a, b);
            
            closestDistScreen = distToSegmentScreen;
            bestSnapPt = p1Proj.point;
            bestTargetA = a;
            bestTargetB = b;
          }
        }
      }
      
      // Handle paths or curves
      if (el.type === 'smart_path' || el.type === 'bicycle_lane' || el.type === 'parking_zone') {
        const pathEl = el as any;
        const ref = getLineBezierRepresentation(pathEl);
        if (ref && ref.points && ref.points.length >= 2) {
          for (let i = 0; i < ref.points.length - 1; i++) {
            const a = ref.points[i];
            const b = ref.points[i + 1];

            const mouseProj = projectPointOnSegment(mousePt, a, b);
            const screenMouseProj = worldToScreen(mouseProj.point.x, mouseProj.point.y);
            const screenMouse = worldToScreen(mousePt.x, mousePt.y);
            const distToSegmentScreen = Math.hypot(screenMouse.x - screenMouseProj.x, screenMouse.y - screenMouseProj.y);

            if (distToSegmentScreen < closestDistScreen) {
              const p1Proj = projectPointOnSegment(p1, a, b);
              closestDistScreen = distToSegmentScreen;
              bestSnapPt = p1Proj.point;
              bestTargetA = a;
              bestTargetB = b;
            }
          }
        }
      }
    });

    if (bestSnapPt && bestTargetA && bestTargetB) {
      return { point: bestSnapPt, targetA: bestTargetA, targetB: bestTargetB };
    }
    return null;
  };

  // Object snappy captures logic
  const computeSnapPoint = (worldPos: Point2D, sx: number, sy: number, excludeElementId?: string): SnapTarget | null => {
    let bestSnap: SnapTarget | null = null;
    let closestDistScreen = 14; // Snapping radius threshold in screens pixel

    // 優先吸附選取物件的所有幾何節點（即使 snapToEndpoint 未啟用）
    if (appMode === 'cad' && selectedElement && activeTool !== 'select') {
      const vertices = getElementVertices(selectedElement);
      if (vertices) {
        vertices.forEach((pt: Point2D) => {
          if (!pt || pt.x === undefined || pt.y === undefined) return;
          const screenPt = worldToScreen(pt.x, pt.y);
          const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
          if (d < closestDistScreen) {
            closestDistScreen = d;
            bestSnap = { point: pt, type: 'endpoint', elementId: selectedElement.id };
          }
        });
      }
      if (bestSnap) {
        return bestSnap;
      }
    }

    elements.forEach(el => {
      if (!el) return;
      if (excludeElementId && el.id === excludeElementId) {
        return;
      }
      // Endpoint snapping
      if (PATH_LINE_TYPES.has(el.type) || el.type === 'smart_path' || el.type === 'parking_zone' || el.type === 'bicycle_lane') {
        const line = el as any;
        const ref = getLineBezierRepresentation(line);

        if (ref && ref.points) {
          // Snap to any intermediate anchor points
          if (snapToEndpoint) {
            ref.points.forEach((pt: Point2D) => {
              if (!pt || pt.x === undefined || pt.y === undefined) return;
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
            if (pt && pt.x !== undefined && pt.y !== undefined) {
              const screenPt = worldToScreen(pt.x, pt.y);
              const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
              if (d < closestDistScreen) {
                closestDistScreen = d;
                bestSnap = { point: pt, type: 'midpoint', elementId: el.id };
              }
            }
          }
        } else if (line && line.p1 && line.p2) {
          if (snapToEndpoint) {
            const pts = [line.p1, line.p2];
            pts.forEach(pt => {
              if (!pt || pt.x === undefined || pt.y === undefined) return;
              const screenPt = worldToScreen(pt.x, pt.y);
              const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
              if (d < closestDistScreen) {
                closestDistScreen = d;
                bestSnap = { point: pt, type: 'endpoint', elementId: el.id };
              }
            });
          }
          if (snapToMidpoint && !bestSnap && line.p1.x !== undefined && line.p2.x !== undefined && line.p1.y !== undefined && line.p2.y !== undefined) {
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
        if (circ && circ.center && circ.center.x !== undefined && circ.center.y !== undefined) {
          if (snapToEndpoint) {
            // Snap directly to center point
            const screenC = worldToScreen(circ.center.x, circ.center.y);
            const dCenter = Math.hypot(sx - screenC.x, sy - screenC.y);
            if (dCenter < closestDistScreen) {
              closestDistScreen = dCenter;
              bestSnap = { point: circ.center, type: 'endpoint', elementId: el.id };
            }
          }
        }
      } else if (el.type === 'three_center_curve') {
        const curve = el as ThreeCenterCurveElement;
        if (curve) {
          const pointsToSnap = [
            { pt: curve.pStart, label: 'pStart' },
            { pt: curve.pEnd, label: 'pEnd' },
            { pt: curve.T1, label: 'T1' },
            { pt: curve.T2, label: 'T2' }
          ];
          
          if (snapToEndpoint) {
            pointsToSnap.forEach(item => {
              if (!item.pt || item.pt.x === undefined || item.pt.y === undefined) return;
              const screenPt = worldToScreen(item.pt.x, item.pt.y);
              const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
              if (d < closestDistScreen) {
                closestDistScreen = d;
                bestSnap = { point: item.pt, type: 'endpoint', elementId: el.id };
              }
            });
          }
        }
      } else if (el.type === 'island') {
        const island = el as IslandElement;
        if (island && island.points) {
          if (snapToEndpoint) {
            island.points.forEach((pt: Point2D) => {
              if (!pt || pt.x === undefined || pt.y === undefined) return;
              const screenPt = worldToScreen(pt.x, pt.y);
              const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
              if (d < closestDistScreen) {
                closestDistScreen = d;
                bestSnap = { point: pt, type: 'endpoint', elementId: el.id };
              }
            });
          }
        }
      } else if (el.type === 'crosswalk') {
        const cw = el as any;
        if (cw) {
          if (snapToEndpoint) {
            const pts = [cw.pA1, cw.pA2, cw.pB1, cw.pB2];
            pts.forEach(pt => {
              if (!pt || pt.x === undefined || pt.y === undefined) return;
              const screenPt = worldToScreen(pt.x, pt.y);
              const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
              if (d < closestDistScreen) {
                closestDistScreen = d;
                bestSnap = { point: pt, type: 'endpoint', elementId: el.id };
              }
            });
          }
          if (snapToMidpoint && !bestSnap) {
            if (cw.pA1 && cw.pA2 && cw.pB1 && cw.pB2 && cw.pA1.x !== undefined && cw.pA2.x !== undefined && cw.pB1.x !== undefined && cw.pB2.x !== undefined) {
              const midA = { x: (cw.pA1.x + cw.pA2.x) / 2, y: (cw.pA1.y + cw.pA2.y) / 2 };
              const midB = { x: (cw.pB1.x + cw.pB2.x) / 2, y: (cw.pB1.y + cw.pB2.y) / 2 };
              const midPoints = [midA, midB];
              midPoints.forEach(pt => {
                if (!pt || pt.x === undefined || pt.y === undefined) return;
                const screenPt = worldToScreen(pt.x, pt.y);
                const d = Math.hypot(sx - screenPt.x, sy - screenPt.y);
                if (d < closestDistScreen) {
                  closestDistScreen = d;
                  bestSnap = { point: pt, type: 'midpoint', elementId: el.id };
                }
              });
            }
          }
        }
      }
    });

    // 1.5 交點鎖點：只計算游標附近的線段，避免全圖兩兩比對
    if (snapToIntersection && (!bestSnap || (bestSnap as SnapTarget).type !== 'endpoint')) {
      const near: Array<{ id: string; a: Point2D; b: Point2D }> = [];
      const radiusWorld = 14 / viewport.zoom;
      elements.forEach(el => {
        if (!el || (excludeElementId && el.id === excludeElementId)) return;
        if (!(PATH_LINE_TYPES.has(el.type) || el.type === 'bicycle_lane')) return;
        const ref = getLineBezierRepresentation(el as any);
        if (!ref) return;
        const pts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 20);
        for (let i = 0; i < pts.length - 1; i++) {
          if (projectPointOnSegment(worldPos, pts[i], pts[i + 1]).dist < radiusWorld * 3) {
            near.push({ id: el.id, a: pts[i], b: pts[i + 1] });
          }
        }
      });
      for (let i = 0; i < near.length; i++) {
        for (let j = i + 1; j < near.length; j++) {
          if (near[i].id === near[j].id) continue;
          if (!lineSegmentsIntersect(near[i].a, near[i].b, near[j].a, near[j].b)) continue;
          const ip = getLineIntersection(near[i].a, near[i].b, near[j].a, near[j].b);
          if (!ip) continue;
          const sp = worldToScreen(ip.x, ip.y);
          const d = Math.hypot(sx - sp.x, sy - sp.y);
          if (d < closestDistScreen) {
            closestDistScreen = d;
            bestSnap = { point: ip, type: 'intersection', elementId: near[i].id };
          }
        }
      }
    }

    // 2. Check grid snap
    if (!bestSnap && snapToGrid && (minorGridInterval > 0 || majorGridInterval > 0)) {
      let snapInterval = minorGridInterval || majorGridInterval || 1.0;
      if (canvasRef.current && minorGridInterval > 0) {
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
      simInput.move(simPointer(e, sx, sy, activeWorldPos));
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

    if (activeTool === 'measurement' && spPoints.length === 1) {
      const perpSnap = findPerpendicularSnap(spPoints[0], literalWorld);
      if (perpSnap) {
        activeWorldPos = perpSnap.point;
        isPerpSnappedRef.current = true;
        perpSnapLineRef.current = {
          p1: spPoints[0],
          p2: perpSnap.point,
          targetA: perpSnap.targetA,
          targetB: perpSnap.targetB
        };
      } else {
        isPerpSnappedRef.current = false;
      }
    } else {
      isPerpSnappedRef.current = false;
    }

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
      if (activeHandle.nodeIndex === 25 || activeHandle.nodeIndex === 30) {
        // 拖曳方向即朝向：按住後往想要的方向拉，放開即確定；Shift 以 15° 為單位鎖定
        latestMouseWorldPosRef.current = activeWorldPos;
        const center = rotatingCenterRef.current;
        const target = elements.find(el => el.id === activeHandle.elementId) as any;
        if (center && target && distance(activeWorldPos, center) > 0.6) {
          let dir = Math.atan2(activeWorldPos.y - center.y, activeWorldPos.x - center.x);
          if (e.shiftKey) dir = Math.round(dir / (Math.PI / 12)) * (Math.PI / 12);
          if (activeHandle.nodeIndex === 30) {
            const newAngle = dir - Math.PI / 2;
            onUpdateElement({ ...target, angle: newAngle });
            setRoadArrowConfig?.({ arrowType: target.arrowType, length: target.length, angle: newAngle });
          } else {
            const Lp = target.length || 5.5;
            const Wp = target.width || 2.5;
            const c = Math.cos(dir), sn = Math.sin(dir);
            const newP1 = { x: center.x - (Lp / 2) * c + (Wp / 2) * sn, y: center.y - (Lp / 2) * sn - (Wp / 2) * c };
            const newP2 = { x: newP1.x + c * Lp, y: newP1.y + sn * Lp };
            onUpdateElement({ ...target, angle: dir, p1: newP1, p2: newP2 });
            setParkingStampConfig?.({ slotType: target.slotType, width: Wp, length: Lp, angle: dir });
          }
        }
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
        const newCpLeft = sp.cpLeft ? [...sp.cpLeft] : [...sp.points];
        const newCpRight = sp.cpRight ? [...sp.cpRight] : [...sp.points];

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
        
        const limit = cadMinPathRadius(designVehicle);
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
    const finalType = actualType === 'channelization' || actualType === 'grid_box' ? 'island' : actualType;

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
      const limit = cadMinPathRadius(designVehicle);
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

    const limit = cadMinPathRadius(designVehicle);
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
      ...(actualType === 'grid_box' ? { hatchPattern: 'cross', color: '#FFCC00' } : {}),
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
      // 點擊當下重新計算鎖點（觸控點擊前沒有移動事件）
      const rawPt = screenToWorld(sx, sy);
      const fresh = computeSnapPoint(rawPt, sx, sy);
      const pt = fresh ? fresh.point : rawPt;
      setSnapTarget(fresh);
      setMouseWorld(pt);
      if (simInput.down(simPointer(e, sx, sy, pt))) e.preventDefault();
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
      // 沒有進行中的繪製且有選取物件時，開啟右鍵選單
      if (spPoints.length === 0 && draftPoints.length === 0 && onContextAction && appMode === 'cad' && (selectedElement || selectedElementIds.length > 0 || canPaste)) {
        setContextMenu({ sx, sy });
        e.preventDefault();
        return;
      }
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

    // 點擊當下重新計算鎖點（觸控／手寫筆點擊前沒有游標移動，不能沿用上一次的鎖點結果）
    const rawClickPt = screenToWorld(sx, sy);
    const freshSnap = computeSnapPoint(rawClickPt, sx, sy);
    let clickPt = freshSnap ? freshSnap.point : rawClickPt;
    // Shift 正交鎖定：與預覽一致地套用到實際點下的位置
    if (e.shiftKey) {
      const prev = isLineOrPathTool(activeTool) && spPoints.length > 0
        ? spPoints[spPoints.length - 1]
        : (activeTool === 'crosswalk' && draftPoints.length > 0 ? draftPoints[draftPoints.length - 1] : null);
      if (prev) {
        clickPt = Math.abs(clickPt.x - prev.x) >= Math.abs(clickPt.y - prev.y)
          ? { x: clickPt.x, y: prev.y }
          : { x: prev.x, y: clickPt.y };
      }
    }

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
          el.type === 'white_solid' || el.type === 'red_solid' || el.type === 'yellow_solid' || 
          el.type === 'smart_path' ||
          el.type === 'BuildingLine' ||
          el.type === 'crossing_dashed' ||
          el.type === 'stop_line' ||
          el.type === 'yield_line' ||
          el.type === 'Sidewalk' ||
          el.type === 'reversible_lane' ||
          el.type === 'bicycle_lane' ||
          el.type === 'measurement'
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
          // 以文字外框（含旋轉）判斷，長字串點兩端也選得到
          const txt = el as any;
          const screenTxt = worldToScreen(txt.p.x, txt.p.y);
          const px = Math.max(9, (txt.fontSize || 1) * viewport.zoom);
          const halfW = (Array.from(String(txt.text || '')).reduce((w: number, ch: string) => w + (/[\x00-\x7f]/.test(ch) ? 0.55 : 1), 0) * px) / 2 + 4;
          const a = txt.angle || 0;
          const dx = sx - screenTxt.x, dy = sy - screenTxt.y;
          const u = dx * Math.cos(a) - dy * Math.sin(a);
          const v = dx * Math.sin(a) + dy * Math.cos(a);
          if (Math.abs(u) <= halfW && Math.abs(v) <= px / 2 + 4) {
            const d = Math.hypot(dx, dy) * 0.1;
            if (d < minDistanceScreen) { minDistanceScreen = d; selected = el; }
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
        } else if (el.type === 'road_text') {
          // 點在整串標字的外框內（含 4 px 容差）即選取
          const o = roadTextOutline(el as any).map(q => worldToScreen(q.x, q.y));
          let inside = false;
          for (let h = 0, k = o.length - 1; h < o.length; k = h++) {
            if (((o[h].y > sy) !== (o[k].y > sy)) && (sx < (o[k].x - o[h].x) * (sy - o[h].y) / (o[k].y - o[h].y) + o[h].x)) inside = !inside;
          }
          let d = Infinity;
          for (let h = 0; h < o.length; h++) {
            const q1 = o[h], q2 = o[(h + 1) % o.length];
            const dx = q2.x - q1.x, dy = q2.y - q1.y, l2 = dx * dx + dy * dy || 1;
            const t = Math.max(0, Math.min(1, ((sx - q1.x) * dx + (sy - q1.y) * dy) / l2));
            d = Math.min(d, Math.hypot(sx - q1.x - dx * t, sy - q1.y - dy * t));
          }
          if (inside || d < 4) { selected = el; minDistanceScreen = 0; }
        } else if (el.type === 'moto_box' || el.type === 'moto_turn_box') {
          // 以幾何原語判斷：點在填滿多邊形內、或靠近文字／外框
          const prims = getElementPrimitives(el);
          for (const pr of prims) {
            if (pr.kind === 'text') {
              const st = worldToScreen(pr.p.x, pr.p.y);
              const d = Math.hypot(sx - st.x, sy - st.y);
              const r = Math.max(10, pr.size * viewport.zoom * 0.6);
              if (d < r && d < minDistanceScreen + r) { minDistanceScreen = Math.min(minDistanceScreen, d); selected = el; }
            } else if (pr.kind === 'line' || pr.kind === 'poly') {
              const quad = pr.pts;
              let inside = false;
              for (let h = 0, k = quad.length - 1; h < quad.length; k = h++) {
                const xi = quad[h].x, yi = quad[h].y, xj = quad[k].x, yj = quad[k].y;
                if (((yi > clickPt.y) !== (yj > clickPt.y)) && (clickPt.x < (xj - xi) * (clickPt.y - yi) / (yj - yi) + xi)) inside = !inside;
              }
              if (inside) { selected = el; minDistanceScreen = 0; }
            }
          }
        } else if (el.type === 'angular_dimension') {
          const ang = el as AngularDimensionElement;
          const sCenter = worldToScreen(ang.center.x, ang.center.y);
          const dCenter = Math.hypot(sx - sCenter.x, sy - sCenter.y);
          
          let minD = dCenter;
          
          // edge 1: center to pStart1
          const proj1 = projectPointOnSegment(clickPt, ang.center, ang.pStart1);
          const sProj1 = worldToScreen(proj1.point.x, proj1.point.y);
          const dProj1 = Math.hypot(sx - sProj1.x, sy - sProj1.y);
          if (dProj1 < minD) minD = dProj1;
          
          // edge 2: center to pStart2
          const proj2 = projectPointOnSegment(clickPt, ang.center, ang.pStart2);
          const sProj2 = worldToScreen(proj2.point.x, proj2.point.y);
          const dProj2 = Math.hypot(sx - sProj2.x, sy - sProj2.y);
          if (dProj2 < minD) minD = dProj2;
          
          if (minD < minDistanceScreen) {
            minDistanceScreen = minD;
            selected = el;
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
    if (isLineOrPathTool(activeTool) && !(activeTool === 'measurement' && spPoints.length === 1)) {
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

      // 3.0 Close path if clicking near first anchor point - DELETED, Enter/V key only
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
      return;
    }

    // 4.6. Road Arrow drafting - Stamp Mode
    if (activeTool === 'road_arrow') {
      const newId = `arrow-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
      const stampType = roadArrowConfig?.arrowType || 'straight';
      const stampLength = roadArrowConfig?.length || 5.0;
      // 自動對齊車道行車方向（找不到車道線時沿用上次角度）
      const lastAngle = roadArrowConfig?.angle || 0;
      const heading = suggestHeading(clickPt, elements, lastAngle + Math.PI / 2);
      const stampAngle = heading !== null ? heading - Math.PI / 2 : lastAngle;

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
      return;
    }

    // 5. Channelization island closed drafting has been moved to Bezier path builder (same as Sidewalk)

    // 5.4. 機車停等區／待轉區：第 1、2 點為前緣（靠停止線），第 3 點決定深度
    if (activeTool === 'moto_box' || activeTool === 'moto_turn_box') {
      if (draftPoints.length < 2) {
        setDraftPoints([...draftPoints, clickPt]);
        return;
      }
      let [a, b] = draftPoints;
      const len = distance(a, b) || 1;
      let depth = ((b.x - a.x) * (clickPt.y - a.y) - (b.y - a.y) * (clickPt.x - a.x)) / len;
      if (depth < 0) { [a, b] = [b, a]; depth = -depth; }
      const boxEl: CadElement = {
        id: `${activeTool}-${Date.now()}`,
        type: activeTool,
        p1: a,
        p2: b,
        depth: Math.max(0.5, depth),
      } as any;
      onAddElement(boxEl);
      onSelectElement(boxEl);
      setDraftPoints([]);
      return;
    }

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

    // 8. Angular Dimension Tool (3-point style)
    if (activeTool === 'angular_dimension') {
      const nextPoints = [...spPoints, clickPt];
      if (nextPoints.length < 3) {
        setSpPoints(nextPoints);
      } else {
        const center = nextPoints[0];
        const pStart1 = nextPoints[1];
        const pStart2 = nextPoints[2];

        const v1 = { x: pStart1.x - center.x, y: pStart1.y - center.y };
        const v2 = { x: pStart2.x - center.x, y: pStart2.y - center.y };
        const d1 = Math.hypot(v1.x, v1.y);
        const d2 = Math.hypot(v2.x, v2.y);

        let angleDeg = 0;
        if (d1 > 0.0001 && d2 > 0.0001) {
          const cosTheta = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (d1 * d2)));
          const angleRad = Math.acos(cosTheta);
          angleDeg = parseFloat((angleRad * 180 / Math.PI).toFixed(1));
        }

        const newId = `angle-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const angleEl: CadElement = {
          id: newId,
          type: 'angular_dimension',
          center,
          pStart1,
          pStart2,
          angleDeg
        };
        onAddElement(angleEl);
        onSelectElement(angleEl);
        setSpPoints([]);
      }
      return;
    }

    // 9. 3-point Arc Tool (with control points initialized to prevent white screen crash)
    if (activeTool === 'arc_3point') {
      const nextPoints = [...spPoints, clickPt];
      if (nextPoints.length < 3) {
        setSpPoints(nextPoints);
      } else {
        const p1 = nextPoints[0];
        const p2 = nextPoints[1];
        const p3 = nextPoints[2];
        const arcPts = getArcFromThreePoints(p1, p2, p3, 30);
        
        const newId = `arc-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const arcEl: CadElement = {
          id: newId,
          type: 'white_solid',
          points: arcPts,
          cpLeft: arcPts,
          cpRight: arcPts,
          lineWidth: 0.15
        } as any;
        onAddElement(arcEl);
        onSelectElement(arcEl);
        setSpPoints([]);
      }
      return;
    }

    // 6. 文字標註／路面標字：於點擊處開啟內嵌輸入框（不使用瀏覽器 prompt，沙盒環境也能用）
    if (activeTool === 'text_label' || activeTool === 'road_text') {
      e.stopPropagation();
      e.preventDefault();
      const sp = worldToScreen(clickPt.x, clickPt.y);
      setTextDraft({
        kind: activeTool === 'road_text' ? 'road_text' : 'text',
        p: clickPt,
        sx: sp.x,
        sy: sp.y,
        value: activeTool === 'road_text' ? lastRoadTextRef.current : '',
      });
      return;
    }

    // 7. Measurement Tool
    if (activeTool === 'measurement') {
      if (spPoints.length === 0) {
        setSpPoints([clickPt]);
      } else {
        const p1 = spPoints[0];
        // 如果有垂線吸附，使用吸附點，否則使用 clickPt
        const p2 = isPerpSnappedRef.current && perpSnapLineRef.current ? perpSnapLineRef.current.p2 : clickPt;
        const newId = `meas-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
        const measEl: CadElement = {
          id: newId,
          type: 'measurement',
          points: [p1, p2],
        };
        onAddElement(measEl);
        onSelectElement(measEl);
        setSpPoints([]);
      }
      return;
    }
  };

  const handlePointerUp = () => {
    setIsPanning(false);

    if (appMode === 'simulation') {
      if (lastSimPointer.current) simInput.up(lastSimPointer.current);
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
    if (appMode === 'simulation') {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
      const rawPt = screenToWorld(sx, sy);
      const fresh = computeSnapPoint(rawPt, sx, sy);
      simInput.doubleClick(simPointer(e, sx, sy, fresh ? fresh.point : rawPt));
      return;
    }
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


    const whiteColor = '#ffffff';
    const yellowColor = '#f59e0b';
    const yellowDashedColor = '#eab308';
    const primaryLineColor = '#ffffff';
    const textDrawColor = '#e2e8f0';

    // Clear Screen
    ctx.fillStyle = canvasBackground;
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
      
      // Minor Grid (dotted slate)
      if (minorGridInterval > 0) {
        const startX = Math.floor(minXWorld / minorGridInterval) * minorGridInterval;
        const endX = Math.ceil(maxXWorld / minorGridInterval) * minorGridInterval;
        const startY = Math.floor(minYWorld / minorGridInterval) * minorGridInterval;
        const endY = Math.ceil(maxYWorld / minorGridInterval) * minorGridInterval;

        ctx.strokeStyle = '#1a1d24';
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
      }

      // Major Grid & Axes
      if (majorGridInterval > 0) {
        ctx.strokeStyle = '#292d38';
        ctx.setLineDash([]);
        for (let x = Math.floor(minXWorld / majorGridInterval) * majorGridInterval; x <= maxXWorld; x += majorGridInterval) {
          const screenPt = worldToScreen(x, 0);
          ctx.beginPath();
          ctx.moveTo(screenPt.x, 0);
          ctx.lineTo(screenPt.x, canvas.height);
          ctx.stroke();

          if (zoom > 4) {
            ctx.fillStyle = '#525a6c';
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
            ctx.fillStyle = '#525a6c';
            ctx.font = '8px monospace';
            ctx.fillText(`${y}m`, 8, screenPt.y - 3);
          }
        }
      }

      // Primary central axes coordinate crosses
      const origin = worldToScreen(0, 0);
      ctx.strokeStyle = editA(0.28);
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
        el.type === 'white_solid' || el.type === 'red_solid' || el.type === 'yellow_solid' || 
        el.type === 'BuildingLine' ||
        el.type === 'crossing_dashed' ||
        el.type === 'stop_line' ||
        el.type === 'yield_line' || 
        el.type === 'Sidewalk'
      ) {
        const line = el as any;
        const ref = getLineBezierRepresentation(line);

        if (ref) {
          // 標線本體：與 PNG／DXF 匯出共用同一份幾何（src/markings.ts）
          renderPrimitives(ctx, getElementPrimitives(el), { zoom, w2s: worldToScreen, palette: 'screen' });
          if (isSelected && el.type === 'bicycle_lane') {
            renderPrimitives(ctx, getElementPrimitives(el), { zoom, w2s: worldToScreen, palette: 'screen', overrideColor: EDIT });
          }

          // Render anchors and symmetric guidelines if selected!
          if (isSelected) {
            ref.points.forEach((pt, j) => {
              const ptS = worldToScreen(pt.x, pt.y);

              if (ref.cpLeft[j] && ref.cpRight[j]) {
                ctx.strokeStyle = editA(0.45);
                ctx.lineWidth = 1;
                const cpLeftS = worldToScreen(ref.cpLeft[j].x, ref.cpLeft[j].y);
                const cpRightS = worldToScreen(ref.cpRight[j].x, ref.cpRight[j].y);

                ctx.beginPath();
                ctx.moveTo(cpLeftS.x, cpLeftS.y);
                ctx.lineTo(cpRightS.x, cpRightS.y);
                ctx.stroke();

                ctx.fillStyle = EDIT; // 控制把手
                ctx.beginPath();
                ctx.arc(cpLeftS.x, cpLeftS.y, 3.5, 0, 2 * Math.PI);
                ctx.arc(cpRightS.x, cpRightS.y, 3.5, 0, 2 * Math.PI);
                ctx.fill();
              }

              const isAnchorSelected = selectedAnchorIndices?.includes(j);
              ctx.fillStyle = isAnchorSelected ? EDIT : EDIT_BG; // 選取的節點為實心，其餘為空心
              ctx.strokeStyle = EDIT;
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
        ctx.strokeStyle = editA(0.35); 
        ctx.lineWidth = Math.max(1.5, zoom * 0.08);
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(sCenter.x, sCenter.y, circ.radius * zoom, 0, 2 * Math.PI);
        ctx.stroke();
        ctx.setLineDash([]);

        // Little dynamic center cursor
        ctx.strokeStyle = editA(0.55);
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
          ctx.fillStyle = EDIT;
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
          ctx.fillStyle = EDIT;
          ctx.beginPath();
          ctx.arc(O1s.x, O1s.y, 4, 0, 2*Math.PI);
          ctx.arc(O2s.x, O2s.y, 4, 0, 2*Math.PI);
          ctx.arc(O3s.x, O3s.y, 4, 0, 2*Math.PI);
          ctx.fill();
        }

        ctx.strokeStyle = EDIT;
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

        ctx.fillStyle = EDIT;
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
        
        ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
        ctx.fill();

        // 外框與斜紋：與匯出共用同一份幾何（間距、線寬可於屬性面板調整）
        renderPrimitives(ctx, getElementPrimitives(el), { zoom, w2s: worldToScreen, palette: 'screen' });

        if (isSelected) {
          const ref = getLineBezierRepresentation(island);
          if (ref) {
            ref.points.forEach((pt: Point2D, j: number) => {
              const ptS = worldToScreen(pt.x, pt.y);

              if (ref.cpLeft[j] && ref.cpRight[j]) {
                ctx.strokeStyle = editA(0.45);
                ctx.lineWidth = 1;
                const cpLeftS = worldToScreen(ref.cpLeft[j].x, ref.cpLeft[j].y);
                const cpRightS = worldToScreen(ref.cpRight[j].x, ref.cpRight[j].y);

                ctx.beginPath();
                ctx.moveTo(cpLeftS.x, cpLeftS.y);
                ctx.lineTo(cpRightS.x, cpRightS.y);
                ctx.stroke();

                ctx.fillStyle = EDIT; // 控制把手
                ctx.beginPath();
                ctx.arc(cpLeftS.x, cpLeftS.y, 3.5, 0, 2 * Math.PI);
                ctx.arc(cpRightS.x, cpRightS.y, 3.5, 0, 2 * Math.PI);
                ctx.fill();
              }

              const isAnchorSelected = selectedAnchorIndices?.includes(j);
              ctx.fillStyle = isAnchorSelected ? EDIT : EDIT_BG; // 選取的節點為實心，其餘為空心
              ctx.strokeStyle = EDIT;
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
        const pxFontSize = Math.max(9, txt.fontSize * zoom);
        ctx.save();
        ctx.translate(screenPt.x, screenPt.y);
        ctx.rotate(-(txt.angle || 0));
        ctx.fillStyle = textDrawColor;
        ctx.font = `${pxFontSize}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(txt.text, 0, 0);

        if (isSelected) {
          const boxw = ctx.measureText(txt.text).width + 12;
          const boxh = pxFontSize + 8;
          ctx.strokeStyle = EDIT;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(-boxw / 2, -boxh / 2, boxw, boxh);
          ctx.stroke();
        }
        ctx.restore();
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
          ctx.fillStyle = isSelected ? editA(0.35) : editA(0.20);
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
            ctx.strokeStyle = EDIT;
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

              ctx.fillStyle = editA(0.16);
              ctx.strokeStyle = EDIT;
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
            ctx.strokeStyle = angle > getMaxSteerForVehicle(pathVehicle) ? '#ef4444' : EDIT; // 超過該車種最大轉角為紅色
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

            ctx.strokeStyle = editA(0.55); // 控制把手連線
            ctx.lineWidth = 1;
            const cpLeftS = worldToScreen(sp.cpLeft[j].x, sp.cpLeft[j].y);
            const cpRightS = worldToScreen(sp.cpRight[j].x, sp.cpRight[j].y);

            ctx.beginPath();
            ctx.moveTo(cpLeftS.x, cpLeftS.y);
            ctx.lineTo(cpRightS.x, cpRightS.y);
            ctx.stroke();

            ctx.fillStyle = EDIT; // 控制把手
            ctx.beginPath();
            ctx.arc(cpLeftS.x, cpLeftS.y, 3.5, 0, 2 * Math.PI);
            ctx.arc(cpRightS.x, cpRightS.y, 3.5, 0, 2 * Math.PI);
            ctx.fill();

            const isAnchorSelected = selectedAnchorIndices?.includes(j);
            ctx.fillStyle = isAnchorSelected ? EDIT : EDIT_BG; // 選取的節點為實心，其餘為空心
            ctx.strokeStyle = EDIT;
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
        ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
        
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
          ctx.strokeStyle = EDIT;
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
        ctx.fillStyle = isSelected ? editA(0.22) : 'rgba(255, 255, 255, 0.05)';

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(L * zoom, 0);
        ctx.lineTo(L * zoom, -W * zoom);
        ctx.lineTo(0, -W * zoom);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (pk.showSizeLabel !== false && Math.min(W, L) * zoom > 46) {
          ctx.fillStyle = isSelected ? EDIT : 'rgba(255, 255, 255, 0.55)';
          ctx.font = '9px JetBrains Mono, monospace, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          const labelText = pk.slotType === 'car' ? '汽車' : '機車';
          const sizeText = `${W.toFixed(1)}x${L.toFixed(1)}m`;
          const cx = (L / 2) * zoom;
          const cy = -(W / 2) * zoom;
          ctx.fillText(labelText, cx, cy - 6);
          ctx.fillText(sizeText, cx, cy + 6);
        }
        ctx.restore();

        // Draw handles in world space - Single Center Rotation Handle
        if (isSelected) {
          const center = getParkingSpaceCenter(pk);
          const hs = worldToScreen(center.x, center.y);
          ctx.fillStyle = EDIT; // 夾點
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
          
          ctx.strokeStyle = isSelected ? EDIT : whiteColor;
          ctx.lineWidth = isSelected ? Math.max(2, zoom * 0.08) : Math.max(1, zoom * 0.03);
          ctx.fillStyle = isSelected ? editA(0.25) : whiteColor;

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
            // 插入點：小方塊，不遮住箭頭本體
            const hs = worldToScreen(arrow.p.x, arrow.p.y);
            ctx.fillStyle = '#ffffff';
            ctx.strokeStyle = EDIT;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.rect(hs.x - 3.5, hs.y - 3.5, 7, 7);
            ctx.fill();
            ctx.stroke();
          }
        }
      } else if (el.type === 'parking_zone') {
        const zone = el as any;
        const ref = getLineBezierRepresentation(zone);
        if (ref) {
          ctx.save();
          ctx.strokeStyle = isSelected ? editA(0.4) : 'rgba(255, 255, 255, 0.15)';
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
          ctx.fillStyle = isSelected ? editA(0.22) : 'rgba(255, 255, 255, 0.05)';

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

          if ((el as any).showSizeLabel !== false && Math.min(slot.width, slot.length) * zoom > 46) {
            ctx.fillStyle = isSelected ? EDIT : 'rgba(255, 255, 255, 0.55)';
            ctx.font = '9px JetBrains Mono, monospace, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const cx = (s1.x + s2.x + s3.x + s4.x) / 4;
            const cy = (s1.y + s2.y + s3.y + s4.y) / 4;
            const labelText = slot.slotType === 'car' ? '汽車' : '機車';
            const sizeText = `${slot.width}x${slot.length}m`;
            ctx.fillText(labelText, cx, cy - 6);
            ctx.fillText(sizeText, cx, cy + 6);
          }
          ctx.restore();
        });
      } else if (el.type === 'measurement') {
        const meas = el as MeasurementElement;
        if (meas.points && meas.points.length === 2) {
          const p1 = meas.points[0];
          const p2 = meas.points[1];
          const s1 = worldToScreen(p1.x, p1.y);
          const s2 = worldToScreen(p2.x, p2.y);
          
          ctx.save();
          ctx.strokeStyle = isSelected ? EDIT : '#fb923c';
          ctx.lineWidth = isSelected ? 2.5 : 1.5;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.stroke();
          ctx.setLineDash([]);

          const angle = Math.atan2(s2.y - s1.y, s2.x - s1.x);
          const drawTick = (sx: number, sy: number) => {
            ctx.save();
            ctx.translate(sx, sy);
            ctx.rotate(angle + Math.PI / 4);
            ctx.strokeStyle = isSelected ? EDIT : '#fb923c';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(0, -6);
            ctx.lineTo(0, 6);
            ctx.stroke();
            ctx.restore();
          };
          drawTick(s1.x, s1.y);
          drawTick(s2.x, s2.y);

          const midX = (s1.x + s2.x) / 2;
          const midY = (s1.y + s2.y) / 2;
          const distWorld = distance(p1, p2);
          const text = `${distWorld.toFixed(2)} m`;
          
          ctx.font = '10px JetBrains Mono, monospace, sans-serif';
          const textWidth = ctx.measureText(text).width;
          ctx.fillStyle = 'rgba(15, 17, 21, 0.85)';
          ctx.fillRect(midX - textWidth / 2 - 4, midY - 7, textWidth + 8, 14);
          
          ctx.fillStyle = '#f8fafc';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(text, midX, midY);
          ctx.restore();
        }
      } else if (el.type === 'moto_box' || el.type === 'moto_turn_box' || el.type === 'road_text') {
        renderPrimitives(ctx, getElementPrimitives(el), { zoom, w2s: worldToScreen, palette: 'screen', overrideColor: isSelected ? EDIT : undefined });
      } else if (el.type === 'angular_dimension') {
        const angEl = el as AngularDimensionElement;
        const sCenter = worldToScreen(angEl.center.x, angEl.center.y);
        const sStart1 = worldToScreen(angEl.pStart1.x, angEl.pStart1.y);
        const sStart2 = worldToScreen(angEl.pStart2.x, angEl.pStart2.y);

        const a1 = Math.atan2(sStart1.y - sCenter.y, sStart1.x - sCenter.x);
        const a2 = Math.atan2(sStart2.y - sCenter.y, sStart2.x - sCenter.x);

        ctx.save();
        ctx.strokeStyle = isSelected ? EDIT : '#ec4899';
        ctx.lineWidth = isSelected ? 1.5 : 1.0;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(sCenter.x, sCenter.y);
        ctx.lineTo(sStart1.x, sStart1.y);
        ctx.moveTo(sCenter.x, sCenter.y);
        ctx.lineTo(sStart2.x, sStart2.y);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = isSelected ? EDIT : '#ec4899';
        ctx.lineWidth = isSelected ? 2.5 : 1.5;
        
        const radius = 30;
        ctx.beginPath();
        let diff = a2 - a1;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;

        ctx.arc(sCenter.x, sCenter.y, radius, a1, a1 + diff, diff < 0);
        ctx.stroke();

        const midAngle = a1 + diff / 2;
        const textRadius = radius + 14;
        const tx = sCenter.x + Math.cos(midAngle) * textRadius;
        const ty = sCenter.y + Math.sin(midAngle) * textRadius;

        const text = `${angEl.angleDeg.toFixed(1)}°`;
        ctx.font = '10px JetBrains Mono, monospace, sans-serif';
        const textWidth = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(15, 17, 21, 0.85)';
        ctx.fillRect(tx - textWidth / 2 - 3, ty - 7, textWidth + 6, 14);

        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tx, ty);
        ctx.restore();
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

      ctx.strokeStyle = editA(0.75);
      ctx.lineWidth = Math.max(1.5, zoom * 0.1);
      ctx.fillStyle = editA(0.18);
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
        ctx.strokeStyle = editA(0.75);
        ctx.lineWidth = Math.max(1.5, zoom * 0.05);
        ctx.fillStyle = editA(0.18);
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
    // 7. Measurement Tool Preview
    if (activeTool === 'measurement' && spPoints.length === 1) {
      const p1 = spPoints[0];
      const p2 = isPerpSnappedRef.current && perpSnapLineRef.current ? perpSnapLineRef.current.p2 : mouseWorld;
      
      const s1 = worldToScreen(p1.x, p1.y);
      const s2 = worldToScreen(p2.x, p2.y);
      
      ctx.save();
      ctx.strokeStyle = EDIT;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(s1.x, s1.y);
      ctx.lineTo(s2.x, s2.y);
      ctx.stroke();
      ctx.setLineDash([]);

      const angle = Math.atan2(s2.y - s1.y, s2.x - s1.x);
      const drawTick = (sx: number, sy: number) => {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(angle + Math.PI / 4);
        ctx.strokeStyle = EDIT;
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(0, 6);
        ctx.stroke();
        ctx.restore();
      };
      drawTick(s1.x, s1.y);
      drawTick(s2.x, s2.y);

      const midX = (s1.x + s2.x) / 2;
      const midY = (s1.y + s2.y) / 2;
      const distWorld = distance(p1, p2);
      const text = `${distWorld.toFixed(2)} m`;
      ctx.font = '10px JetBrains Mono, monospace, sans-serif';
      const textWidth = ctx.measureText(text).width;
      // ctx.fillRect(midX - textWidth / 2 - 4, midY - 7, textWidth + 8, 14);
      
      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, midX, midY);

      if (isPerpSnappedRef.current && perpSnapLineRef.current) {
        const targetA_S = worldToScreen(perpSnapLineRef.current.targetA.x, perpSnapLineRef.current.targetA.y);
        const targetB_S = worldToScreen(perpSnapLineRef.current.targetB.x, perpSnapLineRef.current.targetB.y);
        const lineDir = normalize({ x: targetB_S.x - targetA_S.x, y: targetB_S.y - targetA_S.y });
        const perpDir = normalize({ x: s1.x - s2.x, y: s1.y - s2.y });
        const size = 8;
        const corner1 = { x: s2.x + perpDir.x * size, y: s2.y + perpDir.y * size };
        const corner2 = { x: s2.x + lineDir.x * size, y: s2.y + lineDir.y * size };
        const corner3 = { x: corner2.x + perpDir.x * size, y: corner2.y + perpDir.y * size };
        
        ctx.strokeStyle = EDIT;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(corner1.x, corner1.y);
        ctx.lineTo(corner3.x, corner3.y);
        ctx.lineTo(corner2.x, corner2.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 8. Angular Dimension Preview (3-point collection style)
    if (activeTool === 'angular_dimension' && spPoints.length > 0) {
      ctx.save();
      const center = spPoints[0];
      const sCenter = worldToScreen(center.x, center.y);
      const sMouse = worldToScreen(mouseWorld.x, mouseWorld.y);

      if (spPoints.length === 1) {
        // Draw helper dashed line from center to mouse
        ctx.strokeStyle = editA(0.75);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sCenter.x, sCenter.y);
        ctx.lineTo(sMouse.x, sMouse.y);
        ctx.stroke();
      } else if (spPoints.length === 2) {
        const pStart1 = spPoints[1];
        const sStart1 = worldToScreen(pStart1.x, pStart1.y);

        // Draw solid line from center to pStart1
        ctx.strokeStyle = EDIT;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sCenter.x, sCenter.y);
        ctx.lineTo(sStart1.x, sStart1.y);
        ctx.stroke();

        // Draw helper dashed line from center to mouse
        ctx.strokeStyle = editA(0.75);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sCenter.x, sCenter.y);
        ctx.lineTo(sMouse.x, sMouse.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Calculate and draw real-time arc & angle preview text
        const a1 = Math.atan2(sStart1.y - sCenter.y, sStart1.x - sCenter.x);
        const a2 = Math.atan2(sMouse.y - sCenter.y, sMouse.x - sCenter.x);

        let diff = a2 - a1;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;

        const radius = 24; // 24px
        ctx.strokeStyle = EDIT;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sCenter.x, sCenter.y, radius, a1, a1 + diff, diff < 0);
        ctx.stroke();

        // Calculate degree
        const v1 = { x: pStart1.x - center.x, y: pStart1.y - center.y };
        const v2 = { x: mouseWorld.x - center.x, y: mouseWorld.y - center.y };
        const d1 = Math.hypot(v1.x, v1.y);
        const d2 = Math.hypot(v2.x, v2.y);
        let angleDeg = 0;
        if (d1 > 0.0001 && d2 > 0.0001) {
          const cosTheta = Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (d1 * d2)));
          const angleRad = Math.acos(cosTheta);
          angleDeg = parseFloat((angleRad * 180 / Math.PI).toFixed(1));
        }

        const midAngle = a1 + diff / 2;
        const textRadius = radius + 14;
        const tx = sCenter.x + Math.cos(midAngle) * textRadius;
        const ty = sCenter.y + Math.sin(midAngle) * textRadius;

        const text = `${angleDeg.toFixed(1)}°`;
        ctx.font = '10px JetBrains Mono, monospace, sans-serif';
        const textWidth = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(15, 17, 21, 0.85)';
        ctx.fillRect(tx - textWidth / 2 - 3, ty - 7, textWidth + 6, 14);

        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, tx, ty);
      }
      ctx.restore();
    }

    // 9. 3-point Arc Preview
    if (activeTool === 'arc_3point' && spPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = editA(0.75);
      ctx.lineWidth = Math.max(1.5, zoom * 0.1);
      ctx.setLineDash([4, 4]);

      if (spPoints.length === 1) {
        const s1 = worldToScreen(spPoints[0].x, spPoints[0].y);
        const sMouse = worldToScreen(mouseWorld.x, mouseWorld.y);
        ctx.beginPath();
        ctx.moveTo(s1.x, s1.y);
        ctx.lineTo(sMouse.x, sMouse.y);
        ctx.stroke();
      } else if (spPoints.length === 2) {
        const p1 = spPoints[0];
        const p2 = spPoints[1];
        const p3 = mouseWorld;
        const arcPts = getArcFromThreePoints(p1, p2, p3, 30);
        
        ctx.beginPath();
        arcPts.forEach((pt, idx) => {
          const s = worldToScreen(pt.x, pt.y);
          if (idx === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.stroke();
      }
      ctx.restore();
    }

    // DRAW INTERACTIVE DRAFT TEMPORARY GRAPHICS
    if (draftPoints.length > 0) {
      ctx.setLineDash([4, 4]);

      if (activeTool === 'sketch_circle') {
        if (draftPoints.length === 1) {
          const sCenter = worldToScreen(draftPoints[0].x, draftPoints[0].y);
          const r = distance(draftPoints[0], mouseWorld);
          ctx.strokeStyle = editA(0.55);
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

          ctx.strokeStyle = editA(0.7);
          ctx.lineWidth = Math.max(1.5, zoom * 0.1);
          ctx.fillStyle = editA(0.18);

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
        ctx.strokeStyle = EDIT; // 外框
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
          ctx.fillStyle = EDIT;
          ctx.fillRect(sA1.x - 4, sA1.y - 4, 8, 8);
        } else if (draftPoints.length === 2 && sA1 && sA2) {
          // Line A is fixed. From A2, drawing to click B1
          ctx.beginPath();
          ctx.moveTo(sA1.x, sA1.y);
          ctx.lineTo(sA2.x, sA2.y);
          ctx.stroke();

          ctx.strokeStyle = editA(0.45);
          ctx.beginPath();
          ctx.moveTo(sA2.x, sA2.y);
          ctx.lineTo(sMouse.x, sMouse.y);
          ctx.stroke();

          ctx.fillStyle = EDIT;
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
          ctx.strokeStyle = editA(0.4); // amber translucency
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

          ctx.fillStyle = EDIT;
          ctx.fillRect(sA1.x - 4, sA1.y - 4, 8, 8);
          ctx.fillRect(sA2.x - 4, sA2.y - 4, 8, 8);
          ctx.fillStyle = EDIT;
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
          ctx.shadowColor = isEndpoint ? EDIT : EDIT;
          ctx.fillStyle = isEndpoint ? EDIT : EDIT;
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

    // 機車停等區／待轉區繪製預覽
    if ((activeTool === 'moto_box' || activeTool === 'moto_turn_box') && draftPoints.length > 0) {
      if (draftPoints.length === 1) {
        const a = worldToScreen(draftPoints[0].x, draftPoints[0].y);
        const m = worldToScreen(mouseWorld.x, mouseWorld.y);
        ctx.save();
        ctx.strokeStyle = editA(0.8);
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(m.x, m.y); ctx.stroke();
        ctx.restore();
      } else {
        let [a, b] = draftPoints;
        const len = distance(a, b) || 1;
        let depth = ((b.x - a.x) * (mouseWorld.y - a.y) - (b.y - a.y) * (mouseWorld.x - a.x)) / len;
        if (depth < 0) { [a, b] = [b, a]; depth = -depth; }
        const preview = { id: '__preview__', type: activeTool, p1: a, p2: b, depth: Math.max(0.5, depth) } as any;
        renderPrimitives(ctx, getElementPrimitives(preview), { zoom, w2s: worldToScreen, palette: 'screen', overrideColor: editA(0.9) });
      }
    }

    // DRAW ACTIVE BEZIER PEN CURVE DRAFTS (shared by guideline, yellow_double, white_dashed, white_solid, and smart_path!)
    if (isLineOrPathTool(activeTool) && spPoints.length > 0) {
      ctx.lineWidth = Math.max(2, zoom * 0.15);
      
      const lastPtS = worldToScreen(spPoints[spPoints.length - 1].x, spPoints[spPoints.length - 1].y);
      const mS = worldToScreen(mouseWorld.x, mouseWorld.y);

      // Special Dynamic Pavement Enclosure preview for Sidewalk & channelization tool
      if (activeTool === 'Sidewalk' || activeTool === 'channelization' || activeTool === 'grid_box') {
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
        ctx.fillStyle = activeTool === 'channelization' || activeTool === 'grid_box'
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
        ctx.strokeStyle = editA(0.45);
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
      const isPavement = activeTool === 'Sidewalk' || activeTool === 'channelization' || activeTool === 'grid_box';
      if (isSmartPath || isPavement) {
        ctx.strokeStyle = editA(0.4);
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
          ctx.strokeStyle = angle > getMaxSteerForVehicle(designVehicle) ? '#ef4444' : EDIT; // 超過該車種最大轉角為紅色
          ctx.beginPath();
          const s1 = worldToScreen(pCurr.x, pCurr.y);
          const s2 = worldToScreen(pNext.x, pNext.y);
          ctx.moveTo(s1.x, s1.y);
          ctx.lineTo(s2.x, s2.y);
          ctx.stroke();
        }
      } else if (activeTool !== 'Sidewalk' && activeTool !== 'channelization' && activeTool !== 'grid_box') {
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
          // 預覽與完成後外觀一致：直接使用共用幾何原語
          ctx.lineCap = 'butt';
          ctx.lineJoin = 'miter';
          ctx.setLineDash([]);

          if (activeTool !== 'parking_zone' && activeTool !== 'measurement') {
            const previewEl = {
              id: '__preview__',
              type: activeTool,
              points: previewPoints,
              cpLeft: previewCpLeft,
              cpRight: previewCpRight,
              sgn: 1,
              width: 1.5,
            } as any;
            renderPrimitives(ctx, getElementPrimitives(previewEl), { zoom, w2s: worldToScreen, palette: 'screen' });
          } else if (activeTool === 'parking_zone') {
            ctx.save();
            ctx.strokeStyle = editA(0.85);
            ctx.lineWidth = 1.5;
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

            if (previewPoints.length >= 2) {
              const tempZone = {
                points: previewPoints,
                cpLeft: previewCpLeft,
                cpRight: previewCpRight,
                slotType: parkingZoneConfig?.slotType || 'car',
                width: parkingZoneConfig?.width || 2.0,
                length: parkingZoneConfig?.length || 5.0,
                angle: parkingZoneConfig?.angle !== undefined ? parkingZoneConfig.angle : 90,
                gap: parkingZoneConfig?.gap !== undefined ? parkingZoneConfig.gap : 0.2,
                side: parkingZoneConfig?.side || 'right'
              };
              try {
                const slots = generateParkingZoneSlots(tempZone);
                slots.forEach((slot) => {
                  ctx.save();
                  ctx.lineCap = 'round';
                  ctx.lineJoin = 'round';
                  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
                  ctx.lineWidth = Math.max(1.0, zoom * 0.05);
                  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
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
                  ctx.restore();
                });
              } catch (err) {
                console.error("Error generating preview parking slots:", err);
              }
            }
          }
        }
      }

      // Draw interactive handles
      spPoints.forEach((pt, j) => {
        const ptS = worldToScreen(pt.x, pt.y);

        ctx.strokeStyle = editA(0.45);
        ctx.lineWidth = 1;
        const cpLeftS = worldToScreen(spCpLeft[j].x, spCpLeft[j].y);
        const cpRightS = worldToScreen(spCpRight[j].x, spCpRight[j].y);

        ctx.beginPath();
        ctx.moveTo(cpLeftS.x, cpLeftS.y);
        ctx.lineTo(cpRightS.x, cpRightS.y);
        ctx.stroke();

        ctx.fillStyle = EDIT;
        ctx.beginPath();
        ctx.arc(cpLeftS.x, cpLeftS.y, 3, 0, 2 * Math.PI);
        ctx.arc(cpRightS.x, cpRightS.y, 3, 0, 2 * Math.PI);
        ctx.fill();

        const isFirstAndClosing = (j === 0 && isClosingPathDrag);
        ctx.fillStyle = isFirstAndClosing ? EDIT : EDIT_BG;
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
        if (el.type === 'BuildingLine' || el.type === 'guideline' || el.type === 'yellow_double' || el.type === 'white_dashed' || el.type === 'yellow_dashed' || el.type === 'white_solid' || el.type === 'red_solid' || el.type === 'yellow_solid' || el.type === 'smart_path' || el.type === 'parking_zone') {
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
          for (const lineEl of elements.filter(e => e.type === 'yellow_double' || e.type === 'white_solid' || e.type === 'red_solid' || e.type === 'yellow_solid' || e.type === 'white_dashed' || e.type === 'yellow_dashed')) {
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
            : editA(0.08);

        ctx.strokeStyle = isHardCollision 
          ? 'rgba(239, 68, 68, 0.5)' 
          : isSoftCollision 
            ? 'rgba(234, 179, 8, 0.5)' 
            : editA(0.35);
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

          ctx.fillStyle = isHardCollision ? 'rgba(239, 68, 68, 0.28)' : editA(0.12);
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
          ctx.fillStyle = isHardCollision ? '#f87171' : EDIT;
          ctx.font = '8px sans-serif';
          ctx.fillText(designVehicle === 'articulated' ? '聯結車' : designVehicle === 'semi_trailer' ? '大型車' : '小型車', s1.x, s1.y - 4);

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
        ctx.strokeStyle = EDIT; // 旋轉把手連線
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(sTop.x, sTop.y);
        ctx.lineTo(sRot.x, sRot.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = EDIT; // 旋轉把手
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sRot.x, sRot.y, 6.5, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // 軌跡模擬模式：游標十字線（模擬圖形由 SimulationLayer 覆蓋層繪製）
    if (appMode === 'simulation' && zoom > 1.5) {
      const mouseS = worldToScreen(mouseWorld.x, mouseWorld.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
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
      ctx.strokeStyle = EDIT;
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
        ? `${(curDist * zoom).toFixed(0)} px (相當於 ${curDist.toFixed(2)} 公尺)`
        : `${(curDist * zoom).toFixed(0)} px`;
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
      ctx.fillStyle = EDIT; 
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 4;
      ctx.fillText("移動游標決定三角形朝向，點擊確認", mouseS.x, mouseS.y - 30);
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
        ctx.fillStyle = editA(0.15);
        ctx.strokeStyle = EDIT;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
      } else {
        // Touch mode (AutoCAD Right-to-Left layout: Green tint, dashed boundary)
        ctx.fillStyle = editA(0.15);
        ctx.strokeStyle = EDIT;
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
    appMode, canvasBackground,
  ]);

  // Curvature check for floating top error warnings
  let liveMinRadius = Infinity;
  let hasCurvatureWarning = false;
  const activeVehicle = (selectedElement && selectedElement.type === 'smart_path') 
    ? ((selectedElement as any).designVehicle || designVehicle)
    : designVehicle;
  const limitRadius = cadMinPathRadius(activeVehicle);

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
  } else if (selectedElement && (selectedElement.type === 'guideline' || selectedElement.type === 'yellow_double' || selectedElement.type === 'white_dashed' || selectedElement.type === 'yellow_dashed' || selectedElement.type === 'white_solid' || selectedElement.type === 'red_solid' || selectedElement.type === 'yellow_solid' || selectedElement.type === 'smart_path')) {
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
    if (el.type === 'BuildingLine' || el.type === 'guideline' || el.type === 'yellow_double' || el.type === 'white_double' || el.type === 'white_dashed' || el.type === 'yellow_dashed' || el.type === 'white_solid' || el.type === 'red_solid' || el.type === 'yellow_solid' || el.type === 'smart_path' || el.type === 'reversible_lane' || el.type === 'crossing_dashed' || el.type === 'stop_line' || el.type === 'Sidewalk' || el.type === 'bicycle_lane' || el.type === 'parking_zone') {
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

  {
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
          for (const lineEl of elements.filter(e => e.type === 'yellow_double' || e.type === 'white_solid' || e.type === 'red_solid' || e.type === 'yellow_solid' || e.type === 'white_dashed' || e.type === 'yellow_dashed')) {
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
    
    if (appMode === 'simulation') return simInput.cursor();

    if (activeTool === 'select') return 'crosshair';

    const c = DRAW_CURSORS[drawCursor] || DRAW_CURSORS.cross;
    return `url("${drawCursorUrl(drawCursor)}") ${c.hot[0]} ${c.hot[1]}, crosshair`;
  };

  return (
    <div 
      ref={containerRef} 
      tabIndex={0}
      className="flex-1 h-full relative overflow-hidden bg-[#1d2127] select-none focus:outline-none"
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
        className="w-full h-full block touch-none"
      />

      {/* 軌跡模擬覆蓋層（不攔截滑鼠；CAD 模式下可作為唯讀參考圖層） */}
      <SimulationLayer
        viewport={viewport}
        width={canvasRef.current?.width ?? 0}
        height={canvasRef.current?.height ?? 0}
        mode={appMode === 'simulation' ? 'sim' : 'cad'}
      />

      {/* Real-time Engineering CAD HUD Collision Alerts Overlay */}
      {hasHardCollision && (
        <div 
          id="hard-collision-warning-hud"
          style={{ top: 16 + insets.top }}
          className="absolute top-4 left-1/2 transform -translate-x-1/2 z-33 flex items-center gap-3 px-5 py-3 bg-red-950 border border-red-500 rounded shadow-lg text-red-200 max-w-xl"
        >
          <svg className="w-5 h-5 text-red-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
          <div className="text-xs font-bold leading-snug">
            轉彎半徑不足，大車內輪差侵犯建築線！
          </div>
        </div>
      )}

      {!hasHardCollision && hasSoftCollision && (
        <div 
          id="soft-collision-warning-hud"
          style={{ top: 16 + insets.top }}
          className="absolute top-4 left-1/2 transform -translate-x-1/2 z-33 flex items-center gap-3 px-5 py-3 bg-yellow-950 border border-yellow-500/80 rounded shadow-lg text-yellow-100 max-w-xl"
        >
          <svg className="w-5 h-5 text-yellow-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/></svg>
          <div className="text-xs font-bold leading-snug">
            此線形大車轉彎會發生侵線/借道行為，建議優化槽化島。
          </div>
        </div>
      )}

      {/* Floating Canvas Controls */}
      <div style={{ top: 16 + insets.top, right: 16 + insets.right }} className="absolute top-4 right-4 flex flex-col items-end gap-2 z-10 select-none">
        {/* Zoom to Fit Button */}
        <button
          id="btn-zoom-to-fit"
          onClick={handleZoomToFit}
          title="Zoom to Fit & Center (視窗導正 / 回歸全圖中心)"
          className="flex items-center justify-center w-10 h-10 rounded bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-800/85 text-zinc-300 hover:text-white shadow-lg transition-all cursor-pointer"
        >
          <Search className="w-5 h-5 text-zinc-300" />
        </button>
      </div>

      {/* Floating SmartPath Draw Actions Box */}
      {isLineOrPathTool(activeTool) && spPoints.length >= 1 && (
        <div id="smartpath-floating-draw-bar" style={{ bottom: 64 + insets.bottom }} className={`absolute bottom-16 left-1/2 transform -translate-x-1/2 z-25 flex gap-2 p-2 rounded shadow-lg ${
          'bg-zinc-900/95 border border-zinc-800/80'
        }`}>
          <button
            id="btn-complete-smartpath"
            onClick={() => handleCompleteSmartPath(spPoints, spCpLeft, spCpRight)}
            disabled={spPoints.length < 2}
            className={`px-3 py-1.5 text-xs font-bold rounded transition-all flex items-center gap-1 cursor-pointer ${
              spPoints.length >= 2 
                ? 'bg-[#f2f3f5] hover:bg-white text-[#1d2127]' 
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
            }`}
          >
            完成 (Enter)
          </button>
          <button
            onClick={() => {
              setSpPoints([]);
              setSpCpLeft([]);
              setSpCpRight([]);
              setActiveTool('select');
            }}
            className={`px-3 py-1.5 text-xs font-bold rounded transition-all cursor-pointer ${
              'bg-zinc-850 hover:bg-zinc-800 text-zinc-300'
            }`}
          >
            取消
          </button>
        </div>
      )}

      {/* Floating Instructions Banner */}
      {((appMode === 'cad' && activeTool !== 'select') || (appMode === 'simulation' && !!simInput.hint())) && (() => {
        const getToolInstruction = (tool: string, spCount: number, draftCount: number) => {
          if (appMode === 'simulation') return simInput.hint()!;
          const pen = `已放置 ${spCount} 個節點。點擊新增節點、按住拖曳可彎曲；Shift 鎖定水平/垂直。Enter、雙擊或 Esc 完成。`;
          const region = `已放置 ${spCount} 個節點。沿邊界依序點擊，Enter、雙擊或點回起點即自動閉合。`;
          const name = MARKING_NAMES[tool] || '繪圖工具';
          switch (tool) {
            case 'Sidewalk':
            case 'channelization':
            case 'grid_box':
              return { name: `${name}（點選區域邊界）`, desc: region };
            case 'parking_zone':
              return { name: `${name}`, desc: `沿停車帶畫一條路徑（已放置 ${spCount} 點），完成後車格會依右側參數沿路徑自動排列。` };
            case 'crosswalk': {
              const steps = [
                '第 1 點：點在行穿線一側邊緣的起點。',
                '第 2 點：同一側邊緣的終點（決定長度）。',
                '第 3 點：對側邊緣、與第 2 點相對的端點（決定寬度）。',
                '第 4 點：對側邊緣、與第 1 點相對的端點，點下即完成。',
              ];
              return { name: `${name}（步驟 ${Math.min(draftCount + 1, 4)}/4）`, desc: steps[Math.min(draftCount, 3)] };
            }
            case 'moto_box':
            case 'moto_turn_box': {
              const steps = [
                '第 1 點：前緣（靠停止線）的一端。',
                '第 2 點：前緣的另一端。',
                '第 3 點：往後拉出區域深度，點下即完成。',
              ];
              return { name: `${name}（步驟 ${Math.min(draftCount + 1, 3)}/3）`, desc: steps[Math.min(draftCount, 2)] };
            }
            case 'road_arrow':
              return { name, desc: '點擊車道中央即放置，會自動對齊車道行車方向；按住往想要的方向拖曳可自訂朝向（Shift 每 15°）。' };
            case 'road_text':
              return { name, desc: '點擊車道中央（最靠近駕駛人的一字），輸入字樣後按 Enter。字樣往行車方向延伸，順著字頭由上而下閱讀。' };
            case 'text_label':
              return { name, desc: '點擊要放文字的位置，輸入內容後按 Enter（Esc 取消）。' };
            case 'parking_space':
              return { name, desc: '點擊放置車格；按住往車格長邊方向拖曳可旋轉（Shift 每 15°）。尺寸可在右側調整。' };
            case 'measurement':
              return { name, desc: spCount === 0 ? '點擊量測起點。' : '點擊量測終點。' };
            case 'angular_dimension':
              return { name, desc: ['點擊夾角頂點。', '點擊第一邊上的任一點。', '點擊第二邊上的任一點。'][Math.min(spCount, 2)] };
            case 'arc_3point':
              return { name, desc: ['點擊圓弧起點。', '點擊圓弧上任一點。', '點擊圓弧終點。'][Math.min(spCount, 2)] };
            case 'sketch_circle':
              return { name, desc: draftCount === 0 ? '點擊決定圓心。' : '移動並點擊決定半徑。' };
            case 'map_scale':
              return { name: '底圖比例尺校正', desc: '在底圖上已知長度的物件（如 10 m 標記）拖曳一條校正線，放開後輸入實際距離。' };
            default:
              return { name: `${name}（鋼筆）`, desc: pen };
          }
        };

        const instr = getToolInstruction(activeTool, spPoints.length, draftPoints.length);
        return (
          <div style={{ top: 16 + insets.top, left: 16 + insets.left }} className="absolute top-4 left-4 pointer-events-none px-3 py-2 rounded max-w-sm flex flex-col gap-0.5 z-10 bg-zinc-900/90 border border-zinc-800">
            <h4 className="text-xs font-bold text-zinc-300">
              {instr.name}
            </h4>
            <p className="text-[10px] text-zinc-500 leading-snug">
              {instr.desc}
            </p>
          </div>
        );
      })()}

      {/* Touch Navigation Helpers on Right Bottom corner */}
      {!hideStatusBar && <div id="canvas-status-bar" style={{ bottom: 16 + insets.bottom, left: 16 + insets.left }} className="absolute bottom-4 left-4 flex gap-4 text-[10px] font-mono px-3 py-1.5 rounded pointer-events-none z-10 bg-zinc-900/60 border border-zinc-800/20 text-zinc-500">
        <span className="text-zinc-300">X {mouseWorld.x.toFixed(2)}　Y {mouseWorld.y.toFixed(2)} m</span>
        <span title="以 96 dpi 螢幕估算的出圖比例">比例 1:{(() => { const n = 3780 / viewport.zoom; const m = Math.pow(10, Math.floor(Math.log10(n)) - 1); return Math.round(n / m) * m; })()}</span>
        <span className="hidden xl:inline">Shift 正交／15°</span>
        <span className="hidden xl:inline">Space 或中鍵 平移</span>
        <span className="hidden xl:inline">Esc 完成／取消</span>
      </div>}

      {/* Dynamic Scale Bar on Right Bottom corner */}
      <div style={{ bottom: 16 + insets.bottom, right: 16 + insets.right }} className="absolute bottom-4 right-4 flex flex-col items-center select-none pointer-events-none z-10 font-mono text-[10px] gap-1 transition-all text-white drop-shadow-[0_1.5px_1.5px_rgba(0,0,0,0.8)]">
        <span className="font-bold tracking-wider">{scaleLabel}</span>
        <div className="relative h-1 border-b border-white" style={{ width: `${scalePixelWidth}px` }}>
          <div className="absolute left-0 bottom-0 w-[1px] h-1.5 bg-white"></div>
          <div className="absolute left-1/2 bottom-0 w-[1px] h-1 bg-white/70 transform -translate-x-1/2"></div>
          <div className="absolute right-0 bottom-0 w-[1px] h-1.5 bg-white"></div>
        </div>
      </div>

      {contextMenu && onContextAction && (
        <>
          <div className="absolute inset-0 z-40" onPointerDown={() => setContextMenu(null)} onContextMenu={(e) => e.preventDefault()} />
          <div id="canvas-context-menu" className="absolute z-50 w-44 py-1 rounded bg-zinc-900/95 border border-zinc-700 shadow-lg text-xs text-zinc-200" style={{ left: contextMenu.sx, top: contextMenu.sy }}>
            {([
              ['copy', '複製', 'Ctrl+C', !!(selectedElement || selectedElementIds.length)],
              ['paste', '貼上', 'Ctrl+V', canPaste],
              ['duplicate', '原地複製', 'Ctrl+D', !!(selectedElement || selectedElementIds.length)],
              ['rotate90', '逆時針旋轉 90°', '', !!(selectedElement || selectedElementIds.length)],
              ['rotate-90', '順時針旋轉 90°', '', !!(selectedElement || selectedElementIds.length)],
              ['delete', '刪除', 'Delete', !!(selectedElement || selectedElementIds.length)],
            ] as const).map(([action, label, key, enabled]) => (
              <button
                key={action}
                id={`ctx-${action}`}
                disabled={!enabled}
                onClick={() => { onContextAction(action); setContextMenu(null); }}
                className={`w-full flex items-center justify-between px-3 py-1.5 text-left cursor-pointer disabled:opacity-30 disabled:cursor-default hover:bg-white/10 ${action === 'delete' ? 'text-red-400' : ''}`}
              >
                <span>{label}</span><span className="text-[10px] text-zinc-500">{key}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {textDraft && (
        <div
          className={`absolute z-50 -translate-x-1/2 ${textDraft.sy < 90 ? '' : '-translate-y-full'} flex flex-col gap-1 p-2 rounded bg-zinc-900/95 border border-[#4c9eff]/60 shadow-lg`}
          // 靠近畫布上緣時改放在點擊位置下方，避免被切掉
          style={{ left: Math.max(130, textDraft.sx), top: textDraft.sy < 90 ? textDraft.sy + 12 : textDraft.sy - 8 }}
        >
          <span className="text-[10px] text-zinc-400">{textDraft.kind === 'road_text' ? '路面標字（例：慢、停、公車專用）' : '文字標註'}</span>
          <input
            id="inline-text-input"
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
            value={textDraft.value}
            onChange={(e) => setTextDraft({ ...textDraft, value: e.target.value })}
            onKeyDown={(e) => {
              // 注音／拼音輸入法選字時的 Enter 不算送出
              if (e.nativeEvent.isComposing || e.keyCode === 229) { e.stopPropagation(); return; }
              if (e.key === 'Enter') commitTextDraft();
              if (e.key === 'Escape') setTextDraft(null);
              e.stopPropagation();
            }}
            onBlur={commitTextDraft}
            className="w-56 bg-zinc-950 border border-zinc-700 focus:border-[#4c9eff] rounded px-2 py-1 text-sm text-white outline-none"
            placeholder="輸入文字後按 Enter"
          />
        </div>
      )}

      {calibrationDialog && (
        <div className="absolute inset-0 z-[100] bg-black/75 flex items-center justify-center p-4">
          <div className="bg-[#14161c] border border-zinc-800 p-5 rounded max-w-sm w-full shadow-lg flex flex-col gap-4">
            <div className="flex items-center gap-2 text-red-400 border-b border-zinc-800 pb-2.5">
              <Ruler className="w-4 h-4 text-zinc-400 shrink-0" />
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
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-[#4c9eff] rounded px-3 py-2 text-sm text-white font-mono placeholder-zinc-650 focus:outline-none"
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
              <div className="text-[11px] text-red-400 bg-red-950/25 border border-red-900/30 rounded px-3 py-2 leading-tight">
                {calibrationError}
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
                className="px-3.5 py-2 text-xs font-semibold rounded bg-zinc-850 hover:bg-zinc-800 text-zinc-300 transition-all cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleSaveCalibration}
                className="px-4 py-2 text-xs font-bold rounded bg-[#f2f3f5] hover:bg-white text-[#1d2127] transition-all cursor-pointer"
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
