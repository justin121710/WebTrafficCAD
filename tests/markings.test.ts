import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashPolyline, polylineLength, getElementPrimitives, computeQuantities, suggestHeading, MARKING_SPEC, roadTextCells, roadTextOutline } from '../src/markings';
import { exportElementsToDXF, encodeDxfText } from '../src/dxf';
import { buildCrossroadTemplate } from '../src/templates';
import { CadElement } from '../src/types';

const line = (type: string, pts: [number, number][], extra: Record<string, unknown> = {}): CadElement => {
  const P = pts.map(([x, y]) => ({ x, y }));
  return { id: `${type}-${Math.random()}`, type, points: P, cpLeft: P, cpRight: P, ...extra } as any;
};

test('虛線依弧長精確切割為 4 m 實線、6 m 間距', () => {
  const pieces = dashPolyline([{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }], 4, 6);
  const lens = pieces.map(polylineLength);
  assert.equal(pieces.length, 6);
  lens.forEach(l => assert.ok(Math.abs(l - 4) < 1e-9, `dash length ${l}`));
  // 第 4 段跨越轉角（27～31 m）仍為 4 m
  assert.ok(Math.abs(lens[3] - 4) < 1e-9);
});

test('每一種標線都會產生幾何（畫布、PNG、DXF 共用）', () => {
  const els: CadElement[] = [
    line('yellow_double', [[0, 0], [20, 0]]),
    line('white_double', [[0, 0], [20, 0]]),
    line('white_dashed', [[0, 0], [20, 0]]),
    line('yellow_dashed', [[0, 0], [20, 0]]),
    line('white_solid', [[0, 0], [20, 0]]),
    line('crossing_dashed', [[0, 0], [20, 0]]),
    line('stop_line', [[0, 0], [7, 0]]),
    line('yield_line', [[0, 0], [7, 0]], { sgn: 1 }),
    line('reversible_lane', [[0, 0], [20, 0]]),
    line('red_solid', [[0, 0], [20, 0]]),
    line('yellow_solid', [[0, 0], [20, 0]]),
    line('bicycle_lane', [[0, 0], [20, 0]], { width: 1.5 }),
    line('Sidewalk', [[0, 0], [20, 0], [20, 3], [0, 3]]),
    line('BuildingLine', [[0, 0], [20, 0]]),
    { id: 'i', type: 'island', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }], hasHatching: true, laneWidth: 3, designVehicle: 'passenger' } as any,
    { id: 'g', type: 'island', hatchPattern: 'cross', points: [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 }], hasHatching: true, laneWidth: 3, designVehicle: 'passenger' } as any,
    { id: 'c', type: 'crosswalk', pA1: { x: 0, y: 0 }, pA2: { x: 0, y: 7 }, pB1: { x: 4, y: 0 }, pB2: { x: 4, y: 7 } } as any,
    { id: 'a', type: 'road_arrow', p: { x: 0, y: 0 }, arrowType: 'straight_left', length: 5, angle: 0 } as any,
    { id: 'm', type: 'moto_box', p1: { x: 0, y: 0 }, p2: { x: 0, y: -6 }, depth: 3 } as any,
    { id: 't', type: 'road_text', p: { x: 0, y: 0 }, text: '慢', charHeight: 2.5, angle: 0 } as any,
    { id: 'ps', type: 'parking_space', p1: { x: 0, y: 0 }, p2: { x: 5.5, y: 0 }, slotType: 'car', width: 2.5, length: 5.5 } as any,
    line('parking_zone', [[0, 0], [30, 0]], { slotType: 'car', width: 2.5, length: 5.5, angle: 90, gap: 0.2, side: 'right' }),
    { id: 'tx', type: 'text', p: { x: 0, y: 0 }, text: '中山路', fontSize: 1.5 } as any,
    { id: 'me', type: 'measurement', points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] } as any,
  ];
  els.forEach(el => assert.ok(getElementPrimitives(el).length > 0, `${el.type} 沒有幾何`));
});

test('雙黃線兩線中心距與規格表一致', () => {
  const prims = getElementPrimitives(line('yellow_double', [[0, 0], [10, 0]]));
  const ys = prims.map(p => (p as any).pts[0].y).sort((a, b) => a - b);
  assert.ok(Math.abs(ys[1] - ys[0] - 2 * MARKING_SPEC.doubleLineOffset) < 1e-9);
});

test('數量計算：100 m 車道線＝40 m 實線、4 m²', () => {
  const rows = computeQuantities([line('white_dashed', [[0, 0], [100, 0]])]);
  assert.equal(rows.length, 1);
  assert.ok(Math.abs(rows[0].length - 40) < 1e-6, String(rows[0].length));
  assert.ok(Math.abs(rows[0].area - 4) < 1e-6, String(rows[0].area));
});

test('靠右行駛：分向限制線南側的車道往東', () => {
  const els = [line('yellow_double', [[-50, 0], [50, 0]])];
  const south = suggestHeading({ x: 0, y: -1.75 }, els)!;
  const north = suggestHeading({ x: 0, y: 1.75 }, els)!;
  assert.ok(Math.abs(Math.cos(south) - 1) < 1e-9);
  assert.ok(Math.abs(Math.cos(north) + 1) < 1e-9);
});

test('DXF：R12 結構完整、圖層有顏色、中文以 Unicode 跳脫、無 LWPOLYLINE', () => {
  const dxf = exportElementsToDXF([
    line('yellow_double', [[0, 0], [20, 0]]),
    line('red_solid', [[0, -3], [20, -3]]),
    { id: 'tx', type: 'text', p: { x: 0, y: 5 }, text: '中山路', fontSize: 1.5 } as any,
  ]);
  for (const key of ['$ACADVER', 'AC1009', '$INSUNITS', 'TABLES', 'LAYER', 'ENTITIES', 'EOF']) assert.ok(dxf.includes(key), key);
  assert.ok(!dxf.includes('LWPOLYLINE'));
  assert.ok(dxf.includes('MARK-CENTER-NOPASS') && dxf.includes('MARK-NO-STOPPING-RED'));
  assert.ok(dxf.includes(encodeDxfText('中山路')));
  assert.equal(encodeDxfText('A中'), 'A\\U+4E2D');
  // 每一行的群組碼與值成對
  assert.equal(dxf.trim().split(/\r\n/).length % 2, 0);
});

test('十字路口範本：指向線朝向路口、四個機車停等區', () => {
  const els = buildCrossroadTemplate();
  assert.equal(els.filter(e => e.type === 'moto_box').length, 4);
  els.filter(e => e.type === 'road_arrow').forEach((a: any) => {
    const heading = a.angle + Math.PI / 2;
    const toCenter = { x: -a.p.x, y: -a.p.y };
    assert.ok(Math.cos(heading) * toCenter.x + Math.sin(heading) * toCenter.y > 0, '箭頭應朝向路口');
  });
});

test('路面標字：英數字合為一格，第一字最遠、最後一字在插入點', () => {
  // 行車方向朝北（+y），字頭朝北：由上而下讀「速限50」，所以「速」在最北邊
  const el: any = { id: 't', type: 'road_text', p: { x: 0, y: 0 }, text: '速限50', charHeight: 2.5, widthFactor: 0.4, charGap: 0.5, angle: Math.PI / 2 };
  const cells = roadTextCells(el);
  assert.deepEqual(cells.map(c => c.text), ['速', '限', '50']);
  assert.ok(Math.abs(cells[0].p.x) < 1e-9 && Math.abs(cells[0].p.y - 6) < 1e-9);
  assert.ok(Math.abs(cells[2].p.y) < 1e-9);
  assert.ok(cells[0].p.y > cells[1].p.y && cells[1].p.y > cells[2].p.y);
  const prims = getElementPrimitives(el).filter(p => p.kind === 'text') as any[];
  assert.equal(prims.length, 3);
  assert.ok(Math.abs(prims[0].cell.w - 1) < 1e-9 && prims[0].cell.h === 2.5);
  const o = roadTextOutline(el);
  const ys = o.map(q => q.y), xs = o.map(q => q.x);
  assert.ok(Math.abs(Math.min(...ys) + 1.25) < 1e-9 && Math.abs(Math.max(...ys) - 7.25) < 1e-9);
  assert.ok(Math.abs(Math.max(...xs) - 0.5) < 1e-9);
});
