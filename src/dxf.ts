/**
 * DXF 匯出（AutoCAD R12 / AC1009 ASCII）
 *
 * - 含 HEADER（單位＝公尺、範圍）、TABLES（線型、圖層顏色、文字樣式）
 * - 標線以「具線寬的 POLYLINE」輸出，虛線依弧長精確切割
 * - 填滿的三／四邊形（行穿線、讓路線方塊）另輸出 SOLID，CAD 中即為實心
 * - 中文以 \U+XXXX 跳脫，避免字碼頁造成亂碼
 */
import { CadElement, Point2D } from './types';
import { ACI, LAYERS, Primitive, getElementPrimitives, dashPolyline, primitivesBounds, MarkColor } from './markings';

export interface DxfOptions {
  includeConstruction?: boolean;
  includeAnnotations?: boolean;
  /** 填滿多邊形另外輸出 SOLID 實體 */
  solidFill?: boolean;
  /** 文字樣式使用的字型檔（AutoCAD 可用 TrueType） */
  fontFile?: string;
  /** 額外輸出的原語（例如軌跡模擬結果） */
  extraPrims?: Primitive[];
}

/** 將非 ASCII 字元轉為 DXF Unicode 跳脫序列 */
export function encodeDxfText(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 128) out += ch;
    else if (cp <= 0xffff) out += '\\U+' + cp.toString(16).toUpperCase().padStart(4, '0');
    else out += '?';
  }
  return out;
}

const f = (n: number) => (Math.abs(n) < 1e-9 ? 0 : n).toFixed(4);

class DxfWriter {
  private lines: string[] = [];
  pair(code: number, value: string | number) {
    this.lines.push(String(code).padStart(3, ' '), String(value));
  }
  toString() {
    return this.lines.join('\r\n') + '\r\n';
  }
}

export function exportElementsToDXF(elements: CadElement[], options: DxfOptions = {}): string {
  const opts = { includeConstruction: true, includeAnnotations: true, solidFill: true, fontFile: 'kaiu.ttf', ...options };
  const prims: Primitive[] = [];
  elements.forEach(el => prims.push(...getElementPrimitives(el, opts)));
  if (opts.extraPrims) prims.push(...opts.extraPrims);

  const usedLayers = new Map<string, number>();
  prims.forEach(p => {
    const def = Object.values(LAYERS).find(l => l.name === p.layer);
    const color = p.aci ?? (def ? ACI[def.color] : ACI[(p as any).color as MarkColor] ?? 7);
    if (!usedLayers.has(p.layer)) usedLayers.set(p.layer, color);
  });

  const b = primitivesBounds(prims);
  const ext = isFinite(b.minX) ? b : { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  const w = new DxfWriter();
  // ---------------- HEADER
  w.pair(0, 'SECTION'); w.pair(2, 'HEADER');
  w.pair(9, '$ACADVER'); w.pair(1, 'AC1009');
  w.pair(9, '$INSBASE'); w.pair(10, '0.0'); w.pair(20, '0.0'); w.pair(30, '0.0');
  w.pair(9, '$EXTMIN'); w.pair(10, f(ext.minX)); w.pair(20, f(ext.minY)); w.pair(30, '0.0');
  w.pair(9, '$EXTMAX'); w.pair(10, f(ext.maxX)); w.pair(20, f(ext.maxY)); w.pair(30, '0.0');
  w.pair(9, '$LIMMIN'); w.pair(10, f(ext.minX)); w.pair(20, f(ext.minY));
  w.pair(9, '$LIMMAX'); w.pair(10, f(ext.maxX)); w.pair(20, f(ext.maxY));
  w.pair(9, '$LUNITS'); w.pair(70, 2);
  w.pair(9, '$LUPREC'); w.pair(70, 3);
  w.pair(9, '$INSUNITS'); w.pair(70, 6); // 6 = 公尺
  w.pair(9, '$MEASUREMENT'); w.pair(70, 1); // 公制
  w.pair(9, '$TEXTSTYLE'); w.pair(7, 'ZH');
  w.pair(9, '$DWGCODEPAGE'); w.pair(3, 'ANSI_1252');
  w.pair(0, 'ENDSEC');

  // ---------------- TABLES
  w.pair(0, 'SECTION'); w.pair(2, 'TABLES');
  // 線型
  w.pair(0, 'TABLE'); w.pair(2, 'LTYPE'); w.pair(70, 1);
  w.pair(0, 'LTYPE'); w.pair(2, 'CONTINUOUS'); w.pair(70, 0); w.pair(3, 'Solid line'); w.pair(72, 65); w.pair(73, 0); w.pair(40, '0.0');
  w.pair(0, 'ENDTAB');
  // 圖層
  w.pair(0, 'TABLE'); w.pair(2, 'LAYER'); w.pair(70, usedLayers.size + 1);
  w.pair(0, 'LAYER'); w.pair(2, '0'); w.pair(70, 0); w.pair(62, 7); w.pair(6, 'CONTINUOUS');
  usedLayers.forEach((color, name) => {
    w.pair(0, 'LAYER'); w.pair(2, name); w.pair(70, 0); w.pair(62, color); w.pair(6, 'CONTINUOUS');
  });
  w.pair(0, 'ENDTAB');
  // 文字樣式
  w.pair(0, 'TABLE'); w.pair(2, 'STYLE'); w.pair(70, 2);
  w.pair(0, 'STYLE'); w.pair(2, 'STANDARD'); w.pair(70, 0); w.pair(40, '0.0'); w.pair(41, '1.0'); w.pair(50, '0.0'); w.pair(71, 0); w.pair(42, '2.5'); w.pair(3, 'txt'); w.pair(4, '');
  w.pair(0, 'STYLE'); w.pair(2, 'ZH'); w.pair(70, 0); w.pair(40, '0.0'); w.pair(41, '1.0'); w.pair(50, '0.0'); w.pair(71, 0); w.pair(42, '2.5'); w.pair(3, opts.fontFile); w.pair(4, '');
  w.pair(0, 'ENDTAB');
  w.pair(0, 'ENDSEC');

  // ---------------- ENTITIES
  w.pair(0, 'SECTION'); w.pair(2, 'ENTITIES');

  const polyline = (layer: string, pts: Point2D[], closed: boolean, width: number) => {
    if (pts.length < 2) return;
    w.pair(0, 'POLYLINE'); w.pair(8, layer); w.pair(66, 1);
    w.pair(10, '0.0'); w.pair(20, '0.0'); w.pair(30, '0.0');
    w.pair(70, closed ? 1 : 0);
    if (width > 0) { w.pair(40, f(width)); w.pair(41, f(width)); }
    pts.forEach(p => {
      w.pair(0, 'VERTEX'); w.pair(8, layer);
      w.pair(10, f(p.x)); w.pair(20, f(p.y)); w.pair(30, '0.0');
    });
    w.pair(0, 'SEQEND'); w.pair(8, layer);
  };
  const solid = (layer: string, pts: Point2D[]) => {
    // SOLID 頂點順序為 1-2-4-3（Z 字形）
    const q = pts.length === 3 ? [pts[0], pts[1], pts[2], pts[2]] : [pts[0], pts[1], pts[3], pts[2]];
    w.pair(0, 'SOLID'); w.pair(8, layer);
    q.forEach((p, i) => { w.pair(10 + i, f(p.x)); w.pair(20 + i, f(p.y)); w.pair(30 + i, '0.0'); });
  };

  prims.forEach(pr => {
    switch (pr.kind) {
      case 'line': {
        const pts = pr.closed ? pr.pts : pr.pts;
        if (pr.dash) {
          dashPolyline(pts, pr.dash[0], pr.dash[1]).forEach(seg => polyline(pr.layer, seg, false, pr.width));
        } else {
          polyline(pr.layer, pts, !!pr.closed, pr.width);
        }
        break;
      }
      case 'poly': {
        if (opts.solidFill && pr.fill && !pr.holes && (pr.pts.length === 3 || pr.pts.length === 4) && pr.fill !== 'gray' && pr.fill !== 'pink') {
          solid(pr.layer, pr.pts);
        }
        polyline(pr.layer, pr.pts, true, pr.stroke ? (pr.strokeWidth ?? 0) : 0);
        (pr.holes || []).forEach(h => polyline(pr.layer, h, true, 0));
        break;
      }
      case 'text': {
        const deg = ((pr.angle || 0) * 180) / Math.PI;
        w.pair(0, 'TEXT'); w.pair(8, pr.layer);
        w.pair(10, f(pr.p.x)); w.pair(20, f(pr.p.y)); w.pair(30, '0.0');
        w.pair(40, f(pr.size));
        w.pair(1, encodeDxfText(pr.text));
        if (Math.abs(deg) > 1e-6) w.pair(50, f(deg));
        if (pr.widthFactor && pr.widthFactor !== 1) w.pair(41, f(pr.widthFactor));
        w.pair(7, 'ZH');
        w.pair(72, 1); // 水平置中
        w.pair(11, f(pr.p.x)); w.pair(21, f(pr.p.y)); w.pair(31, '0.0');
        w.pair(73, 2); // 垂直置中
        break;
      }
      case 'circle':
        w.pair(0, 'CIRCLE'); w.pair(8, pr.layer);
        w.pair(10, f(pr.c.x)); w.pair(20, f(pr.c.y)); w.pair(30, '0.0'); w.pair(40, f(pr.r));
        break;
      case 'arc':
        w.pair(0, 'ARC'); w.pair(8, pr.layer);
        w.pair(10, f(pr.c.x)); w.pair(20, f(pr.c.y)); w.pair(30, '0.0'); w.pair(40, f(pr.r));
        w.pair(50, f((pr.a0 * 180) / Math.PI)); w.pair(51, f((pr.a1 * 180) / Math.PI));
        break;
    }
  });

  w.pair(0, 'ENDSEC');
  w.pair(0, 'EOF');
  return w.toString();
}
