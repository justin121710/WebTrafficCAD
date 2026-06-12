/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Point, PathPoint, VehicleConfig, CornerPoints, SimulationState, ControllerMode } from '../types';
import { distance, findClosestPointIndex } from './pathInterpolator';

/**
 * Calculates the 4 corners of the vehicle body based on the rear axle center,
 * heading, and the physical configuration of the vehicle.
 */
export function calculateCorners(
  rearAxle: Point,
  heading: number,
  config: VehicleConfig
): CornerPoints {
  const scale = config.scale;
  const L = config.L * scale;
  const W = config.W * scale;
  const Of = config.Of * scale;
  const Or = config.Or * scale;

  const cosTheta = Math.cos(heading);
  const sinTheta = Math.sin(heading);

  // u: Unit vector in the heading direction (forward)
  // v: Unit vector orthogonal to heading (to the left)
  const ux = cosTheta;
  const uy = sinTheta;
  const vx = -sinTheta;
  const vy = cosTheta;

  // Front-Left
  const fl = {
    x: rearAxle.x + (L + Of) * ux + (W / 2) * vx,
    y: rearAxle.y + (L + Of) * uy + (W / 2) * vy,
  };

  // Front-Right
  const fr = {
    x: rearAxle.x + (L + Of) * ux - (W / 2) * vx,
    y: rearAxle.y + (L + Of) * uy - (W / 2) * vy,
  };

  // Rear-Left
  const rl = {
    x: rearAxle.x - Or * ux + (W / 2) * vx,
    y: rearAxle.y - Or * uy + (W / 2) * vy,
  };

  // Rear-Right
  const rr = {
    x: rearAxle.x - Or * ux - (W / 2) * vx,
    y: rearAxle.y - Or * uy - (W / 2) * vy,
  };

  return { fl, fr, rl, rr };
}

/**
 * Calculates the 4 corners of the trailer body based on trailer rear axle,
 * heading and configuration.
 */
export function calculateTrailerCorners(
  trailerRearAxle: Point,
  trailerHeading: number,
  config: VehicleConfig
): CornerPoints {
  const scale = config.scale;
  const Lt = (config.Lt ?? 7.5) * scale;
  const Wt = (config.Wt ?? 2.5) * scale;
  const Oft = (config.Oft ?? 1.0) * scale;
  const Ort = (config.Ort ?? 1.8) * scale;

  const cosTheta = Math.cos(trailerHeading);
  const sinTheta = Math.sin(trailerHeading);

  const ux = cosTheta;
  const uy = sinTheta;
  const vx = -sinTheta;
  const vy = cosTheta;

  // For a trailer, the rear axle center is trailerRearAxle.
  // The trailer rotates around the hitch pin (located at tractor rear axle/pivot).
  // The distance between hitch pin and trailer rear axle is Lt.
  // So trailer corners are aligned with the trailer heading vector.
  const fl = {
    x: trailerRearAxle.x + (Lt + Oft) * ux + (Wt / 2) * vx,
    y: trailerRearAxle.y + (Lt + Oft) * uy + (Wt / 2) * vy,
  };

  const fr = {
    x: trailerRearAxle.x + (Lt + Oft) * ux - (Wt / 2) * vx,
    y: trailerRearAxle.y + (Lt + Oft) * uy - (Wt / 2) * vy,
  };

  const rl = {
    x: trailerRearAxle.x - Ort * ux + (Wt / 2) * vx,
    y: trailerRearAxle.y - Ort * uy + (Wt / 2) * vy,
  };

  const rr = {
    x: trailerRearAxle.x - Ort * ux - (Wt / 2) * vx,
    y: trailerRearAxle.y - Ort * uy - (Wt / 2) * vy,
  };

  return { fl, fr, rl, rr };
}

/**
 * Normalizes an angle into the range [-pi, pi].
 */
export function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

/**
 * Run vehicle simulator to generate the full array of simulation states.
 */
export function simulateVehicle(
  interpolatedPath: PathPoint[],
  config: VehicleConfig,
  mode: ControllerMode
): SimulationState[] {
  if (interpolatedPath.length < 2) return [];

  const scale = config.scale;
  const L_px = config.L * scale;

  if (mode === ControllerMode.FRONT_AXLE_DRAG) {
    return simulateFrontAxleDrag(interpolatedPath, config, L_px);
  } else {
    return simulateActivePurePursuit(interpolatedPath, config, L_px);
  }
}

/**
 * Mode 1: Front Axle Dragging (Tractrix trailing)
 * Front axle travels EXACTLY along the path points.
 * Rear axle is pulled behind, satisfying physical and kinematic constraints.
 */
function simulateFrontAxleDrag(
  path: PathPoint[],
  config: VehicleConfig,
  L_px: number
): SimulationState[] {
  const states: SimulationState[] = [];
  const scale = config.scale;
  const Lt_px = (config.Lt ?? 7.5) * scale;

  // Initial state setup
  const F_0 = path[0];
  const theta_0 = F_0.heading; // Align with the initial path tangent
  const dir = config.reverse ? -1 : 1;
  
  // R_0 is placed L distance behind F_0
  const R_0 = {
    x: F_0.x - dir * L_px * Math.cos(theta_0),
    y: F_0.y - dir * L_px * Math.sin(theta_0),
  };

  const corners_0 = calculateCorners(R_0, theta_0, config);

  let trailerState_0 = {};
  if (config.enableTrailer) {
    const R_trailer_0 = {
      x: R_0.x - dir * Lt_px * Math.cos(theta_0),
      y: R_0.y - dir * Lt_px * Math.sin(theta_0),
    };
    const trailerCorners_0 = calculateTrailerCorners(R_trailer_0, theta_0, config);
    trailerState_0 = {
      trailerRearAxle: R_trailer_0,
      trailerHeading: theta_0,
      trailerCorners: trailerCorners_0,
    };
  }

  states.push({
    frontAxle: { x: F_0.x, y: F_0.y },
    rearAxle: R_0,
    heading: theta_0,
    steering: 0,
    corners: corners_0,
    ...trailerState_0
  });

  // Calculate subsequent states
  for (let k = 1; k < path.length; k++) {
    const F_k = path[k];
    const R_prev = states[k - 1].rearAxle;

    // Direct vector from old rear axle R_(k-1) to new front axle F_k
    const dx = F_k.x - R_prev.x;
    const dy = F_k.y - R_prev.y;
    const d = Math.hypot(dx, dy);

    let R_k = { ...R_prev };
    if (d > 0.001) {
      // Rear axle is pulled towards the new front axle
      // maintaining exactly L wheelbase distance.
      R_k = {
        x: F_k.x - dir * L_px * (dx / d),
        y: F_k.y - dir * L_px * (dy / d),
      };
    }

    const heading_k = config.reverse 
      ? Math.atan2(R_k.y - F_k.y, R_k.x - F_k.x)
      : Math.atan2(F_k.y - R_k.y, F_k.x - R_k.x);
    
    // Steering angle delta = path heading (direction front wheel wants to go) - body heading
    const pathHeading = F_k.heading;
    const steering_k = normalizeAngle(pathHeading - heading_k);
    const corners_k = calculateCorners(R_k, heading_k, config);

    let trailerState_k = {};
    if (config.enableTrailer) {
      const R_trailer_prev = states[k - 1].trailerRearAxle ?? R_prev;
      const dx_t = R_k.x - R_trailer_prev.x;
      const dy_t = R_k.y - R_trailer_prev.y;
      const d_t = Math.hypot(dx_t, dy_t);

      let R_trailer_k = { ...R_trailer_prev };
      if (d_t > 0.001) {
        R_trailer_k = {
          x: R_k.x - Lt_px * (dx_t / d_t),
          y: R_k.y - Lt_px * (dy_t / d_t),
        };
      }
      const theta_trailer_k = Math.atan2(R_k.y - R_trailer_k.y, R_k.x - R_trailer_k.x);
      const trailerCorners_k = calculateTrailerCorners(R_trailer_k, theta_trailer_k, config);
      trailerState_k = {
        trailerRearAxle: R_trailer_k,
        trailerHeading: theta_trailer_k,
        trailerCorners: trailerCorners_k,
      };
    }

    states.push({
      frontAxle: { x: F_k.x, y: F_k.y },
      rearAxle: R_k,
      heading: heading_k,
      steering: steering_k,
      corners: corners_k,
      ...trailerState_k
    });
  }

  return states;
}

/**
 * Mode 2: Standard Active Pure Pursuit path tracking
 * Rear axle starts at path start and vehicle steers front wheel to actively trace the path.
 */
function simulateActivePurePursuit(
  path: PathPoint[],
  config: VehicleConfig,
  L_px: number
): SimulationState[] {
  const states: SimulationState[] = [];
  const scale = config.scale;
  const l_d_px = config.lookahead * scale; // Lookahead distance in px
  const Lt_px = (config.Lt ?? 7.5) * scale;

  // Simulation step size (px). Space out steps by approx 1.5 px (representing smooth small increments)
  const ds = 1.5; 
  const maxSteps = Math.min(1200, path.length * 3); // Guard limit to prevent memory overflow
  const dir = config.reverse ? -1 : 1;

  // Start with the FRONT axle exactly at the beginning of the path (path[0]), and the rear axle behind/in-front.
  let theta_curr = path[0].heading;
  let R_curr = {
    x: path[0].x - dir * L_px * Math.cos(theta_curr),
    y: path[0].y - dir * L_px * Math.sin(theta_curr),
  };
  let steer_curr = 0;
  let F_curr = { x: path[0].x, y: path[0].y };
  let corners_curr = calculateCorners(R_curr, theta_curr, config);

  let R_trailer_curr = {
    x: R_curr.x - dir * Lt_px * Math.cos(theta_curr),
    y: R_curr.y - dir * Lt_px * Math.sin(theta_curr),
  };
  let theta_trailer_curr = theta_curr;
  let trailerCorners_curr = calculateTrailerCorners(R_trailer_curr, theta_trailer_curr, config);

  let initialTrailerState = {};
  if (config.enableTrailer) {
    initialTrailerState = {
      trailerRearAxle: R_trailer_curr,
      trailerHeading: theta_trailer_curr,
      trailerCorners: trailerCorners_curr,
    };
  }

  states.push({
    frontAxle: F_curr,
    rearAxle: R_curr,
    heading: theta_curr,
    steering: 0,
    corners: corners_curr,
    ...initialTrailerState
  });

  const pathLen = path.length;
  let finished = false;
  let stepsCount = 0;

  // Maximum turning angle we allow the vehicle to lock its wheel
  const maxSteerDeg = config.maxSteerLimit ?? 40;
  const MAX_STEER = (maxSteerDeg * Math.PI) / 180;

  while (!finished && stepsCount < maxSteps) {
    // 1. Find the index on path nearest to currently simulated rear axle
    const nearIdx = findClosestPointIndex(path, R_curr);

    // If nearest index is at the very end and we're close, we can stop
    if (nearIdx >= pathLen - 1 && distance(R_curr, path[pathLen - 1]) < 10) {
      finished = true;
      break;
    }

    // 2. Look for lookahead target point G on path
    let G: Point = path[pathLen - 1]; // Fallback to end point
    
    // Find the first point that is further than lookahead distance
    for (let i = nearIdx; i < pathLen; i++) {
      const distToPt = distance(R_curr, path[i]);
      if (distToPt >= l_d_px) {
        G = path[i];
        break;
      }
    }

    // 3. Compute relative angle alpha to target point G
    const gVecX = G.x - R_curr.x;
    const gVecY = G.y - R_curr.y;
    const beta = Math.atan2(gVecY, gVecX);
    // If reversing, target direction is relative to back axle heading (theta_curr + PI)
    const alpha = normalizeAngle(config.reverse ? (beta - (theta_curr + Math.PI)) : (beta - theta_curr));

    // 4. Calculate Pure Pursuit steering steering angle: delta = atan2(2 * L * sin(alpha), l_d)
    const targetSteeringAngle = Math.atan2(2 * L_px * Math.sin(alpha), l_d_px);
    
    // Steering Angle Rate Limiting / Smooth Turning
    const maxSteeringRate = 0.05; // Maximum angle change in radians per path step
    let angleDiff = targetSteeringAngle - steer_curr;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    if (Math.abs(angleDiff) > maxSteeringRate) {
      steer_curr += Math.sign(angleDiff) * maxSteeringRate;
    } else {
      steer_curr = targetSteeringAngle;
    }
    steer_curr = Math.max(-MAX_STEER, Math.min(MAX_STEER, steer_curr));

    // 5. Update vehicle coordinates
    // dTheta = dir * ds * tan(delta) / L
    // dR_x = dir * ds * cos(Theta)
    // dR_y = dir * ds * sin(Theta)
    const nextTheta = theta_curr + dir * (ds * Math.tan(steer_curr)) / L_px;
    const nextR = {
      x: R_curr.x + dir * ds * Math.cos(nextTheta),
      y: R_curr.y + dir * ds * Math.sin(nextTheta),
    };
    const nextF = {
      x: nextR.x + dir * L_px * Math.cos(nextTheta),
      y: nextR.y + dir * L_px * Math.sin(nextTheta),
    };
    const nextCorners = calculateCorners(nextR, nextTheta, config);

    let nextTrailerState = {};
    if (config.enableTrailer) {
      const dx_t = nextR.x - R_trailer_curr.x;
      const dy_t = nextR.y - R_trailer_curr.y;
      const d_t = Math.hypot(dx_t, dy_t);

      let nextR_trailer = { ...R_trailer_curr };
      if (d_t > 0.001) {
        nextR_trailer = {
          x: nextR.x - dir * Lt_px * (dx_t / d_t),
          y: nextR.y - dir * Lt_px * (dy_t / d_t),
        };
      }
      const nextTheta_trailer = Math.atan2(nextR.y - nextR_trailer.y, nextR.x - nextR_trailer.x);
      const nextTrailerCorners = calculateTrailerCorners(nextR_trailer, nextTheta_trailer, config);

      nextTrailerState = {
        trailerRearAxle: nextR_trailer,
        trailerHeading: nextTheta_trailer,
        trailerCorners: nextTrailerCorners,
      };

      // update values for next loops
      R_trailer_curr = nextR_trailer;
      theta_trailer_curr = nextTheta_trailer;
    }

    states.push({
      frontAxle: nextF,
      rearAxle: nextR,
      heading: nextTheta,
      steering: steer_curr,
      corners: nextCorners,
      ...nextTrailerState
    });

    // Update current states for next loop iteration
    R_curr = nextR;
    theta_curr = nextTheta;
    F_curr = nextF;
    stepsCount++;

    // Extra safeguard: if the vehicle wanders too far from the path, terminate
    if (distance(R_curr, path[nearIdx]) > 300) {
      finished = true;
    }
  }

  return states;
}
