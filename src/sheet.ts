/**
 * 出圖圖紙：紙張尺寸、圖框、標題欄配置、比例選擇與整體旋轉。
 * 純計算（不碰 DOM），PNG 匯出與測試共用。
 */
import { Point2D } from './types';
import { Primitive } from './markings';

export type SheetSize = 'A4' | 'A3' | 'A2' | 'A1';
export type SheetOrientation = 'landscape' | 'portrait';

/** 橫式紙張尺寸（mm） */
export const SHEET_MM: Record<SheetSize, [number, number]> = {
  A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594],
};
/** 輸出解析度：小圖 200 dpi，大圖 150 dpi（控制檔案大小） */
export const SHEET_DPI: Record<SheetSize, number> = { A4: 200, A3: 200, A2: 150, A1: 150 };
/** 標題欄尺寸倍率（大圖紙的欄位放大） */
const BLOCK_K: Record<SheetSize, number> = { A4: 1, A3: 1, A2: 1.25, A1: 1.5 };

/** 常用比例尺分母 */
export const STANDARD_SCALES = [50, 100, 150, 200, 250, 300, 400, 500, 600, 750, 1000, 1250, 1500, 2000, 2500, 3000, 5000, 10000];

export interface Rect { x: number; y: number; w: number; h: number }

export interface SheetLayout {
  /** 紙張（mm） */
  paper: { w: number; h: number };
  /** 圖框（mm）：左側 20 mm 裝訂邊，其餘 10 mm */
  frame: Rect;
  /** 繪圖區（mm） */
  drawing: Rect;
  /** 右側標題欄各格（mm） */
  cells: {
    north: Rect; scaleBar: Rect; notes: Rect;
    designer: Rect; drafter: Rect; checker: Rect; date: Rect;
    scale: Rect; unit: Rect; title: Rect; drawingNo: Rect; credit: Rect;
  };
  /** 標題欄字級基準（mm） */
  k: number;
}

export function sheetLayout(size: SheetSize, orientation: SheetOrientation): SheetLayout {
  const [a, b] = SHEET_MM[size];
  const paper = orientation === 'landscape' ? { w: a, h: b } : { w: b, h: a };
  const frame = { x: 20, y: 10, w: paper.w - 30, h: paper.h - 20 };
  const k = BLOCK_K[size];
  const colW = 42 * k;
  const colX = frame.x + frame.w - colW;
  const drawing = { x: frame.x, y: frame.y, w: frame.w - colW, h: frame.h };

  // 由上而下：指北針、比例尺、附註（彈性）、人員與日期、比例、單位、圖名、圖號、軟體
  const fixedTop: [string, number][] = [['north', 34], ['scaleBar', 18]];
  const fixedBottom: [string, number][] = [
    ['designer', 8], ['drafter', 8], ['checker', 8], ['date', 8],
    ['scale', 8], ['unit', 8], ['title', 22], ['drawingNo', 10], ['credit', 6],
  ];
  const cells: any = {};
  let y = frame.y;
  fixedTop.forEach(([key, h]) => { cells[key] = { x: colX, y, w: colW, h: h * k }; y += h * k; });
  const bottomH = fixedBottom.reduce((s, [, h]) => s + h * k, 0);
  cells.notes = { x: colX, y, w: colW, h: Math.max(0, frame.y + frame.h - bottomH - y) };
  y = frame.y + frame.h - bottomH;
  fixedBottom.forEach(([key, h]) => { cells[key] = { x: colX, y, w: colW, h: h * k }; y += h * k; });
  return { paper, frame, drawing, cells, k };
}

/** 選擇能把範圍（m）放進繪圖區（mm）的最小常用比例 */
export function pickScale(extentW: number, extentH: number, areaWmm: number, areaHmm: number): number {
  for (const s of STANDARD_SCALES) {
    if ((extentW * 1000) / s <= areaWmm && (extentH * 1000) / s <= areaHmm) return s;
  }
  return STANDARD_SCALES[STANDARD_SCALES.length - 1];
}

/** 比例尺長度：不超過 maxM 的 1／2／5 × 10ⁿ 公尺 */
export function niceLength(maxM: number): number {
  if (!(maxM > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(maxM)));
  const n = maxM / pow;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
}

/** 繞 c 逆時針旋轉 a（rad） */
export function rotatePoint(p: Point2D, c: Point2D, a: number): Point2D {
  const cos = Math.cos(a), sin = Math.sin(a);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** 整體旋轉原語（逆時針 a rad）：點位、文字方向、圓弧起訖角一起轉 */
export function rotatePrims(prims: Primitive[], c: Point2D, a: number): Primitive[] {
  if (!a) return prims;
  const r = (p: Point2D) => rotatePoint(p, c, a);
  return prims.map(pr => {
    switch (pr.kind) {
      case 'line': return { ...pr, pts: pr.pts.map(r) };
      case 'poly': return { ...pr, pts: pr.pts.map(r), holes: pr.holes?.map(h => h.map(r)) };
      case 'text': return { ...pr, p: r(pr.p), angle: (pr.angle || 0) + a };
      case 'circle': return { ...pr, c: r(pr.c) };
      case 'arc': return { ...pr, c: r(pr.c), a0: pr.a0 + a, a1: pr.a1 + a };
    }
  });
}
