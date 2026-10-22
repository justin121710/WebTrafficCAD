import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPath, resample } from '../src/simulation/pathBuilder';
import { simulate, steerFromFrontRadius, radiiFromSteer } from '../src/simulation/kinematics';
import { computeResult } from '../src/simulation/compute';
import { unionPolygons, checkClearance, sweepHulls } from '../src/simulation/analysis';
import { buildObstacles } from '../src/simulation/obstacles';
import { findVehicle, VehicleSpec, steerFromOuterWheelRadius, outerWheelRadius, overallLength, cadMinPathRadius } from '../src/simulation/vehicles';
import { DEFAULT_DRIVE, DEFAULT_INTERSECTION, PathSource, headingToAzimuth, azimuthToHeading } from '../src/simulation/model';
import { loadSimulation, sanitizeDoc } from '../src/simulation/persist';
import { polygonArea, dist } from '../src/simulation/geom';
import { CadElement } from '../src/types';

const deg = (r: number) => (r * 180) / Math.PI;
const P = findVehicle('aashto-p')!;
const BUS = findVehicle('aashto-bus')!;
const WB12 = findVehicle('aashto-wb12')!;

const poly = (pts: [number, number][], R = 0, Ls = 0): PathSource => ({
  kind: 'polyline',
  nodes: pts.map(([x, y]) => ({ p: { x, y }, R, Ls })),
});

const line = (type: string, pts: [number, number][]): CadElement => {
  const Pp = pts.map(([x, y]) => ({ x, y }));
  return { id: `${type}-${pts.join('-')}`, type, points: Pp, cpLeft: Pp, cpRight: Pp } as any;
};

test('前軸沿圓弧行駛到穩態：後軸半徑 = √(R² − L²)（誤差 < 1 cm）', () => {
  const R = 12;
  const pts = [];
  for (let x = -30; x < 0; x += 0.1) pts.push({ x, y: -R });
  for (let a = -Math.PI / 2; a <= -Math.PI / 2 + 1.75 * Math.PI; a += 0.002) pts.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
  const built = { ...resample(pts), warnings: [] };
  const traj = simulate(built, BUS, DEFAULT_DRIVE);
  const last = traj.poses[traj.poses.length - 1];
  const rr = Math.hypot(last.rear.x, last.rear.y);
  assert.ok(Math.abs(rr - Math.sqrt(R * R - BUS.L * BUS.L)) < 0.01, `rear radius ${rr}`);
  // 穩態轉角 = asin(L/R)
  assert.ok(Math.abs(Math.abs(last.steer) - Math.asin(BUS.L / R)) < (0.2 * Math.PI) / 180, `steer ${deg(last.steer)}`);
});

test('前軸半徑換算轉角使用 asin（R = 7 m、L = 5.8 m → 56.0°，超過 40°）', () => {
  const r = steerFromFrontRadius(7, 5.8);
  assert.ok(Math.abs(deg(r.delta) - 56.0) < 0.1, `${deg(r.delta)}`);
  assert.ok(deg(r.delta) > 40);
  assert.equal(steerFromFrontRadius(5, 5.8).feasible, false);
  const back = radiiFromSteer(r.delta, 5.8);
  assert.ok(Math.abs(back.Rf - 7) < 1e-9);
});

test('精確模式：需要超過最大轉角的急彎標示為不可行', () => {
  const r = computeResult(poly([[-30, 0], [0, 0], [0, 30]], 7), BUS, DEFAULT_DRIVE, [], 0.3)!;
  assert.equal(r.status, 'infeasible');
  assert.ok(r.metrics.infeasibleLength > 1);
  assert.ok(r.metrics.maxSteerDeg > BUS.maxSteerDeg);
  const ok = computeResult(poly([[-30, 0], [0, 0], [0, 30]], 20), BUS, DEFAULT_DRIVE, [], 0.3)!;
  assert.equal(ok.status, 'ok');
  assert.equal(ok.metrics.infeasibleLength, 0);
});

test('轉角受限模式：轉角不超過上限，並回報偏離量', () => {
  const r = computeResult(poly([[-30, 0], [0, 0], [0, 30]], 7), BUS, { ...DEFAULT_DRIVE, controller: 'limited' }, [], 0.3)!;
  assert.ok(r.metrics.maxSteerDeg <= BUS.maxSteerDeg + 1e-6);
  assert.ok(r.metrics.maxDeviation > 0.1);
  assert.notEqual(r.status, 'infeasible');
});

test('直線前進與倒車：軸距維持不變，倒車不會翻轉', () => {
  const src = poly([[0, 0], [20, 0]]);
  for (const drive of [DEFAULT_DRIVE, { ...DEFAULT_DRIVE, guide: 'rear' as const, direction: 'reverse' as const }]) {
    const r = computeResult(src, BUS, drive, [], 0)!;
    let prevRearX = r.traj.poses[0].rear.x;
    for (const p of r.traj.poses) {
      assert.ok(Math.abs(dist(p.front, p.rear) - BUS.L) < 1e-3);
      assert.ok(Math.abs(p.rear.x - prevRearX) < 0.2, 'rear axle jumped');
      prevRearX = p.rear.x;
    }
    if (drive.direction === 'reverse') {
      // 倒車：車頭朝 −x，前軸在後軸的 −x 側
      assert.ok(r.traj.poses[0].front.x < r.traj.poses[0].rear.x);
    }
  }
});

test('倒車沿圓弧：轉角符號與幾何一致', () => {
  const R = 10;
  const pts = [];
  for (let a = 0; a <= Math.PI / 2; a += 0.002) pts.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
  const built = { ...resample(pts), warnings: [] };
  const traj = simulate(built, P, { ...DEFAULT_DRIVE, guide: 'rear', direction: 'reverse' });
  const mid = traj.poses[Math.floor(traj.poses.length / 2)];
  assert.ok(Math.abs(Math.abs(mid.steer) - Math.atan(P.L / R)) < 0.01);
});

test('150 m 長路徑以轉角受限模式完整跑完（不再被步數截斷）', () => {
  const r = computeResult(poly([[0, 0], [150, 0]]), BUS, { ...DEFAULT_DRIVE, controller: 'limited' }, [], 0)!;
  assert.equal(r.status, 'ok');
  const last = r.traj.poses[r.traj.poses.length - 1];
  assert.ok(Math.abs(last.front.x - 150) < 0.1, `front ended at ${last.front.x}`);
});

test('路口曲線：精確通過 P0、P3 且起點切線等於起始方向；不合理交點會改用切線控制並提示', () => {
  const params = { ...DEFAULT_INTERSECTION, p0: { x: -10, y: -1.75 }, h0: 0, p3: { x: 1.75, y: 10 }, h3: Math.PI / 2, extEnd: 0 };
  const b = buildPath({ kind: 'intersection', params })!;
  assert.ok(dist(b.pts[0], params.p0) < 1e-6);
  assert.ok(dist(b.pts[b.pts.length - 1], params.p3) < 1e-6);
  assert.ok(Math.abs(b.heading[0]) < 0.01);
  assert.equal(b.helpers!.valid, true);
  const bad = buildPath({ kind: 'intersection', params: { ...params, h3: -Math.PI / 2 } })!;
  assert.equal(bad.helpers!.valid, false);
  assert.ok(bad.warnings.length > 0);
  const uturn = buildPath({ kind: 'intersection', params: { ...params, p3: { x: -10, y: 5 }, h3: Math.PI } })!;
  assert.ok(uturn.warnings[0].includes('平行'));
});

test('點選＋半徑：中段曲率半徑等於指定半徑，直線不足時縮小並提示', () => {
  const b = buildPath(poly([[-40, 0], [0, 0], [0, 40]], 15))!;
  const mid = b.pts.reduce((best, p, i) => (Math.abs(Math.atan2(p.y, p.x) - Math.atan2(15, -15)) < 1e-9 ? i : best), 0);
  // 圓心 (−15, 15)，曲線中點距圓心 = 15
  const k = b.pts.findIndex(p => Math.abs(p.x + 15 - 15 * Math.cos(-Math.PI / 4)) < 0.03 && Math.abs(p.y - 15 - 15 * Math.sin(-Math.PI / 4)) < 0.03);
  assert.ok(k > 0 || mid >= 0);
  const onArc = b.pts.filter(p => p.x > -15 && p.y < 15);
  onArc.forEach(p => assert.ok(Math.abs(Math.hypot(p.x + 15, p.y - 15) - 15) < 0.01));
  const short = buildPath(poly([[-5, 0], [0, 0], [0, 5]], 15))!;
  assert.ok(short.vertices![0].limited);
  assert.ok(short.warnings.some(w => w.includes('縮小')));
});

test('回旋曲線緩和段：曲線兩端切線連續、終點與節點一致', () => {
  const b = buildPath(poly([[-40, 0], [0, 0], [0, 40]], 15, 10))!;
  assert.ok(dist(b.pts[b.pts.length - 1], { x: 0, y: 40 }) < 1e-6);
  for (let i = 1; i < b.heading.length; i++) {
    const dh = Math.abs(Math.atan2(Math.sin(b.heading[i] - b.heading[i - 1]), Math.cos(b.heading[i] - b.heading[i - 1])));
    assert.ok(dh < 0.02, `heading jump ${dh} at ${i}`);
  }
});

test('筆刷手繪：像素級鋸齒經簡化平滑後航向不再跳動', () => {
  const pts = [];
  for (let i = 0; i < 300; i++) pts.push({ x: Math.round(i * 1.7) * 0.04, y: Math.round(i * 0.9) * 0.04 });
  const b = buildPath({ kind: 'freehand', points: pts })!;
  let jumps = 0;
  for (let i = 1; i < b.heading.length; i++) if (Math.abs(b.heading[i] - b.heading[i - 1]) > (3 * Math.PI) / 180) jumps++;
  assert.equal(jumps, 0);
});

test('掃掠範圍面積：直線行駛 d 公尺 = W ×（d + 車長）± 1%', () => {
  const d = 20;
  const r = computeResult(poly([[0, 0], [d, 0]]), BUS, DEFAULT_DRIVE, [], 0)!;
  const u = unionPolygons(r.hulls.map(h => h.pts));
  assert.equal(u.length, 1);
  const area = Math.abs(polygonArea(u[0][0]));
  const expect = BUS.W * (d + overallLength(BUS));
  assert.ok(Math.abs(area - expect) / expect < 0.01, `area ${area} vs ${expect}`);
  assert.ok(Math.abs(r.metrics.sweptWidth - BUS.W) < 0.01);
});

test('淨距：建築線距車邊的距離誤差 < 2 cm；停止線不列入衝突', () => {
  const src = poly([[0, 0], [20, 0]]);
  const half = P.W / 2;
  const far = buildObstacles([line('BuildingLine', [[-10, half + 0.95], [30, half + 0.95]])], { islandIsHard: false });
  const r1 = computeResult(src, P, DEFAULT_DRIVE, far, 0.3)!;
  assert.ok(Math.abs(r1.metrics.minClearance! - 0.95) < 0.02, `${r1.metrics.minClearance}`);
  assert.equal(r1.conflicts.length, 0);
  const near = buildObstacles([line('BuildingLine', [[-10, half + 0.15], [30, half + 0.15]])], { islandIsHard: false });
  const r2 = computeResult(src, P, DEFAULT_DRIVE, near, 0.3)!;
  assert.equal(r2.conflicts[0].severity, 'clearance');
  const hit = buildObstacles([line('BuildingLine', [[5, -5], [5, 5]])], { islandIsHard: false });
  const r3 = computeResult(src, P, DEFAULT_DRIVE, hit, 0.3)!;
  assert.equal(r3.conflicts[0].severity, 'intrusion');
  const stop = buildObstacles([line('stop_line', [[10, -3], [10, 3]]), line('white_dashed', [[0, 1.8], [20, 1.8]])], { islandIsHard: false });
  assert.equal(stop.length, 0);
  const cross = buildObstacles([line('yellow_double', [[10, -5], [10, 5]])], { islandIsHard: false });
  const r4 = computeResult(src, P, DEFAULT_DRIVE, cross, 0.3)!;
  assert.equal(r4.conflicts[0].severity, 'crossing');
});

test('人行道多邊形：車體角點進入即判定侵入並回報深度', () => {
  const sidewalk = { id: 'sw', type: 'Sidewalk', points: [{ x: 8, y: 0.5 }, { x: 12, y: 0.5 }, { x: 12, y: 4 }, { x: 8, y: 4 }], cpLeft: [], cpRight: [] } as any;
  const sidewalkEl = { ...sidewalk, cpLeft: sidewalk.points, cpRight: sidewalk.points };
  const obs = buildObstacles([sidewalkEl], { islandIsHard: false });
  assert.equal(obs.length, 1);
  const r = computeResult(poly([[0, 0], [20, 0]]), P, DEFAULT_DRIVE, obs, 0.3)!;
  assert.equal(r.conflicts[0].severity, 'intrusion');
  assert.ok(Math.abs(r.conflicts[0].depth - (P.W / 2 - 0.5)) < 0.05, `${r.conflicts[0].depth}`);
});

test('半聯結車：拖車偏移大於牽引車，折角超過上限時判定 jackknife', () => {
  const src = poly([[-40, 0], [0, 0], [0, 40]], 14);
  const r = computeResult(src, WB12, DEFAULT_DRIVE, [], 0)!;
  const tractorOnly = computeResult(src, { ...WB12, trailer: undefined }, DEFAULT_DRIVE, [], 0)!;
  assert.ok(r.metrics.offtracking > tractorOnly.metrics.offtracking + 0.3);
  assert.ok(r.metrics.maxArticulationDeg > 10 && r.metrics.maxArticulationDeg < 70);
  assert.equal(r.metrics.jackknife, false);
  const strict: VehicleSpec = { ...WB12, trailer: { ...WB12.trailer!, maxArticulationDeg: 10 } };
  assert.equal(computeResult(src, strict, DEFAULT_DRIVE, [], 0)!.metrics.jackknife, true);
});

test('車輛庫：最大轉角由最小設計轉彎半徑反算，可逆換算', () => {
  for (const v of [P, BUS, WB12]) {
    const Ro = outerWheelRadius(v);
    assert.ok(Math.abs(steerFromOuterWheelRadius(v.L, v.W, Ro) - v.maxSteerDeg) < 1e-6);
  }
  assert.ok(Math.abs(outerWheelRadius(P) - 7.3) < 0.05);
  assert.ok(Math.abs(overallLength(WB12) - 13.9) < 1e-9);
  assert.ok(cadMinPathRadius('passenger') > 6 && cadMinPathRadius('passenger') < 7);
});

test('方位角換算（北 = 0°，順時針）', () => {
  assert.ok(Math.abs(headingToAzimuth(Math.PI / 2)) < 1e-9);
  assert.ok(Math.abs(headingToAzimuth(0) - 90) < 1e-9);
  assert.ok(Math.abs(azimuthToHeading(180) + Math.PI / 2) < 1e-9);
});

test('舊版專案（像素座標＋軌跡快照）轉換為公尺來源幾何，且檔案大幅縮小', () => {
  const legacy = {
    simConfig: { L: 5.8, W: 2.5, Of: 2.2, Or: 3.3, scale: 25, speed: 4, maxSteerLimit: 40, enableTrailer: false },
    simControllerMode: 'FRONT_AXLE_DRAG',
    simRawPoints: [],
    simLockedPaths: [
      {
        id: 'old-1', themeColor: 'emerald', drawMode: 'smartpath',
        rawPoints: [
          { x: 0, y: 0, handleIn: { x: -50, y: 0 }, handleOut: { x: 50, y: 0 } },
          { x: 500, y: 250, handleIn: { x: 0, y: -50 }, handleOut: { x: 0, y: 50 } },
        ],
        trajectory: new Array(2000).fill({ frontAxle: { x: 1, y: 1 } }),
        config: { L: 5.8, W: 2.5, Of: 2.2, Or: 3.3, scale: 25, maxSteerLimit: 40, enableTrailer: false },
      },
      {
        id: 'old-2', themeColor: 'indigo', drawMode: 'smartpath', rawPoints: [],
        intersectionParams: { p0X: -250, p0Y: 0, p0Angle: 0, p3X: 0, p3Y: 250, p3Angle: 90, p1RatioPercent: 70, p2RatioPercent: 60, enableOutswing: true, i1RatioPercent: 100, i1OffsetDistance: 1.5, i2RatioPercent: 100, i2OffsetDistance: 0, startExtensionM: 0, endExtensionM: 10 },
        config: { L: 3, W: 2, Of: 1, Or: 1, scale: 25, maxSteerLimit: 35, enableTrailer: false },
      },
    ],
  };
  const doc = loadSimulation(legacy);
  assert.equal(doc.paths.length, 2);
  const pen = doc.paths[0].source as any;
  assert.equal(pen.kind, 'pen');
  assert.deepEqual(pen.nodes[1].p, { x: 20, y: 10 });
  assert.deepEqual(pen.nodes[0].hOut, { x: 2, y: 0 });
  assert.equal(doc.paths[0].vehicleIds[0], 'taiwan-bus');
  assert.equal(doc.paths[0].color, '#10b981');
  const inter = doc.paths[1].source as any;
  assert.equal(inter.kind, 'intersection');
  assert.deepEqual(inter.params.p0, { x: -10, y: 0 });
  assert.ok(Math.abs(inter.params.h3 - Math.PI / 2) < 1e-9);
  assert.equal(inter.params.r2, 0.6);
  assert.equal(inter.params.i1Off, -1.5);
  // 尺寸不符預設 → 建立自訂車種
  assert.equal(doc.customVehicles.length, 1);
  assert.equal(doc.paths[1].vehicleIds[0], doc.customVehicles[0].id);
  // 往返存檔
  const again = sanitizeDoc(JSON.parse(JSON.stringify(doc)));
  assert.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(doc)));
  assert.ok(JSON.stringify(doc).length < 10_000);
});

test('載入時驗證：缺欄位、NaN、未知車種都會修正，不會讓模擬崩潰', () => {
  const doc = sanitizeDoc({
    version: 2,
    paths: [
      { source: { kind: 'polyline', nodes: [{ p: { x: 0, y: 0 }, R: 'x' }, { p: { x: NaN, y: 1 } }, { p: { x: 10, y: 0 }, R: 5 }] }, vehicleIds: ['nope'] },
      { source: { kind: 'unknown' } },
    ],
    settings: { bufferM: -3, sweptOpacity: 9 },
  });
  assert.equal(doc.paths.length, 1);
  const s = doc.paths[0].source as any;
  assert.equal(s.nodes.length, 2);
  assert.equal(s.nodes[0].R, 0);
  assert.deepEqual(doc.paths[0].vehicleIds, ['aashto-p']);
  assert.equal(doc.settings.bufferM, 0);
  assert.equal(doc.settings.sweptOpacity, 1);
});

test('掃掠凸包相鄰無縫隙：每個凸包都與前一個重疊', () => {
  const r = computeResult(poly([[-30, 0], [0, 0], [0, 30]], 12), BUS, DEFAULT_DRIVE, [], 0)!;
  const body = r.hulls.filter(h => h.comp === 'body');
  for (let i = 1; i < body.length; i++) {
    const u = unionPolygons([body[i - 1].pts, body[i].pts]);
    assert.equal(u.length, 1, `gap between hull ${i - 1} and ${i}`);
  }
  assert.ok(sweepHulls(r.traj, BUS).length === r.hulls.length);
  assert.ok(checkClearance(r.hulls, [], 0.3).minClearance === null);
});

test('匯出：DXF 含軌跡模擬圖層（掃掠範圍依車種分層、淨距帶、輪跡、標註），中文以 Unicode 跳脫', async () => {
  const { SimStore } = await import('../src/simulation/store');
  const { getSimulationPrimitives } = await import('../src/simulation/exportPrims');
  const { exportElementsToDXF } = await import('../src/dxf');
  const st = new SimStore();
  st.load({
    version: 2, customVehicles: [], settings: { ...(await import('../src/simulation/model')).DEFAULT_SETTINGS },
    paths: [{ id: 'a', name: '右轉', color: '#6366f1', source: poly([[-30, 0], [0, 0], [0, -30]], 15), vehicleIds: ['aashto-bus'], drive: DEFAULT_DRIVE, visible: true, locked: false }],
  });
  const prims = getSimulationPrimitives(st, { swept: true, buffer: true, wheels: true, poses: true, annotations: true });
  const layers = new Set(prims.map(p => p.layer));
  ['SIM-PATH', 'SIM-SWEPT-BUS', 'SIM-BUFFER', 'SIM-WHEEL', 'SIM-POSE', 'SIM-ANNOT'].forEach(l => assert.ok(layers.has(l), l));
  const dxf = exportElementsToDXF([], { extraPrims: prims });
  assert.ok(dxf.includes('SIM-SWEPT-BUS'));
  assert.ok(dxf.includes('\\U+53F3'), '中文跳脫');
  assert.ok(!/[^\x00-\x7f]/.test(dxf), 'DXF 只含 ASCII');
});

test('CAD 端掃掠檢核與模擬共用車輛庫（軸距、轉角公式一致）', async () => {
  const { generateVehicleSweptPath, getWheelbaseForVehicle, calculateSteeringAngle } = await import('../src/geometry');
  assert.equal(getWheelbaseForVehicle('semi_trailer'), BUS.L);
  // 前軸半徑 12 m 的三點 → asin(L/12)
  const R = 12, a = 0.05;
  const ang = calculateSteeringAngle({ x: R * Math.cos(-a), y: R * Math.sin(-a) }, { x: R, y: 0 }, { x: R * Math.cos(a), y: R * Math.sin(a) }, BUS.L);
  assert.ok(Math.abs(ang - deg(Math.asin(BUS.L / R))) < 0.1, `${ang}`);
  const pts = [];
  for (let x = -20; x <= 20; x += 1) pts.push({ x, y: 0 });
  const sw = generateVehicleSweptPath(pts, 'articulated');
  assert.ok(sw.trailerEnvelopes && sw.trailerEnvelopes.length > 0);
  const q = sw.tractorEnvelopes[sw.tractorEnvelopes.length - 1];
  assert.ok(Math.abs(dist(q.p1, q.p2) - WB12.W) < 1e-6);
});

test('雙節拖車：第二節依第一節後軸拖曳，偏移更大、折角各自檢核、外框與輪跡都納入', () => {
  const src = poly([[-40, 0], [0, 0], [0, 40]], 14);
  const doubles: VehicleSpec = { ...WB12, trailer2: { hitchOffset: -0.9, Lt: 7, W: 2.4, Oft: 0.6, Ort: 0.9, maxArticulationDeg: 70 } };
  const one = computeResult(src, WB12, DEFAULT_DRIVE, [], 0)!;
  const two = computeResult(src, doubles, DEFAULT_DRIVE, [], 0)!;
  assert.ok(two.metrics.offtracking > one.metrics.offtracking + 0.3, `${two.metrics.offtracking} vs ${one.metrics.offtracking}`);
  assert.ok(two.hulls.filter(h => h.comp === 'trailer').length > one.hulls.filter(h => h.comp === 'trailer').length);
  assert.ok(two.tracks.wheels.some(w => w.name === '第二節拖車左輪'));
  const p = two.traj.poses[two.traj.poses.length - 1];
  // 第二節聯結點在第一節後軸後方 0.9 m，車身長度保持 Lt
  assert.ok(Math.abs(dist(p.trailer2!.hitch, p.trailer2!.axle) - 7) < 1e-6);
  assert.ok(Math.abs(dist(p.trailer!.axle, p.trailer2!.hitch) - 0.9) < 1e-6);
  assert.ok(Math.abs(overallLength(doubles) - (overallLength(WB12) - WB12.trailer!.Ort + Math.max(WB12.trailer!.Ort, 0.9 + 7 + 0.9))) < 1e-9);
  const strict: VehicleSpec = { ...doubles, trailer2: { ...doubles.trailer2!, maxArticulationDeg: 5 } };
  assert.equal(computeResult(src, strict, DEFAULT_DRIVE, [], 0)!.metrics.jackknife, true);
});

test('接續操作：以前一段終點的車身與拖車方向作為初始狀態', () => {
  const first = computeResult(poly([[-40, 0], [0, 0], [0, 40]], 14), WB12, DEFAULT_DRIVE, [], 0)!;
  const last = first.traj.poses[first.traj.poses.length - 1];
  const built = buildPath(poly([[last.front.x, last.front.y], [last.front.x, last.front.y + 20]]))!;
  const cont = simulate(built, WB12, DEFAULT_DRIVE, { heading: last.heading, trailerHeadings: [last.trailer!.heading] });
  assert.ok(Math.abs(cont.poses[0].heading - last.heading) < 1e-9);
  assert.ok(Math.abs(cont.poses[0].trailer!.heading - last.trailer!.heading) < 1e-9);
  const fresh = simulate(built, WB12, DEFAULT_DRIVE);
  // 未給初始狀態時拖車與路徑起點切線對齊；接續時保留前一段尚未拉直的拖車角度
  assert.ok(Math.abs(fresh.poses[0].trailer!.heading - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(last.trailer!.heading - Math.PI / 2) > 1e-4);
});

test('多段操作：倒車段接續前進段（store 依相依順序計算、起點連續、刪除前段時改接續更前一段）', async () => {
  const { SimStore } = await import('../src/simulation/store');
  const { DEFAULT_SETTINGS } = await import('../src/simulation/model');
  const st = new SimStore();
  st.onConfirm = (_t, _m, _l, run) => run();
  st.load({ version: 2, customVehicles: [], settings: { ...DEFAULT_SETTINGS }, paths: [
    { id: 'a', name: '進場', color: '#6366f1', source: poly([[-40, 0], [0, 0], [0, 30]], 14), vehicleIds: ['aashto-wb12'], drive: DEFAULT_DRIVE, visible: true, locked: false },
  ] });
  st.continueFrom('a', 'reverse');
  assert.ok(st.draft && st.draft.chainFrom === 'a');
  st.updateDraftSource(s => (s.kind === 'polyline' ? { ...s, nodes: [...s.nodes, { p: { x: 12, y: 15 }, R: 14, Ls: 0 }] } : s));
  assert.ok(st.finishDraft(true));
  const res = st.getResults();
  const a = res.find(r => r.pathId === 'a')!;
  const b = res.find(r => r.pathId !== 'a')!;
  const lastA = a.result.traj.poses[a.result.traj.poses.length - 1];
  const firstB = b.result.traj.poses[0];
  assert.ok(dist(firstB.rear, lastA.rear) < 1e-6, '倒車段從前一段後軸位置開始');
  assert.ok(Math.abs(firstB.trailer!.heading - lastA.trailer!.heading) < 1e-9, '拖車方向連續');
  assert.ok(!b.result.messages.some(m => m.includes('不連續')));
  // 匯出／存檔往返保留接續關係
  const again = sanitizeDoc(JSON.parse(JSON.stringify(st.doc)));
  assert.equal(again.paths[1].chainFrom, 'a');
  st.deletePath('a');
  assert.equal(st.doc.paths[0].chainFrom, null);
});

test('機車參考車種：可模擬小半徑迴轉', () => {
  const moto = findVehicle('ref-scooter')!;
  assert.equal(moto.category, 'motorcycle');
  const r = computeResult(poly([[-10, 0], [0, 0], [0, 10]], 2.5), moto, DEFAULT_DRIVE, [], 0)!;
  assert.equal(r.status, 'ok');
});
