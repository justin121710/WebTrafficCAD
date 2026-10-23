import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetLayout, pickScale, niceLength, rotatePrims, SHEET_MM } from '../src/sheet';
import { Primitive } from '../src/markings';

test('圖框：左 20 mm 裝訂邊、其餘 10 mm；標題欄各格不重疊且在圖框內', () => {
  for (const size of Object.keys(SHEET_MM) as (keyof typeof SHEET_MM)[]) {
    for (const ori of ['landscape', 'portrait'] as const) {
      const L = sheetLayout(size, ori);
      assert.equal(L.frame.x, 20);
      assert.equal(L.paper.w - (L.frame.x + L.frame.w), 10);
      assert.equal(L.paper.h - (L.frame.y + L.frame.h), 10);
      const cells = Object.values(L.cells).sort((a, b) => a.y - b.y);
      cells.forEach((c, i) => {
        assert.ok(c.h >= 0);
        assert.ok(c.y >= L.frame.y - 1e-9 && c.y + c.h <= L.frame.y + L.frame.h + 1e-9, `${size} ${ori}`);
        if (i > 0) assert.ok(Math.abs(cells[i - 1].y + cells[i - 1].h - c.y) < 1e-9);
      });
      assert.ok(L.cells.notes.h > 0, `${size} ${ori} 附註欄應有空間`);
      assert.ok(L.drawing.x + L.drawing.w <= L.cells.north.x + 1e-9);
    }
  }
});

test('比例：選放得下的最大比例（最小分母）', () => {
  // 60 m × 40 m 放進 300 × 180 mm：1:200 需 300 × 200 → 不行；1:250 → 240 × 160
  assert.equal(pickScale(60, 40, 300, 180), 250);
  assert.equal(pickScale(10, 10, 300, 180), 100);
  assert.equal(niceLength(37), 20);
  assert.equal(niceLength(5), 5);
  assert.equal(niceLength(0.9), 0.5);
});

test('整體旋轉：點位、文字角度、圓弧角一起轉', () => {
  const prims: Primitive[] = [
    { kind: 'line', pts: [{ x: 1, y: 0 }, { x: 2, y: 0 }], width: 0.1, color: 'white', layer: 'L' },
    { kind: 'text', p: { x: 1, y: 0 }, text: 'A', size: 1, color: 'text', layer: 'L', angle: 0 },
    { kind: 'arc', c: { x: 0, y: 0 }, r: 1, a0: 0, a1: 1, color: 'white', layer: 'L' },
  ];
  const r = rotatePrims(prims, { x: 0, y: 0 }, Math.PI / 2);
  const line = r[0] as any, text = r[1] as any, arc = r[2] as any;
  assert.ok(Math.abs(line.pts[1].x) < 1e-9 && Math.abs(line.pts[1].y - 2) < 1e-9);
  assert.ok(Math.abs(text.angle - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(arc.a1 - (1 + Math.PI / 2)) < 1e-9);
  assert.equal(rotatePrims(prims, { x: 0, y: 0 }, 0), prims);
});
