import { Point2D, ThreeCenterCurveElement, IslandElement, CadElement, CrosswalkElement } from './types';
import { arrowData } from './arrowData';

export function getRoadArrowOutlinePoints(el: { p: Point2D; arrowType: string; length: number; angle: number }): Point2D[] {
  const data = arrowData[el.arrowType];
  if (!data) return [];
  const cos = Math.cos(el.angle);
  const sin = Math.sin(el.angle);
  return data.points.map(pt => {
    const mx = pt.x * el.length;
    const my = (pt.y - 0.5) * el.length;
    const rotX = mx * cos - my * sin;
    const rotY = mx * sin + my * cos;
    return {
      x: el.p.x + rotX,
      y: el.p.y + rotY
    };
  });
}

// Simple vector operations
export function distance(p1: Point2D, p2: Point2D): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}

export function lerp(p1: Point2D, p2: Point2D, t: number): Point2D {
  return {
    x: p1.x + (p2.x - p1.x) * t,
    y: p1.y + (p2.y - p1.y) * t,
  };
}

export function dot(v1: Point2D, v2: Point2D): number {
  return v1.x * v2.x + v1.y * v2.y;
}

export function crossProduct(v1: Point2D, v2: Point2D): number {
  return v1.x * v2.y - v1.y * v2.x;
}

export function normalize(v: Point2D): Point2D {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  if (len === 0) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

// Get point projected on segment, and nearest distance
export function projectPointOnSegment(p: Point2D, a: Point2D, b: Point2D): { point: Point2D; dist: number } {
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const abLen2 = ab.x * ab.x + ab.y * ab.y;
  
  if (abLen2 === 0) {
    return { point: a, dist: distance(p, a) };
  }
  
  let t = dot(ap, ab) / abLen2;
  t = Math.max(0, Math.min(1, t)); // clamp to segment
  
  const projPoint = { x: a.x + t * ab.x, y: a.y + t * ab.y };
  return { point: projPoint, dist: distance(p, projPoint) };
}

// Check intersection of two infinite lines defined by (p1, p2) and (p3, p4)
export function getLineIntersection(p1: Point2D, p2: Point2D, p3: Point2D, p4: Point2D): Point2D | null {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-6) {
    return null; // parallel or coincident
  }
  
  const tNum = (p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x);
  const t = tNum / denom;
  
  return {
    x: p1.x + t * (p2.x - p1.x),
    y: p1.y + t * (p2.y - p1.y),
  };
}

// Rotate a vector by angle in radians
export function rotateVector(v: Point2D, radians: number): Point2D {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    x: v.x * cos - v.y * sin,
    y: v.x * sin + v.y * cos,
  };
}

// Helper: Get inward normal relative to current turn bisector (b)
function getInwardNormal(u: Point2D, b: Point2D): Point2D {
  const r1 = { x: -u.y, y: u.x };
  const r2 = { x: u.y, y: -u.x };
  const dot1 = dot(r1, b);
  return dot1 > 0 ? r1 : r2;
}

// Sample an arc between start and end points in CCW or CW direction
export function sampleArc(
  center: Point2D,
  radius: number,
  startPoint: Point2D,
  endPoint: Point2D,
  isCcw: boolean,
  numPoints: number = 20
): Point2D[] {
  const startAng = Math.atan2(startPoint.y - center.y, startPoint.x - center.x);
  let endAng = Math.atan2(endPoint.y - center.y, endPoint.x - center.x);
  
  if (isCcw) {
    if (endAng < startAng) {
      endAng += 2 * Math.PI;
    }
  } else {
    if (endAng > startAng) {
      endAng -= 2 * Math.PI;
    }
  }
  
  const points: Point2D[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const ang = startAng + t * (endAng - startAng);
    points.push({
      x: center.x + radius * Math.cos(ang),
      y: center.y + radius * Math.sin(ang),
    });
  }
  return points;
}

/**
 * Solves a Symmetrical Three-Centered Curve
 * Given incoming tangent point pStart, intersection vertex pIntersection, and outgoing tangent point pEnd.
 * Golden standard: R1 : R2 : R3 = 3 : 1 : 3
 * Central angle of transition arcs theta1 = 15° (0.2618 rad)
 */
export function solveThreeCenteredCurve(
  pStart: Point2D,
  pIntersection: Point2D,
  pEnd: Point2D,
  R2: number
): {
  O1: Point2D;
  O2: Point2D;
  O3: Point2D;
  T1: Point2D;
  C12: Point2D;
  C23: Point2D;
  T2: Point2D;
  points: Point2D[];
  isCcw: boolean;
} | null {
  // Symmetrical radii ratio: R1 = R3 = 3 * R2
  let R1 = 3 * R2;
  let R3 = 3 * R2;

  // Tangent unit directions from intersection vertex pIntersection
  const u1 = normalize({ x: pStart.x - pIntersection.x, y: pStart.y - pIntersection.y });
  const u2 = normalize({ x: pEnd.x - pIntersection.x, y: pEnd.y - pIntersection.y });

  const d = dot(u1, u2);
  if (Math.abs(d - 1.0) < 1e-4) {
    return null; // Parallel or invalid lines
  }

  // Bisector vector pointing inwards
  const b = normalize({ x: u1.x + u2.x, y: u1.y + u2.y });

  // Inward normals on both tangents
  const n1 = getInwardNormal(u1, b);
  const n2 = getInwardNormal(u2, b);

  // Vertex turn direction
  const cross = crossProduct(u1, u2);
  const isCcw = cross > 0;

  // Angle of intersection alpha
  const cosAlpha = Math.max(-1, Math.min(1, d));
  const alpha = Math.acos(cosAlpha);

  const sinAlphaHalf = Math.sin(alpha / 2);
  if (sinAlphaHalf < 1e-4) return null;

  // Symmetrical transition central angle (start at 15 degrees)
  let theta1 = 15 * (Math.PI / 180);

  let O1: Point2D = { x: 0, y: 0 };
  let O2: Point2D = { x: 0, y: 0 };
  let O3: Point2D = { x: 0, y: 0 };
  let T1: Point2D = { x: 0, y: 0 };
  let T2: Point2D = { x: 0, y: 0 };
  let C12: Point2D = { x: 0, y: 0 };
  let C23: Point2D = { x: 0, y: 0 };
  let solved = false;

  // We will try solving using standard offset methods.
  // If it fails or has no real solution, we gradually decay theta1 or fallback to the elegant intersection base construction.
  for (let attempt = 0; attempt < 5; attempt++) {
    const p = (R1 - R2) * (1 - Math.cos(theta1));
    const h = R2 + p;
    const d_O2 = h / sinAlphaHalf;

    O2 = {
      x: pIntersection.x + d_O2 * b.x,
      y: pIntersection.y + d_O2 * b.y,
    };

    const v1 = {
      x: pIntersection.x + R1 * n1.x - O2.x,
      y: pIntersection.y + R1 * n1.y - O2.y,
    };

    const B_quad = 2 * dot(u1, v1);
    const C_quad = dot(v1, v1) - (R1 - R2) ** 2;
    const disc_O1 = B_quad * B_quad - 4 * C_quad;

    const v2 = {
      x: pIntersection.x + R3 * n2.x - O2.x,
      y: pIntersection.y + R3 * n2.y - O2.y,
    };

    const B3_quad = 2 * dot(u2, v2);
    const C3_quad = dot(v2, v2) - (R3 - R2) ** 2;
    const disc_O3 = B3_quad * B3_quad - 4 * C3_quad;

    if (disc_O1 >= 0 && disc_O3 >= 0) {
      const x1 = (-B_quad + Math.sqrt(disc_O1)) / 2;
      const x2 = (-B_quad - Math.sqrt(disc_O1)) / 2;
      const x = Math.max(x1, x2);

      O1 = {
        x: pIntersection.x + x * u1.x + R1 * n1.x,
        y: pIntersection.y + x * u1.y + R1 * n1.y,
      };

      T1 = {
        x: pIntersection.x + x * u1.x,
        y: pIntersection.y + x * u1.y,
      };

      const y1 = (-B3_quad + Math.sqrt(disc_O3)) / 2;
      const y2 = (-B3_quad - Math.sqrt(disc_O3)) / 2;
      const y = Math.max(y1, y2);

      O3 = {
        x: pIntersection.x + y * u2.x + R3 * n2.x,
        y: pIntersection.y + y * u2.y + R3 * n2.y,
      };

      T2 = {
        x: pIntersection.x + y * u2.x,
        y: pIntersection.y + y * u2.y,
      };

      solved = true;
      break;
    }

    // Decay theta1 (transition angle) to make the curve gentler
    theta1 *= 0.7;
  }

  // If still not solved, fallback to the 100% solid graphical construction:
  if (!solved) {
    // Fallback graphical method
    const d_ref = R1 / sinAlphaHalf;
    const P_ref = {
      x: pIntersection.x + d_ref * b.x,
      y: pIntersection.y + d_ref * b.y,
    };

    O1 = { ...P_ref };
    O3 = { ...P_ref };
    O2 = {
      x: P_ref.x - (R1 - R2) * b.x,
      y: P_ref.y - (R1 - R2) * b.y,
    };

    T1 = {
      x: O1.x - R1 * n1.x,
      y: O1.y - R1 * n1.y,
    };

    T2 = {
      x: O3.x - R3 * n2.x,
      y: O3.y - R3 * n2.y,
    };
  }

  // Compute compound contact points
  const u12 = normalize({ x: O2.x - O1.x, y: O2.y - O1.y });
  C12 = {
    x: O1.x + u12.x * R1,
    y: O1.y + u12.y * R1,
  };

  const u32 = normalize({ x: O2.x - O3.x, y: O2.y - O3.y });
  C23 = {
    x: O3.x + u32.x * R3,
    y: O3.y + u32.y * R3,
  };

  // Sample curves
  const arc1_points = sampleArc(O1, R1, T1, C12, isCcw, 15);
  const arc2_points = sampleArc(O2, R2, C12, C23, isCcw, 15);
  const arc3_points = sampleArc(O3, R3, C23, T2, isCcw, 15);

  const points = [
    ...arc1_points,
    ...arc2_points.slice(1),
    ...arc3_points.slice(1),
  ];

  return {
    O1,
    O2,
    O3,
    T1,
    C12,
    C23,
    T2,
    points,
    isCcw,
  };
}

/**
 * Samples points along a Cubic Bezier Curve segment.
 */
export function sampleCubicBezier(
  A: Point2D,
  C1: Point2D,
  C2: Point2D,
  B: Point2D,
  numPoints: number = 30
): Point2D[] {
  const pts: Point2D[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const mt = 1 - t;
    const x = mt * mt * mt * A.x + 3 * mt * mt * t * C1.x + 3 * mt * t * t * C2.x + t * t * t * B.x;
    const y = mt * mt * mt * A.y + 3 * mt * mt * t * C1.y + 3 * mt * t * t * C2.y + t * t * t * B.y;
    pts.push({ x, y });
  }
  return pts;
}

/**
 * Samples dense points representing a closed path of Bezier segments.
 * Useful for channelization islands with curved Bezier outlines.
 */
export function sampleClosedBezierLoop(
  points: Point2D[],
  cpLeft: Point2D[],
  cpRight: Point2D[],
  subdivisions: number = 20
): Point2D[] {
  const dense: Point2D[] = [];
  const n = points.length;
  if (n < 3) return points;

  const leftCp = cpLeft || [];
  const rightCp = cpRight || [];

  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    const pStart = points[i];
    const cpStart = rightCp[i] || pStart;
    const cpEnd = leftCp[nextIdx] || points[nextIdx];
    const pEnd = points[nextIdx];

    const seg = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, subdivisions);
    // Exclude the last point of the segment to avoid duplicates, except on the last segment where we close it.
    if (i < n - 1) {
      dense.push(...seg.slice(0, -1));
    } else {
      dense.push(...seg);
    }
  }
  return dense;
}

/**
 * Computes normal offsets for a single cubic Bezier segment.
 * Returns (subdivisions + 1) evenly-parameterised offset points.
 */
export function computeBezierNormalOffsets(
  pStart: Point2D,
  cpStart: Point2D,
  cpEnd: Point2D,
  pEnd: Point2D,
  offsetDist: number,
  subdivisions: number = 30
): Point2D[] {
  const tPoints = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, subdivisions);
  const offsetPoints: Point2D[] = [];

  for (let i = 0; i < tPoints.length; i++) {
    const pt = tPoints[i];
    let tangent: Point2D;

    if (i === 0) {
      const next = tPoints[i + 1];
      tangent = { x: next.x - pt.x, y: next.y - pt.y };
    } else if (i === tPoints.length - 1) {
      const prev = tPoints[i - 1];
      tangent = { x: pt.x - prev.x, y: pt.y - prev.y };
    } else {
      const prev = tPoints[i - 1];
      const next = tPoints[i + 1];
      tangent = { x: next.x - prev.x, y: next.y - prev.y };
    }

    const normTangent = normalize(tangent);
    const normal = { x: -normTangent.y, y: normTangent.x };

    offsetPoints.push({
      x: pt.x + normal.x * offsetDist,
      y: pt.y + normal.y * offsetDist,
    });
  }

  return offsetPoints;
}

/**
 * Intersection of two infinite lines defined by two point-pairs each.
 * Returns null when lines are parallel (|cross| < ε).
 */
function lineLineIntersect(
  a0: Point2D, a1: Point2D,
  b0: Point2D, b1: Point2D
): Point2D | null {
  const dax = a1.x - a0.x, day = a1.y - a0.y;
  const dbx = b1.x - b0.x, dby = b1.y - b0.y;
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-12) return null;
  const dx = b0.x - a0.x, dy = b0.y - a0.y;
  const t = (dx * dby - dy * dbx) / denom;
  return { x: a0.x + t * dax, y: a0.y + t * day };
}

/**
 * Maximum ratio of miter-spike-length to |offsetDist| before falling back to bevel.
 * Mirrors the CSS / SVG miter-limit convention (default 10).
 */
const OFFSET_MITER_LIMIT = 10;

/**
 * Resolve the topologically-correct junction point where segment A's offset
 * tail meets segment B's offset head.
 *
 * Inner corner (offset lines cross before the anchor):
 *   → intersection I trims the overlap to a clean point.
 * Outer corner (offset lines diverge past the anchor):
 *   → intersection I fills the gap with a miter apex.
 * Very sharp corners (spike > OFFSET_MITER_LIMIT × |offsetDist|):
 *   → fall back to bevel (arithmetic mean of the two natural endpoints).
 * Parallel segments:
 *   → fall back to midpoint.
 */
function resolveOffsetJunction(
  segA: Point2D[],
  segB: Point2D[],
  offsetDist: number
): Point2D {
  if (segA.length < 2 || segB.length < 2) return segA[segA.length - 1];

  // Use the last two points of A and the first two of B to define the
  // tangent lines of the offset curve at the junction.
  const a0 = segA[segA.length - 2];
  const a1 = segA[segA.length - 1];
  const b0 = segB[0];
  const b1 = segB[1];

  const I = lineLineIntersect(a0, a1, b0, b1);

  if (!I) {
    // Parallel → simple midpoint bevel
    return { x: (a1.x + b0.x) * 0.5, y: (a1.y + b0.y) * 0.5 };
  }

  // Guard against degenerate spikes on extremely sharp turns.
  const base = Math.max(Math.abs(offsetDist), 1e-4);
  const spike = Math.hypot(I.x - a1.x, I.y - a1.y);
  if (spike > OFFSET_MITER_LIMIT * base) {
    return { x: (a1.x + b0.x) * 0.5, y: (a1.y + b0.y) * 0.5 };
  }

  return I;
}

/**
 * Multi-segment Bezier path normal-offset computation with topologically
 * correct miter/bevel corner joins.
 *
 * For each inter-segment junction the function computes the line-line
 * intersection of the two adjacent offset tangents and uses that point as
 * the shared corner vertex, eliminating both inner-edge braid overlap and
 * outer-edge gap artefacts.
 */
export function getPathOffsetCurves(
  points: Point2D[],
  cpLeft: Point2D[],
  cpRight: Point2D[],
  offsetDist: number,
  subdivisions: number = 30
): Point2D[] {
  if (points.length < 2) return [];

  // 1. Sample each Bezier segment independently so their endpoints are not
  //    artificially merged before we can inspect their tangent directions.
  const segments: Point2D[][] = [];
  for (let j = 0; j < points.length - 1; j++) {
    segments.push(
      computeBezierNormalOffsets(
        points[j], cpRight[j], cpLeft[j + 1], points[j + 1],
        offsetDist, subdivisions
      )
    );
  }

  if (segments.length === 1) return segments[0];

  // 2. Assemble result: for each segment exclude the first point (replaced by
  //    the preceding junction) and the last point (replaced by the following
  //    junction), then insert the resolved junction vertex between segments.
  const result: Point2D[] = [];

  for (let j = 0; j < segments.length; j++) {
    const seg = segments[j];
    const isFirst = j === 0;
    const isLast  = j === segments.length - 1;

    // Slice bounds: skip first if the preceding junction already contributed
    // that vertex; skip last if the following junction will replace it.
    const from = isFirst ? 0           : 1;
    const to   = isLast  ? seg.length  : seg.length - 1;

    result.push(...seg.slice(from, to));

    if (!isLast) {
      result.push(resolveOffsetJunction(seg, segments[j + 1], offsetDist));
    }
  }

  return result;
}

/**
 * Automatically calculates smooth Bezier control points for a set of path points.
 */
export function smoothBezierControlPoints(points: Point2D[]): { cpLeft: Point2D[], cpRight: Point2D[] } {
  const n = points.length;
  const cpLeft: Point2D[] = [];
  const cpRight: Point2D[] = [];

  // Initialize
  for (let i = 0; i < n; i++) {
    cpLeft.push({ ...points[i] });
    cpRight.push({ ...points[i] });
  }

  if (n < 2) return { cpLeft, cpRight };

  // For intermediate nodes
  for (let i = 1; i < n - 1; i++) {
    const pPrev = points[i - 1];
    const pCurr = points[i];
    const pNext = points[i + 1];

    const vx = pNext.x - pPrev.x;
    const vy = pNext.y - pPrev.y;
    const len = Math.hypot(vx, vy);

    if (len > 0.0001) {
      const ux = vx / len;
      const uy = vy / len;

      const dPrev = Math.hypot(pCurr.x - pPrev.x, pCurr.y - pPrev.y);
      const dNext = Math.hypot(pNext.x - pCurr.x, pNext.y - pCurr.y);

      const scale = 0.25;

      cpLeft[i] = {
        x: pCurr.x - ux * dPrev * scale,
        y: pCurr.y - uy * dPrev * scale,
      };

      cpRight[i] = {
        x: pCurr.x + ux * dNext * scale,
        y: pCurr.y + uy * dNext * scale,
      };
    }
  }

  // Handle start point (i = 0)
  if (n >= 2) {
    const p0 = points[0];
    const p1 = points[1];
    const vx = p1.x - p0.x;
    const vy = p1.y - p0.y;
    const len = Math.hypot(vx, vy);
    if (len > 0.0001) {
      const ux = vx / len;
      const uy = vy / len;
      const scale = 0.25;
      const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      cpRight[0] = {
        x: p0.x + ux * d * scale,
        y: p0.y + uy * d * scale,
      };
      cpLeft[0] = { ...p0 };
    }
  }

  // Handle end point (i = n - 1)
  if (n >= 2) {
    const pEnd = points[n - 1];
    const pPrevEnd = points[n - 2];
    const vx = pEnd.x - pPrevEnd.x;
    const vy = pEnd.y - pPrevEnd.y;
    const len = Math.hypot(vx, vy);
    if (len > 0.0001) {
      const ux = vx / len;
      const uy = vy / len;
      const scale = 0.25;
      const d = Math.hypot(pEnd.x - pPrevEnd.x, pEnd.y - pPrevEnd.y);
      cpLeft[n - 1] = {
        x: pEnd.x - ux * d * scale,
        y: pEnd.y - uy * d * scale,
      };
      cpRight[n - 1] = { ...pEnd };
    }
  }

  return { cpLeft, cpRight };
}

/**
 * Computes the minimum radius of curvature along a Cubic Bezier Curve.
 */
export function getBezierMinRadiusOfCurvature(
  A: Point2D,
  C1: Point2D,
  C2: Point2D,
  B: Point2D
): number {
  let minR = Infinity;
  const steps = 50;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const mt = 1 - t;

    // Derivatives: B'(t) and B''(t)
    const dx = 3 * mt * mt * (C1.x - A.x) + 6 * mt * t * (C2.x - C1.x) + 3 * t * t * (B.x - C2.x);
    const dy = 3 * mt * mt * (C1.y - A.y) + 6 * mt * t * (C2.y - C1.y) + 3 * t * t * (B.y - C2.y);

    const d2x = 6 * mt * (C2.x - 2 * C1.x + A.x) + 6 * t * (B.x - 2 * C2.x + C1.x);
    const d2y = 6 * mt * (C2.y - 2 * C1.y + A.y) + 6 * t * (B.y - 2 * C2.y + C1.y);

    const speed2 = dx * dx + dy * dy;
    const speed = Math.sqrt(speed2);
    if (speed < 1e-4) continue;

    const numerator = dx * d2y - dy * d2x;
    if (Math.abs(numerator) < 1e-6) continue;

    const curvature = Math.abs(numerator) / (speed2 * speed);
    const R = 1 / curvature;
    if (R < minR) {
      minR = R;
    }
  }
  return minR;
}

/**
 * Calculates widening w based on outer curve radius Ro and design vehicle.
 * Approximates Japan's and Taiwan's intersection design standards.
 */
export function calculateWidening(Ro: number, designVehicle: 'passenger' | 'semi_trailer' | 'articulated'): number {
  if (designVehicle === 'passenger') {
    if (Ro < 8) return 5.5;
    if (Ro < 12) return 4.75;
    if (Ro < 16) return 4.25;
    if (Ro < 20) return 3.75;
    if (Ro < 30) return 3.5;
    return 3.25;
  } else if (designVehicle === 'semi_trailer') {
    // Semi-trailer / 大客車/大貨車
    if (Ro < 8) return 10.0;
    if (Ro < 10) return 9.0;
    if (Ro < 13) return 8.0;
    if (Ro < 17) return 7.25;
    if (Ro < 22) return 6.25;
    if (Ro < 30) return 5.25;
    return 4.5;
  } else {
    // Articulated / 聯結車
    if (Ro < 8) return 11.5;
    if (Ro < 10) return 10.5;
    if (Ro < 13) return 9.5;
    if (Ro < 17) return 8.5;
    if (Ro < 22) return 7.5;
    if (Ro < 30) return 6.25;
    return 5.25;
  }
}

/**
 * Offsets a line segment by a distance 'd'
 * Positive 'd' offsets in direction of positive normal (90 deg CCW)
 */
export function offsetSegment(a: Point2D, b: Point2D, d: number): { p1: Point2D; p2: Point2D } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  
  if (len === 0) {
    return { p1: a, p2: b };
  }
  
  // Normal vector: 90 deg CCW
  const nx = -dy / len;
  const ny = dx / len;
  
  return {
    p1: { x: a.x + nx * d, y: a.y + ny * d },
    p2: { x: b.x + nx * d, y: b.y + ny * d },
  };
}

/**
 * Generates the closed polygon representing the channelizing island (導流島)
 * by offsetting the three-centered curve inwards by the computed lane width (w)
 * and intersecting with the inwards-offset straight roads.
 */
export function generateChannelizingIsland(
  curve: ThreeCenterCurveElement,
  laneWidth: number,
  designVehicle: 'passenger' | 'semi_trailer' = 'semi_trailer'
): Point2D[] {
  const { pStart, pIntersection, pEnd, R2, O1, O2, O3, T1, T2, points, color } = curve;
  
  const R1 = 3 * R2;
  const R3 = 3 * R2;
  
  // Find which way is inwards
  const u1 = normalize({ x: pStart.x - pIntersection.x, y: pStart.y - pIntersection.y });
  const u2 = normalize({ x: pEnd.x - pIntersection.x, y: pEnd.y - pIntersection.y });
  const b = normalize({ x: u1.x + u2.x, y: u1.y + u2.y });
  const isCcw = crossProduct(u1, u2) > 0;
  
  // Calculate inner curve radii
  const r1_offset = R1 - laneWidth;
  const r2_offset = R2 - laneWidth;
  const r3_offset = R3 - laneWidth;
  
  // If radius becomes too small or negative, cap it
  const r1_prime = Math.max(0.5, r1_offset);
  const r2_prime = Math.max(0.5, r2_offset);
  const r3_prime = Math.max(0.5, r3_offset);
  
  // Inward offset tangent points
  const n1 = getInwardNormal(u1, b);
  const n2 = getInwardNormal(u2, b);
  
  const T1_offset = {
    x: T1.x + laneWidth * n1.x,
    y: T1.y + laneWidth * n1.y,
  };
  
  const T2_offset = {
    x: T2.x + laneWidth * n2.x,
    y: T2.y + laneWidth * n2.y,
  };
  
  // Re-calculate the contact points for the offset circles
  // Since O1, O2, O3 are the same centers:
  const u12 = normalize({ x: O2.x - O1.x, y: O2.y - O1.y });
  const C12_offset = {
    x: O1.x + u12.x * r1_prime,
    y: O1.y + u12.y * r1_prime,
  };
  
  const u32 = normalize({ x: O2.x - O3.x, y: O2.y - O3.y });
  const C23_offset = {
    x: O3.x + u32.x * r3_prime,
    y: O3.y + u32.y * r3_prime,
  };
  
  // Sample offset arcs code
  const arc1 = sampleArc(O1, r1_prime, T1_offset, C12_offset, isCcw, 12);
  const arc2 = sampleArc(O2, r2_prime, C12_offset, C23_offset, isCcw, 12);
  const arc3 = sampleArc(O3, r3_prime, C23_offset, T2_offset, isCcw, 12);
  
  const curvePoints = [
    ...arc1,
    ...arc2.slice(1),
    ...arc3.slice(1)
  ];
  
  // Island third corner: where the two straight road edges shifted inwards intersect
  // This is P_v shifted inwards on the angle bisector
  const sinAlphaHalf = Math.sin(Math.acos(dot(u1, u2)) / 2);
  const d_shift = laneWidth / sinAlphaHalf;
  
  const P_island_corner = {
    x: pIntersection.x + d_shift * b.x,
    y: pIntersection.y + d_shift * b.y,
  };
  
  // Closed polygon vertices:
  // Offset curve T1_offset -> T2_offset
  // Segment to P_island_corner
  // Segment back to T1_offset
  return [
    ...curvePoints,
    P_island_corner,
    T1_offset, // close loop precisely
  ];
}

/**
 * Calculates a 45-degree hatching fill lines within a polygon
 * For pavement markings (槽化線 / Standard solid double borders, inner diagonal yellow or white lines)
 * angle = 45 degrees, spacing in meters, line thickness 15-20cm
 */
export function generateHatchingLines(
  polygon: Point2D[],
  spacing: number = 0.4, // meter
  angleDeg: number = 45
): Array<{ p1: Point2D; p2: Point2D }> {
  if (polygon.length < 3) return [];
  
  // Find polygon bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of polygon) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  
  // We need to sweep lines with direction (cos(ang), sin(ang))
  const rad = angleDeg * (Math.PI / 180);
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  
  // Perpendicular vector for spacing
  const px = -dy;
  const py = dx;
  
  // Projects vertices along the perpendicular to find sweep range
  let minProj = Infinity;
  let maxProj = -Infinity;
  for (const p of polygon) {
    const proj = p.x * px + p.y * py;
    if (proj < minProj) minProj = proj;
    if (proj > maxProj) maxProj = proj;
  }
  
  const hatchingLines: Array<{ p1: Point2D; p2: Point2D }> = [];
  
  // Draw parallel lines at step intervals
  // Give some padding
  const startProj = Math.floor(minProj / spacing) * spacing;
  const endProj = Math.ceil(maxProj / spacing) * spacing;
  
  for (let pr = startProj; pr <= endProj; pr += spacing) {
    // Collect all intersections of the sweep line with polygon edges
    // Sweep line equation: x * px + y * py = pr
    // Intersection with segment (A, B):
    const intersections: Point2D[] = [];
    
    for (let i = 0; i < polygon.length; i++) {
      const A = polygon[i];
      const B = polygon[(i + 1) % polygon.length];
      
      // Infinite line (A, B) intersection with sweep line
      // A + t * (B - A) dot p = pr
      // A_dot_p + t * (B_minus_A_dot_p) = pr
      // t = (pr - A_dot_p) / ((B - A) dot p)
      const AdotP = A.x * px + A.y * py;
      const BdotP = B.x * px + B.y * py;
      const denom = BdotP - AdotP;
      
      if (Math.abs(denom) > 1e-6) {
        const t = (pr - AdotP) / denom;
        if (t >= 0 && t <= 1) {
          const intersectPt = {
            x: A.x + t * (B.x - A.x),
            y: A.y + t * (B.y - A.y),
          };
          
          // Avoid tiny duplicates
          if (!intersections.some(pt => distance(pt, intersectPt) < 1e-4)) {
            intersections.push(intersectPt);
          }
        }
      }
    }
    
    // Sort intersections along the sweeping direction (dx, dy)
    if (intersections.length >= 2) {
      intersections.sort((a, b) => {
        const projA = a.x * dx + a.y * dy;
        const projB = b.x * dx + b.y * dy;
        return projA - projB;
      });
      
      // Pair intersections (for convex, it's just 1 pair, for concave can be more)
      for (let k = 0; k < intersections.length - 1; k += 2) {
        hatchingLines.push({
          p1: intersections[k],
          p2: intersections[k + 1],
        });
      }
    }
  }
  
  return hatchingLines;
}

/**
 * Helper to get bezier points for any line style element
 */
export function getLineBezierRepresentation(el: any): { points: Point2D[], cpLeft: Point2D[], cpRight: Point2D[] } | null {
  if (el.points && el.points.length > 0) {
    return {
      points: el.points,
      cpLeft: el.cpLeft || el.points,
      cpRight: el.cpRight || el.points
    };
  } else if (el.p1 && el.p2) {
    return {
      points: [el.p1, el.p2],
      cpLeft: [el.p1, el.p2],
      cpRight: [el.p1, el.p2]
    };
  }
  return null;
}

/**
 * Formats geometry data as a standardized CAD AutoCAD DXF file string
 */
export function exportToDXF(elements: CadElement[]): string {
  let dxf = `  0
SECTION
  2
HEADER
  0
ENDSEC
  0
SECTION
  2
ENTITIES
`;

  elements.forEach((el) => {
    if (el.type === 'guideline' || el.type === 'yellow_double' || el.type === 'white_double' || el.type === 'white_dashed' || el.type === 'yellow_dashed' || el.type === 'white_solid' || el.type === 'BuildingLine' || el.type === 'crossing_dashed' || el.type === 'stop_line' || el.type === 'yield_line' || el.type === 'Sidewalk' || el.type === 'reversible_lane' || el.type === 'bicycle_lane') {
      const layer = el.type === 'yellow_double' ? 'MARKING_YELLOW_DOUBLE' 
                  : el.type === 'white_double' ? 'MARKING_WHITE_DOUBLE'
                  : el.type === 'white_dashed' ? 'MARKING_WHITE_DASHED'
                  : el.type === 'yellow_dashed' ? 'MARKING_YELLOW_DASHED'
                  : el.type === 'white_solid' ? 'MARKING_WHITE_SOLID'
                  : el.type === 'crossing_dashed' ? 'MARKING_CROSSING_DASHED'
                  : el.type === 'stop_line' ? 'MARKING_STOP_LINE'
                  : el.type === 'yield_line' ? 'MARKING_YIELD_LINE'
                  : el.type === 'Sidewalk' ? 'PAVEMENT_SIDEWALK'
                  : el.type === 'BuildingLine' ? 'BUILDING_LINES'
                  : el.type === 'reversible_lane' ? 'MARKING_REVERSIBLE_LANE'
                  : el.type === 'bicycle_lane' ? 'PAVEMENT_BICYCLE_LANE'
                  : 'GUIDELINE_ROADS';
                  
      const ref = getLineBezierRepresentation(el);
      
      if (ref) {
        if (el.type === 'yellow_double' || el.type === 'white_double') {
          // Double lines offset with normal vector math
          const leftCurve = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0.1, 20);
          const rightCurve = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, -0.1, 20);
          
          for (let i = 0; i < leftCurve.length - 1; i++) {
            const p1 = leftCurve[i];
            const p2 = leftCurve[i + 1];
            dxf += `  0
LINE
  8
${layer}
 10
${p1.x.toFixed(4)}
 20
${p1.y.toFixed(4)}
 30
0.0
 11
${p2.x.toFixed(4)}
 21
${p2.y.toFixed(4)}
 31
0.0
`;
          }
          for (let i = 0; i < rightCurve.length - 1; i++) {
            const p1 = rightCurve[i];
            const p2 = rightCurve[i + 1];
            dxf += `  0
LINE
  8
${layer}
 10
${p1.x.toFixed(4)}
 20
${p1.y.toFixed(4)}
 30
0.0
 11
${p2.x.toFixed(4)}
 21
${p2.y.toFixed(4)}
 31
0.0
`;
          }
        } else if (el.type === 'white_dashed' || el.type === 'yellow_dashed') {
          // Dashboard white line with gaps
          const tPoints = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 40);
          let accumulatedDist = 0;
          for (let i = 0; i < tPoints.length - 1; i++) {
            const p1 = tPoints[i];
            const p2 = tPoints[i + 1];
            const d = distance(p1, p2);
            accumulatedDist += d;
            
            const cycle = accumulatedDist % 10;
            if (cycle < 4) {
              dxf += `  0
LINE
  8
${layer}
 10
${p1.x.toFixed(4)}
 20
${p1.y.toFixed(4)}
 30
0.0
 11
${p2.x.toFixed(4)}
 21
${p2.y.toFixed(4)}
 31
0.0
`;
            }
          }
        } else {
          // guideline or white_solid
          const tPoints = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 35);
          for (let i = 0; i < tPoints.length - 1; i++) {
            const p1 = tPoints[i];
            const p2 = tPoints[i + 1];
            dxf += `  0
LINE
  8
${layer}
 10
${p1.x.toFixed(4)}
 20
${p1.y.toFixed(4)}
 30
0.0
 11
${p2.x.toFixed(4)}
 21
${p2.y.toFixed(4)}
 31
0.0
`;
          }
        }
      }
    } else if (el.type === 'sketch_circle') {
      const circ = el as any;
      dxf += `  0
CIRCLE
  8
SKETCH_DRAUGHT_CIRCLES
 10
${circ.center.x.toFixed(4)}
 20
${circ.center.y.toFixed(4)}
 30
0.0
 40
${circ.radius.toFixed(4)}
`;
    } else if (el.type === 'three_center_curve') {
      const curve = el as ThreeCenterCurveElement;
      for (let i = 0; i < curve.points.length - 1; i++) {
        const p1 = curve.points[i];
        const p2 = curve.points[i + 1];
        dxf += `  0
LINE
  8
CURVE_THREE_CENTER
 10
${p1.x.toFixed(4)}
 20
${p1.y.toFixed(4)}
 30
0.0
 11
${p2.x.toFixed(4)}
 21
${p2.y.toFixed(4)}
 31
0.0
`;
      }
    } else if (el.type === 'island') {
      const island = el as any;
      const hasBezier = island.cpLeft && island.cpRight && island.cpLeft.length === island.points.length;
      const boundaryPoints = hasBezier 
        ? sampleClosedBezierLoop(island.points, island.cpLeft, island.cpRight, 20)
        : island.points;
      
      // Output Polygon Contour as LWPOLYLINE
      dxf += `  0
LWPOLYLINE
  8
CHANNELIZING_ISLAND_BORDER
 90
${boundaryPoints.length}
 70
1
`;
      boundaryPoints.forEach((p) => {
        dxf += ` 10
${p.x.toFixed(4)}
 20
${p.y.toFixed(4)}
`;
      });
      
      // Output Hatching Lines if active
      if (island.hasHatching) {
        const hatchLines = generateHatchingLines(boundaryPoints, 0.4, 45);
        hatchLines.forEach((hl) => {
          dxf += `  0
LINE
  8
CHANNELIZING_ISLAND_HATCH
 10
${hl.p1.x.toFixed(4)}
 20
${hl.p1.y.toFixed(4)}
 30
0.0
 11
${hl.p2.x.toFixed(4)}
 21
${hl.p2.y.toFixed(4)}
 31
0.0
`;
        });
      }
    } else if (el.type === 'text') {
      const txt = el as any;
      dxf += `  0
TEXT
  8
TEXT_ANNOTATION
 10
${txt.p.x.toFixed(4)}
 20
${txt.p.y.toFixed(4)}
 30
0.0
 40
${txt.fontSize.toFixed(4)}
   1
${txt.text}
`;
    } else if (el.type === 'smart_path') {
      const sp = el as any;
      if (sp.points && sp.points.length > 1) {
        for (let j = 0; j < sp.points.length - 1; j++) {
          const ptStart = sp.points[j];
          const cpStart = sp.cpRight[j];
          const cpEnd = sp.cpLeft[j + 1];
          const ptEnd = sp.points[j + 1];
          const segPoints = sampleCubicBezier(ptStart, cpStart, cpEnd, ptEnd, 30);
          for (let i = 0; i < segPoints.length - 1; i++) {
            const p1 = segPoints[i];
            const p2 = segPoints[i + 1];
            dxf += `  0
LINE
  8
SMART_PATH_CURVE
 10
${p1.x.toFixed(4)}
 20
${p1.y.toFixed(4)}
 30
0.0
 11
${p2.x.toFixed(4)}
 21
${p2.y.toFixed(4)}
 31
0.0
`;
          }
        }
      }
    } else if (el.type === 'crosswalk') {
      const cw = el as CrosswalkElement;
      const stripeWidth = cw.stripeWidth ?? 0.4;
      const stripeGap = cw.stripeGap ?? 0.4;
      const stripes = generateCrosswalkStripes(cw.pA1, cw.pA2, cw.pB1, cw.pB2, stripeWidth, stripeGap);
      
      stripes.forEach((stripe) => {
        dxf += `  0
LWPOLYLINE
  8
PEDESTRIAN_CROSSWALK_STRIPE
 90
4
 70
1
 10
${stripe.p1.x.toFixed(4)}
 20
${stripe.p1.y.toFixed(4)}
 10
${stripe.p2.x.toFixed(4)}
 20
${stripe.p2.y.toFixed(4)}
 10
${stripe.p3.x.toFixed(4)}
 20
${stripe.p3.y.toFixed(4)}
 10
${stripe.p4.x.toFixed(4)}
 20
${stripe.p4.y.toFixed(4)}
`;
      });
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

      const lines = [
        { p1: c1, p2: c2 },
        { p1: c2, p2: c3 },
        { p1: c3, p2: c4 },
        { p1: c4, p2: c1 }
      ];

      lines.forEach(line => {
        dxf += `  0
LINE
  8
PARKING_SLOTS
 10
${line.p1.x.toFixed(4)}
 20
${line.p1.y.toFixed(4)}
 30
0.0
 11
${line.p2.x.toFixed(4)}
 21
${line.p2.y.toFixed(4)}
 31
0.0
`;
      });
    } else if (el.type === 'parking_zone') {
      const slots = generateParkingZoneSlots(el as any);
      slots.forEach((slot) => {
        const lines = [
          { p1: slot.corners[0], p2: slot.corners[1] },
          { p1: slot.corners[1], p2: slot.corners[2] },
          { p1: slot.corners[2], p2: slot.corners[3] },
          { p1: slot.corners[3], p2: slot.corners[0] }
        ];

        lines.forEach(line => {
          dxf += `  0
LINE
  8
PARKING_SLOTS
 10
${line.p1.x.toFixed(4)}
 20
${line.p1.y.toFixed(4)}
 30
0.0
 11
${line.p2.x.toFixed(4)}
 21
${line.p2.y.toFixed(4)}
 31
0.0
`;
        });
      });
    } else if (el.type === 'road_arrow') {
      const arrow = el as any;
      const boundaryPoints = getRoadArrowOutlinePoints(arrow);
      dxf += `  0
LWPOLYLINE
  8
MARKING_ROAD_ARROWS
 90
${boundaryPoints.length}
 70
1
`;
      boundaryPoints.forEach((p) => {
        dxf += ` 10
${p.x.toFixed(4)}
 20
${p.y.toFixed(4)}
`;
      });
    }
  });


  dxf += `  0
ENDSEC
  0
EOF
`;

  return dxf;
}

export interface Polygon4D {
  p1: Point2D;
  p2: Point2D;
  p3: Point2D;
  p4: Point2D;
}

export function generateCrosswalkStripes(
  pA1: Point2D,
  pA2: Point2D,
  pB1: Point2D,
  pB2: Point2D,
  stripeWidth: number = 0.4,
  stripeGap: number = 0.4
): Polygon4D[] {
  const lenA = distance(pA1, pA2);
  const lenB = distance(pB1, pB2);
  if (lenA < 0.1 || lenB < 0.1) return [];

  const stripeCycle = stripeWidth + stripeGap; // 0.8
  const maxLen = Math.max(lenA, lenB);
  const halfMaxCycle = Math.ceil(maxLen / stripeCycle) + 2;

  const stripes: Polygon4D[] = [];

  for (let i = -halfMaxCycle; i <= halfMaxCycle; i++) {
    const startA_val = lenA / 2 + i * stripeCycle - stripeWidth / 2;
    const endA_val = lenA / 2 + i * stripeCycle + stripeWidth / 2;

    const startB_val = lenB / 2 + i * stripeCycle - stripeWidth / 2;
    const endB_val = lenB / 2 + i * stripeCycle + stripeWidth / 2;

    // Clamp values to line lengths to maintain exact boundary edges without exceeding boundaries
    const sA = Math.max(0, Math.min(lenA, startA_val));
    const eA = Math.max(0, Math.min(lenA, endA_val));

    const sB = Math.max(0, Math.min(lenB, startB_val));
    const eB = Math.max(0, Math.min(lenB, endB_val));

    // Must have a significant visible part to render
    if (eA - sA < 0.05 || eB - sB < 0.05) {
      continue;
    }

    const tStartA = sA / lenA;
    const tEndA = eA / lenA;

    const tStartB = sB / lenB;
    const tEndB = eB / lenB;

    const pA_left = lerp(pA1, pA2, tStartA);
    const pA_right = lerp(pA1, pA2, tEndA);

    const pB_left = lerp(pB1, pB2, tStartB);
    const pB_right = lerp(pB1, pB2, tEndB);

    stripes.push({
      p1: pA_left,
      p2: pA_right,
      p3: pB_right,
      p4: pB_left
    });
  }

  return stripes;
}

export interface ParkingZoneSlot {
  corners: Point2D[];
  slotType: 'car' | 'motorcycle';
  width: number;
  length: number;
  angle: number;
}

export function generateParkingZoneSlots(
  zone: {
    points: Point2D[];
    cpLeft?: Point2D[];
    cpRight?: Point2D[];
    slotType?: 'car' | 'motorcycle';
    width?: number;
    length?: number;
    angle?: number;
    gap?: number;
    side?: 'left' | 'right';
  }
): ParkingZoneSlot[] {
  const points = zone.points;
  if (!points || points.length < 2) return [];
  const cpLeft = zone.cpLeft || points;
  const cpRight = zone.cpRight || points;

  // 1. Sample the curve centerline
  const subdivisions = 150;
  const centerPts: Point2D[] = [];
  const numSegments = points.length - 1;
  const samplesPerSeg = Math.max(10, Math.ceil(subdivisions / numSegments));

  for (let s = 0; s < numSegments; s++) {
    const pStart = points[s];
    const cpStart = cpRight[s] || pStart;
    const cpEnd = cpLeft[s + 1] || points[s + 1];
    const pEnd = points[s + 1];

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

  if (centerPts.length < 2) return [];

  // 2. Cumulative distance
  const dists: number[] = [0];
  let totalLength = 0;
  for (let i = 1; i < centerPts.length; i++) {
    totalLength += distance(centerPts[i - 1], centerPts[i]);
    dists.push(totalLength);
  }

  const interpolateAtDistance = (d: number) => {
    if (d <= 0) {
      const tangent = normalize({ x: centerPts[1].x - centerPts[0].x, y: centerPts[1].y - centerPts[0].y });
      return { pt: centerPts[0], tangent };
    }
    if (d >= totalLength) {
      const last = centerPts.length - 1;
      const tangent = normalize({ x: centerPts[last].x - centerPts[last - 1].x, y: centerPts[last].y - centerPts[last - 1].y });
      return { pt: centerPts[last], tangent };
    }
    for (let i = 0; i < dists.length - 1; i++) {
      if (d >= dists[i] && d <= dists[i + 1]) {
        const ratio = (d - dists[i]) / (dists[i + 1] - dists[i] || 0.001);
        const pt = {
          x: centerPts[i].x + (centerPts[i + 1].x - centerPts[i].x) * ratio,
          y: centerPts[i].y + (centerPts[i + 1].y - centerPts[i].y) * ratio
        };
        const tangent = normalize({ x: centerPts[i + 1].x - centerPts[i].x, y: centerPts[i + 1].y - centerPts[i].y });
        return { pt, tangent };
      }
    }
    return { pt: centerPts[0], tangent: { x: 1, y: 0 } };
  };

  // 3. Spacing step
  const W = zone.width ?? 2.0;
  const L = zone.length ?? 5.0;
  const G = zone.gap ?? 0.2;
  const slotAngleDeg = zone.angle ?? 90;
  const absAngleDeg = Math.abs(slotAngleDeg);

  let step = 0;
  if (absAngleDeg < 10) {
    step = L + G;
  } else {
    const sinVal = Math.sin(absAngleDeg * Math.PI / 180);
    step = (W + G) / sinVal;
    step = Math.min(L + G, step);
  }

  if (step < 0.1) return [];

  // 4. Distribute
  const numSlots = Math.floor(totalLength / step);
  if (numSlots <= 0) return [];

  const occupied = numSlots * step - G;
  const margin = Math.max(0, (totalLength - occupied) / 2);

  const slots: ParkingZoneSlot[] = [];
  const side = zone.side || 'right';
  const sideSign = side === 'left' ? 1 : -1;

  for (let i = 0; i < numSlots; i++) {
    const s_i = margin + i * step;
    const { pt, tangent } = interpolateAtDistance(s_i);

    const slotNormal = { x: -tangent.y * sideSign, y: tangent.x * sideSign };
    const angleRad = slotAngleDeg * Math.PI / 180;

    const ux = tangent.x * Math.cos(angleRad) + slotNormal.x * Math.sin(angleRad);
    const uy = tangent.y * Math.cos(angleRad) + slotNormal.y * Math.sin(angleRad);
    const lenU = Math.hypot(ux, uy) || 0.001;
    const u = { x: ux / lenU, y: uy / lenU };

    const v = { x: -u.y, y: u.x };

    const c1 = pt;
    const c2 = { x: pt.x + u.x * L, y: pt.y + u.y * L };
    const c3 = { x: pt.x + u.x * L + v.x * W, y: pt.y + u.y * L + v.y * W };
    const c4 = { x: pt.x + v.x * W, y: pt.y + v.y * W };

    slots.push({
      corners: [c1, c2, c3, c4],
      slotType: zone.slotType || 'car',
      width: W,
      length: L,
      angle: slotAngleDeg
    });
  }

  return slots;
}

export function lineSegmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D): boolean {
  const det = (b.x - a.x) * (d.y - c.y) - (d.x - c.x) * (b.y - a.y);
  if (Math.abs(det) < 1e-9) return false;
  const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / det;
  const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / det;
  return (t >= 0 && t <= 1 && u >= 0 && u <= 1);
}

export interface SweptPathResult {
  tractorEnvelopes: Polygon4D[]; 
  trailerEnvelopes?: Polygon4D[]; 
  leftRibbon: Point2D[]; 
  rightRibbon: Point2D[]; 
}

export function generateVehicleSweptPath(
  pathPoints: Point2D[],
  vehicleType: 'passenger' | 'semi_trailer' | 'articulated'
): SweptPathResult {
  if (pathPoints.length < 2) {
    return { tractorEnvelopes: [], leftRibbon: [], rightRibbon: [] };
  }

  let wheelbase = 2.7;
  let rearWheelbase = 5.5;
  let width = 1.8;
  let frontOverhang = 0.9;
  let rearOverhang = 0.8;

  if (vehicleType === 'semi_trailer') {
    wheelbase = 6.5;
    width = 2.5;
    frontOverhang = 1.2;
    rearOverhang = 1.5;
  } else if (vehicleType === 'articulated') {
    wheelbase = 6.5;
    rearWheelbase = 5.5;
    width = 2.6;
    frontOverhang = 1.3;
    rearOverhang = 1.5;
  }

  const halfWidth = width / 2;

  // Dense resampling along segments
  const densePath: Point2D[] = [];
  const stepSize = 0.35;
  densePath.push(pathPoints[0]);

  for (let i = 0; i < pathPoints.length - 1; i++) {
    const p1 = pathPoints[i];
    const p2 = pathPoints[i + 1];
    const dist = distance(p1, p2);
    if (dist < 0.01) continue;

    const numSteps = Math.ceil(dist / stepSize);
    for (let s = 1; s <= numSteps; s++) {
      const t = s / numSteps;
      densePath.push({
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
      });
    }
  }

  if (densePath.length < 2) {
    return { tractorEnvelopes: [], leftRibbon: [], rightRibbon: [] };
  }

  const tractorFront = densePath;
  const tractorRear: Point2D[] = [];

  const initDir = normalize({
    x: tractorFront[1].x - tractorFront[0].x,
    y: tractorFront[1].y - tractorFront[0].y,
  });
  tractorRear.push({
    x: tractorFront[0].x - initDir.x * wheelbase,
    y: tractorFront[0].y - initDir.y * wheelbase,
  });

  for (let i = 1; i < tractorFront.length; i++) {
    const prevRear = tractorRear[i - 1];
    const currFront = tractorFront[i];
    const dir = normalize({
      x: currFront.x - prevRear.x,
      y: currFront.y - prevRear.y,
    });
    tractorRear.push({
      x: currFront.x - dir.x * wheelbase,
      y: currFront.y - dir.y * wheelbase,
    });
  }

  const trailerRear: Point2D[] = [];
  if (vehicleType === 'articulated') {
    const initTrailerDir = normalize({
      x: tractorRear[1].x - tractorRear[0].x,
      y: tractorRear[1].y - tractorRear[0].y,
    });
    trailerRear.push({
      x: tractorRear[0].x - initTrailerDir.x * rearWheelbase,
      y: tractorRear[0].y - initTrailerDir.y * rearWheelbase,
    });

    for (let i = 1; i < tractorRear.length; i++) {
      const prevTrailerRear = trailerRear[i - 1];
      const currTractorRear = tractorRear[i];
      const dir = normalize({
        x: currTractorRear.x - prevTrailerRear.x,
        y: currTractorRear.y - prevTrailerRear.y,
      });
      trailerRear.push({
        x: currTractorRear.x - dir.x * rearWheelbase,
        y: currTractorRear.y - dir.y * rearWheelbase,
      });
    }
  }

  const tractorEnvelopes: Polygon4D[] = [];
  const trailerEnvelopes: Polygon4D[] = [];
  const leftRibbon: Point2D[] = [];
  const rightRibbon: Point2D[] = [];

  for (let i = 0; i < densePath.length; i++) {
    const f = tractorFront[i];
    const r = tractorRear[i];

    const dirX = f.x - r.x;
    const dirY = f.y - r.y;
    const len = Math.hypot(dirX, dirY);
    if (len < 0.01) continue;

    const u = { x: dirX / len, y: dirY / len };
    const n = { x: -u.y, y: u.x };

    const fl = { x: f.x + u.x * frontOverhang + n.x * halfWidth, y: f.y + u.y * frontOverhang + n.y * halfWidth };
    const fr = { x: f.x + u.x * frontOverhang - n.x * halfWidth, y: f.y + u.y * frontOverhang - n.y * halfWidth };
    const rl = { x: r.x - u.x * rearOverhang + n.x * halfWidth, y: r.y - u.y * rearOverhang + n.y * halfWidth };
    const rr = { x: r.x - u.x * rearOverhang - n.x * halfWidth, y: r.y - u.y * rearOverhang - n.y * halfWidth };

    tractorEnvelopes.push({ p1: fl, p2: fr, p3: rr, p4: rl });

    if (vehicleType === 'articulated') {
      const tr = trailerRear[i];
      const tDirX = r.x - tr.x;
      const tDirY = r.y - tr.y;
      const tLen = Math.hypot(tDirX, tDirY);
      if (tLen >= 0.01) {
        const tu = { x: tDirX / tLen, y: tDirY / tLen };
        const tn = { x: -tu.y, y: tu.x };

        const tfl = { x: r.x + tn.x * halfWidth, y: r.y + tn.y * halfWidth };
        const tfr = { x: r.x - tn.x * halfWidth, y: r.y - tn.y * halfWidth };
        const trl = { x: tr.x - tu.x * 1.5 + tn.x * halfWidth, y: tr.y - tu.y * 1.5 + tn.y * halfWidth };
        const trr = { x: tr.x - tu.x * 1.5 - tn.x * halfWidth, y: tr.y - tu.y * 1.5 - tn.y * halfWidth };

        trailerEnvelopes.push({ p1: tfl, p2: tfr, p3: trr, p4: trl });

        leftRibbon.push(fl, tfl, trl);
        rightRibbon.push(fr, tfr, trr);
      }
    } else {
      leftRibbon.push(fl, rl);
      rightRibbon.push(fr, rr);
    }
  }

  return {
    tractorEnvelopes,
    trailerEnvelopes: vehicleType === 'articulated' ? trailerEnvelopes : undefined,
    leftRibbon,
    rightRibbon,
  };
}

export function calculateSteeringAngle(
  pPrev: Point2D,
  pCurr: Point2D,
  pNext: Point2D,
  wheelbase: number
): number {
  const d1 = Math.hypot(pCurr.x - pPrev.x, pCurr.y - pPrev.y);
  const d2 = Math.hypot(pNext.x - pCurr.x, pNext.y - pCurr.y);
  if (d1 < 0.001 || d2 < 0.001) return 0;

  const theta1 = Math.atan2(pCurr.y - pPrev.y, pCurr.x - pPrev.x);
  const theta2 = Math.atan2(pNext.y - pCurr.y, pNext.x - pCurr.x);

  let dTheta = theta2 - theta1;
  while (dTheta > Math.PI) dTheta -= 2 * Math.PI;
  while (dTheta < -Math.PI) dTheta += 2 * Math.PI;

  const s = (d1 + d2) / 2;
  const curvature = dTheta / s;

  const steeringAngleRad = Math.atan(wheelbase * curvature);
  return Math.abs(steeringAngleRad * 180 / Math.PI);
}

export function getWheelbaseForVehicle(vehicleType: 'passenger' | 'semi_trailer' | 'articulated'): number {
  if (vehicleType === 'passenger') return 2.7;
  return 6.5;
}

export function getMaxSteeringAngleForPath(
  pathPoints: Point2D[],
  vehicleType: 'passenger' | 'semi_trailer' | 'articulated'
): number {
  if (pathPoints.length < 3) return 0;
  const wheelbase = getWheelbaseForVehicle(vehicleType);
  let maxAngle = 0;
  for (let i = 1; i < pathPoints.length - 1; i++) {
    const angle = calculateSteeringAngle(pathPoints[i - 1], pathPoints[i], pathPoints[i + 1], wheelbase);
    if (angle > maxAngle) maxAngle = angle;
  }
  return maxAngle;
}

export function getArcFromThreePoints(p1: Point2D, p2: Point2D, p3: Point2D, numPoints: number = 30): Point2D[] {
  // 計算經過 p1, p2, p3 的圓心 O 和半徑 R
  // 線段 p1-p2 的中垂線和 p2-p3 的中垂線交點即為圓心
  const d = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));
  if (Math.abs(d) < 1e-6) {
    // 三點共線，退化成折線
    const pts: Point2D[] = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      if (t < 0.5) {
        const t2 = t * 2;
        pts.push({ x: p1.x + t2 * (p2.x - p1.x), y: p1.y + t2 * (p2.y - p1.y) });
      } else {
        const t2 = (t - 0.5) * 2;
        pts.push({ x: p2.x + t2 * (p3.x - p2.x), y: p2.y + t2 * (p3.y - p2.y) });
      }
    }
    return pts;
  }

  const ux = ((p1.x * p1.x + p1.y * p1.y) * (p2.y - p3.y) + (p2.x * p2.x + p2.y * p2.y) * (p3.y - p1.y) + (p3.x * p3.x + p3.y * p3.y) * (p1.y - p2.y)) / d;
  const uy = ((p1.x * p1.x + p1.y * p1.y) * (p3.x - p2.x) + (p2.x * p2.x + p2.y * p2.y) * (p1.x - p3.x) + (p3.x * p3.x + p3.y * p3.y) * (p2.x - p1.x)) / d;
  const center = { x: ux, y: uy };
  const R = Math.hypot(p1.x - center.x, p1.y - center.y);

  // 計算起點、中點、終點相對於圓心的極角
  const a1 = Math.atan2(p1.y - center.y, p1.x - center.x);
  const a2 = Math.atan2(p2.y - center.y, p2.x - center.x);
  const a3 = Math.atan2(p3.y - center.y, p3.x - center.x);

  // 確定圓弧插值方向：順時針還是逆時針？
  // 我們需要讓角度從 a1 漸變到 a3，且路徑一定要經過 a2！
  let diff12 = a2 - a1;
  while (diff12 > Math.PI) diff12 -= 2 * Math.PI;
  while (diff12 < -Math.PI) diff12 += 2 * Math.PI;

  let diff23 = a3 - a2;
  while (diff23 > Math.PI) diff23 -= 2 * Math.PI;
  while (diff23 < -Math.PI) diff23 += 2 * Math.PI;

  const totalSweep = diff12 + diff23;
  const pts: Point2D[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    const angle = a1 + t * totalSweep;
    pts.push({
      x: center.x + R * Math.cos(angle),
      y: center.y + R * Math.sin(angle)
    });
  }
  return pts;
}

