/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Point, PathPoint } from '../types';

/**
 * Calculates the Euclidean distance between two points.
 */
export function distance(p1: Point, p2: Point): number {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

/**
 * Smooths raw points using a simple moving average window.
 * This makes drawing transitions smoother.
 */
export function smoothPoints(points: Point[], rounds: number = 2): Point[] {
  if (points.length < 3) return points;
  let current = [...points];

  for (let r = 0; r < rounds; r++) {
    const next: Point[] = [current[0]];
    for (let i = 1; i < current.length - 1; i++) {
      next.push({
        x: 0.25 * current[i - 1].x + 0.5 * current[i].x + 0.25 * current[i + 1].x,
        y: 0.25 * current[i - 1].y + 0.5 * current[i].y + 0.25 * current[i + 1].y,
      });
    }
    next.push(current[current.length - 1]);
    current = next;
  }
  return current;
}

/**
 * Chaikin's Subdivision Algorithm for subdivision curve generation.
 * Generates an elegant high-density smooth path from discrete control points.
 */
export function chaikinSmooth(points: Point[], iterations: number = 4): Point[] {
  if (points.length < 3) return points;
  let current = [...points];

  for (let it = 0; it < iterations; it++) {
    const next: Point[] = [];
    next.push(current[0]); // Keep the first point exactly
    for (let i = 0; i < current.length - 1; i++) {
      const p0 = current[i];
      const p1 = current[i + 1];
      
      const q = {
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
      };
      const r = {
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
      };
      next.push(q, r);
    }
    next.push(current[current.length - 1]); // Keep the last point exactly
    current = next;
  }
  return current;
}

/**
 * Cubic Bezier Curve Spline interpolation through all control points.
 */
export function cubicBezierSpline(points: Point[], pointsPerSegment: number = 24): Point[] {
  if (points.length < 2) return points;
  if (points.length === 2) {
    const next: Point[] = [];
    for (let i = 0; i <= pointsPerSegment; i++) {
      const t = i / pointsPerSegment;
      next.push({
        x: points[0].x + t * (points[1].x - points[0].x),
        y: points[0].y + t * (points[1].y - points[0].y),
      });
    }
    return next;
  }

  const result: Point[] = [];
  const n = points.length;

  const getControlPoints = (p0: Point, p1: Point, p2: Point, p3: Point, tension: number = 0.5) => {
    const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const d01 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const d23 = Math.hypot(p3.x - p2.x, p3.y - p2.y);

    let fa = tension * d12 / (d01 + d12);
    let fb = tension * d12 / (d12 + d23);

    if (isNaN(fa)) fa = 0.5;
    if (isNaN(fb)) fb = 0.5;

    const cp1 = {
      x: p1.x + fa * (p2.x - p0.x),
      y: p1.y + fa * (p2.y - p0.y),
    };

    const cp2 = {
      x: p2.x - fb * (p3.x - p1.x),
      y: p2.y - fb * (p3.y - p1.y),
    };

    return [cp1, cp2];
  };

  for (let i = 0; i < n - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = i > 0 ? points[i - 1] : { x: p1.x - (p2.x - p1.x), y: p1.y - (p2.y - p1.y) };
    const p3 = i < n - 2 ? points[i + 2] : { x: p2.x + (p2.x - p1.x), y: p2.y + (p2.y - p1.y) };

    const [cp1, cp2] = getControlPoints(p0, p1, p2, p3);

    for (let j = 0; j <= pointsPerSegment; j++) {
      if (i > 0 && j === 0) continue;
      const t = j / pointsPerSegment;
      const mt = 1 - t;
      const x = mt*mt*mt*p1.x + 3*mt*mt*t*cp1.x + 3*mt*t*t*cp2.x + t*t*t*p2.x;
      const y = mt*mt*mt*p1.y + 3*mt*mt*t*cp1.y + 3*mt*t*t*cp2.y + t*t*t*p2.y;
      result.push({ x, y });
    }
  }

  return result;
}

/**
 * Takes raw vertices and fillet-rounds intermediate corners with a given radius (in meters).
 */
export function filletPath(points: Point[], scale: number, radiusMeters: number): Point[] {
  if (points.length < 3 || radiusMeters <= 0) return points;

  const R_px = radiusMeters * scale;
  const result: Point[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const A = points[i - 1]; // Previous point
    const B = points[i];     // Corner point
    const C = points[i + 1]; // Next point

    // Vectors BA and BC
    const ux = A.x - B.x;
    const uy = A.y - B.y;
    const vx = C.x - B.x;
    const vy = C.y - B.y;

    const Lu = Math.hypot(ux, uy);
    const Lv = Math.hypot(vx, vy);

    if (Lu < 0.1 || Lv < 0.1) {
      result.push(B);
      continue;
    }

    // Normalized vectors
    const unx = ux / Lu;
    const uny = uy / Lu;
    const vnx = vx / Lv;
    const vny = vy / Lv;

    const dot = unx * vnx + uny * vny;

    // If parallel/straight line, skip fillet
    if (Math.abs(dot) > 0.999) {
      result.push(B);
      continue;
    }

    // Angle beta between BA and BC (0 to PI)
    const beta = Math.acos(Math.max(-1, Math.min(1, dot)));

    // For a circular arc passing through B with radius R, the tangent points 
    // are at distance d = 2 * R * cos(beta/2) from B.
    let d = 2 * R_px * Math.cos(beta / 2);

    // Limit d to 45% of the shortest adjacent segment to prevent fillet intersection
    const dMax = 0.45 * Math.min(Lu, Lv);
    if (d > dMax) {
      d = dMax;
    }

    // Recalculate local actual radius if scaled down
    const R_actual = d / (2 * Math.cos(beta / 2));

    // Tangent points
    const T1 = { x: B.x + d * unx, y: B.y + d * uny };
    const T2 = { x: B.x + d * vnx, y: B.y + d * vny };

    // Bisector pointing inside the corner
    const bx = unx + vnx;
    const by = uny + vny;
    const lenB = Math.hypot(bx, by);
    const bnx = bx / lenB;
    const bny = by / lenB;

    // Center of circle O
    const Ox = B.x + bnx * R_actual;
    const Oy = B.y + bny * R_actual;

    // Radius angles from center Ox, Oy
    const phi1 = Math.atan2(T1.y - Oy, T1.x - Ox);
    const phiB = Math.atan2(B.y - Oy, B.x - Ox);
    const phi2 = Math.atan2(T2.y - Oy, T2.x - Ox);

    // Shortest angular distance from T1 to B
    let dPhi1 = phiB - phi1;
    while (dPhi1 > Math.PI) dPhi1 -= 2 * Math.PI;
    while (dPhi1 < -Math.PI) dPhi1 += 2 * Math.PI;

    // Shortest angular distance from B to T2
    let dPhi2 = phi2 - phiB;
    while (dPhi2 > Math.PI) dPhi2 -= 2 * Math.PI;
    while (dPhi2 < -Math.PI) dPhi2 += 2 * Math.PI;

    // Sample points along both segments (T1 to B, and B to T2)
    const arcLen1 = R_actual * Math.abs(dPhi1);
    const arcLen2 = R_actual * Math.abs(dPhi2);
    const num1 = Math.max(2, Math.floor(arcLen1 / 4));
    const num2 = Math.max(2, Math.floor(arcLen2 / 4));

    // Push points from T1 up to B (excluding B itself)
    for (let j = 0; j < num1; j++) {
      const t = j / num1;
      const angle = phi1 + t * dPhi1;
      result.push({
        x: Ox + R_actual * Math.cos(angle),
        y: Oy + R_actual * Math.sin(angle),
      });
    }

    // Push B itself, ensuring front axle path hits the exact node
    result.push(B);

    // Push points from B to T2 (including T2)
    for (let j = 1; j <= num2; j++) {
      const t = j / num2;
      const angle = phiB + t * dPhi2;
      result.push({
        x: Ox + R_actual * Math.cos(angle),
        y: Oy + R_actual * Math.sin(angle),
      });
    }
  }

  result.push(points[points.length - 1]);
  return result;
}

/**
 * Interpolates a list of raw points into a high-density, evenly-spaced path.
 * Each point contains cumulative distance 's' and tangent 'heading'.
 */
export function interpolatePath(points: Point[], spacing: number = 2): PathPoint[] {
  if (points.length < 2) return [];

  // 1. Calculate cumulative distances along the polyline segments
  const accumulatedDistances: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i < points.length; i++) {
    const segmentLen = distance(points[i - 1], points[i]);
    totalLength += segmentLen;
    accumulatedDistances.push(totalLength);
  }

  // If the path length is 0, we can't interpolate
  if (totalLength === 0) {
    return [{ ...points[0], s: 0, heading: 0 }];
  }

  const pathPoints: PathPoint[] = [];
  const numSamples = Math.max(2, Math.floor(totalLength / spacing));
  
  // 2. Sample points at uniform distances
  for (let step = 0; step <= numSamples; step++) {
    const targetS = (step / numSamples) * totalLength;
    
    // Find the segment containing targetS
    let idx = 1;
    while (idx < points.length && accumulatedDistances[idx] < targetS) {
      idx++;
    }
    
    const pPrev = points[idx - 1];
    const pNext = points[idx];
    const sPrev = accumulatedDistances[idx - 1];
    const sNext = accumulatedDistances[idx];
    const segmentLen = sNext - sPrev;
    
    let t = 0;
    if (segmentLen > 0) {
      t = (targetS - sPrev) / segmentLen;
    }
    
    const x = pPrev.x + t * (pNext.x - pPrev.x);
    const y = pPrev.y + t * (pNext.y - pPrev.y);
    
    // Calculate heading tangent (radians)
    // For a smoother tangent on the last point or intermediate points,
    // we use the current segment heading or interpolate headings.
    const heading = Math.atan2(pNext.y - pPrev.y, pNext.x - pPrev.x);
    
    pathPoints.push({ x, y, s: targetS, heading });
  }

  return pathPoints;
}

/**
 * Finds the index of the path point closest to a target point.
 */
export function findClosestPointIndex(path: PathPoint[], target: Point): number {
  if (path.length === 0) return -1;
  let minDist = Infinity;
  let closestIdx = 0;
  
  for (let i = 0; i < path.length; i++) {
    const dist = distance(path[i], target);
    if (dist < minDist) {
      minDist = dist;
      closestIdx = i;
    }
  }
  
  return closestIdx;
}

/**
 * Intersection path generator using Cubic / Quintic Bezier with configurable offsets of virtual intersection and custom inflection points I1 and I2
 */
export function calculateIntersectionCurve(
  p0: Point,
  thetaA_deg: number,
  p3: Point,
  thetaB_deg: number,
  p1Ratio: number = 0.7,
  p2Ratio: number = 0.7,
  enableOutswing: boolean = false,
  scale: number = 25,
  i1RatioPercent: number = 50,
  i1OffsetDistance: number = 1.5,
  i2RatioPercent: number = 50,
  i2OffsetDistance: number = 1.5,
  startExtensionM: number = 0,
  endExtensionM: number = 0
) {
  const thetaA = (thetaA_deg * Math.PI) / 180;
  const thetaB = (thetaB_deg * Math.PI) / 180;

  const cosA = Math.cos(thetaA);
  const sinA = Math.sin(thetaA);
  const cosB = Math.cos(thetaB);
  const sinB = Math.sin(thetaB);

  // Solve: p0 + t * vA = p3 + u * vB
  // Determinant D = cosB * sinA - sinB * cosA = sin(thetaA - thetaB)
  const D = cosB * sinA - sinB * cosA;

  let I: Point;
  if (Math.abs(D) < 0.01) {
    // Parallel fallback: midpoint
    I = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
  } else {
    // Cramer's rule for t
    const t = (cosB * (p3.y - p0.y) - sinB * (p3.x - p0.x)) / D;
    I = {
      x: p0.x + t * cosA,
      y: p0.y + t * sinA,
    };
  }

  // Calculate relative turning direction to decide whether to swing left or right
  const vAx = cosA;
  const vAy = sinA;
  const vIx = p3.x - I.x;
  const vIy = p3.y - I.y;
  const cpPoints = vAx * vIy - vAy * vIx;
  const turnSign = Math.sign(cpPoints) || 1;

  // We sample 45 nodes for finer simulation resolution
  const steps = 45;
  const curve: Point[] = [];

  // P1 is p1Ratio from P0 towards I
  const p1 = {
    x: p0.x + p1Ratio * (I.x - p0.x),
    y: p0.y + p1Ratio * (I.y - p0.y),
  };

  // P2 is p2Ratio from P3 towards I
  const p2 = {
    x: p3.x + p2Ratio * (I.x - p3.x),
    y: p3.y + p2Ratio * (I.y - p3.y),
  };

  // Base and outer inflection points calculation
  // I1 is along P0 to P1
  const t_i1 = Math.max(0, Math.min(100, i1RatioPercent)) / 100;
  const I1_base = {
    x: p0.x + t_i1 * (p1.x - p0.x),
    y: p0.y + t_i1 * (p1.y - p0.y),
  };

  const len1 = Math.sqrt((p1.x - p0.x) ** 2 + (p1.y - p0.y) ** 2) || 1;
  const dx1 = (p1.x - p0.x) / len1;
  const dy1 = (p1.y - p0.y) / len1;
  const nx_out1 = -turnSign * dy1;
  const ny_out1 = turnSign * dx1;

  const I1 = {
    x: I1_base.x + i1OffsetDistance * scale * nx_out1,
    y: I1_base.y + i1OffsetDistance * scale * ny_out1,
  };

  // I2 is along P2 to P3
  const t_i2 = Math.max(0, Math.min(100, i2RatioPercent)) / 100;
  const I2_base = {
    x: p2.x + t_i2 * (p3.x - p2.x),
    y: p2.y + t_i2 * (p3.y - p2.y),
  };

  const len2 = Math.sqrt((p3.x - p2.x) ** 2 + (p3.y - p2.y) ** 2) || 1;
  const dx2 = (p3.x - p2.x) / len2;
  const dy2 = (p3.y - p2.y) / len2;
  const nx_out2 = -turnSign * dy2;
  const ny_out2 = turnSign * dx2;

  const I2 = {
    x: I2_base.x + i2OffsetDistance * scale * nx_out2,
    y: I2_base.y + i2OffsetDistance * scale * ny_out2,
  };

  if (enableOutswing) {
    const distA = Math.sqrt((I1.x - p0.x) ** 2 + (I1.y - p0.y) ** 2) || 1;
    const distB = Math.sqrt((I2.x - I1.x) ** 2 + (I2.y - I1.y) ** 2) || 1;
    const distC = Math.sqrt((p3.x - I2.x) ** 2 + (p3.y - I2.y) ** 2) || 1;
    const totalDist = distA + distB + distC;

    // Distribute sampling steps proportionally
    const stepsA = Math.max(5, Math.round((distA / totalDist) * steps));
    const stepsC = Math.max(5, Math.round((distC / totalDist) * steps));
    const stepsB = Math.max(5, steps - stepsA - stepsC);

    // Unit tangents
    const tangent_P0 = { x: cosA, y: sinA };
    const tangent_P3 = { x: cosB, y: sinB };

    // Catmull-Rom or blended direction for smooth transition at I1 and I2
    const lenP0I2 = Math.sqrt((I2.x - p0.x) ** 2 + (I2.y - p0.y) ** 2) || 1;
    const tangent_I1 = {
      x: (I2.x - p0.x) / lenP0I2,
      y: (I2.y - p0.y) / lenP0I2
    };

    const lenI1P3 = Math.sqrt((p3.x - I1.x) ** 2 + (p3.y - I1.y) ** 2) || 1;
    const tangent_I2 = {
      x: (p3.x - I1.x) / lenI1P3,
      y: (p3.y - I1.y) / lenI1P3
    };

    // Segment A: P0 to I1
    const fA = 0.35;
    const cpA1 = {
      x: p0.x + fA * distA * tangent_P0.x,
      y: p0.y + fA * distA * tangent_P0.y
    };
    const cpA2 = {
      x: I1.x - fA * distA * tangent_I1.x,
      y: I1.y - fA * distA * tangent_I1.y
    };

    // Segment B: I1 to I2
    const fB = 0.35;
    const cpB1 = {
      x: I1.x + fB * distB * tangent_I1.x,
      y: I1.y + fB * distB * tangent_I1.y
    };
    const cpB2 = {
      x: I2.x - fB * distB * tangent_I2.x,
      y: I2.y - fB * distB * tangent_I2.y
    };

    // Segment C: I2 to P3
    const fC = 0.35;
    const cpC1 = {
      x: I2.x + fC * distC * tangent_I2.x,
      y: I2.y + fC * distC * tangent_I2.y
    };
    const cpC2 = {
      x: p3.x - fC * distC * tangent_P3.x,
      y: p3.y - fC * distC * tangent_P3.y
    };

    // Helper functions for cubic Bezier
    const cubicBezier = (pStart: Point, cp1: Point, cp2: Point, pEnd: Point, t: number) => {
      const u = 1 - t;
      const u2 = u * u;
      const u3 = u2 * u;
      const t2 = t * t;
      const t3 = t2 * t;
      return {
        x: u3 * pStart.x + 3 * u2 * t * cp1.x + 3 * u * t2 * cp2.x + t3 * pEnd.x,
        y: u3 * pStart.y + 3 * u2 * t * cp1.y + 3 * u * t2 * cp2.y + t3 * pEnd.y
      };
    };

    // Push Segment A points, except its endpoint which is starting point of Segment B
    for (let i = 0; i < stepsA; i++) {
      const t = i / stepsA;
      curve.push(cubicBezier(p0, cpA1, cpA2, I1, t));
    }

    // Push Segment B points, except its endpoint which is starting point of Segment C
    for (let i = 0; i < stepsB; i++) {
      const t = i / stepsB;
      curve.push(cubicBezier(I1, cpB1, cpB2, I2, t));
    }

    // Push Segment C points (including final point at t=1)
    for (let i = 0; i <= stepsC; i++) {
      const t = i / stepsC;
      curve.push(cubicBezier(I2, cpC1, cpC2, p3, t));
    }
  } else {
    // Standard cubic Bezier (no outswing)
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const mt = 1 - t;
      const mt2 = mt * mt;
      const mt3 = mt2 * mt;
      const t2 = t * t;
      const t3 = t2 * t;

      const x = mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x;
      const y = mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y;

      curve.push({ x, y });
    }
  }

  // Prepend start extension
  const startExtPoints: Point[] = [];
  if (startExtensionM > 0) {
    const startLenPx = startExtensionM * scale;
    const tangent_P0 = { x: cosA, y: sinA };
    const extSteps = Math.max(5, Math.round(startExtensionM * 2));
    for (let i = extSteps; i > 0; i--) {
      const dist = (i / extSteps) * startLenPx;
      startExtPoints.push({
        x: p0.x - dist * tangent_P0.x,
        y: p0.y - dist * tangent_P0.y,
      });
    }
  }

  // Append end extension
  const endExtPoints: Point[] = [];
  if (endExtensionM > 0) {
    const endLenPx = endExtensionM * scale;
    const tangent_P3 = { x: cosB, y: sinB };
    const extSteps = Math.max(5, Math.round(endExtensionM * 2));
    for (let i = 1; i <= extSteps; i++) {
      const dist = (i / extSteps) * endLenPx;
      endExtPoints.push({
        x: p3.x + dist * tangent_P3.x,
        y: p3.y + dist * tangent_P3.y,
      });
    }
  }

  const finalCurve = [...startExtPoints, ...curve, ...endExtPoints];

  return { I, p1, p2, I1, I2, I1_base, I2_base, curve: finalCurve };
}
