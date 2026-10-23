/**
 * PNG 工程圖匯出：與畫布、DXF 使用同一份幾何原語，確保三者一致。
 * 配色可選白底彩色／白底黑白／深色；可套用標準圖紙（A4–A1 圖框＋右側標題欄），
 * 圖面可依北方角度整體旋轉。
 */
import { CadElement } from './types';
import { getElementPrimitives, primitivesBounds, Primitive } from './markings';
import { renderPrimitives, PALETTES, PaletteName, isLightPalette } from './renderPrimitives';
import { SheetSize, SheetOrientation, SHEET_DPI, Rect, sheetLayout, pickScale, niceLength, rotatePoint, rotatePrims } from './sheet';

export interface SheetInfo {
  drawingNo?: string;
  designer?: string;
  drafter?: string;
  checker?: string;
  date?: string;
}

export interface PngExportOptions {
  palette: PaletteName;
  /** 無圖框時的輸出寬度（px） */
  width?: number;
  includeConstruction?: boolean;
  includeAnnotations?: boolean;
  /** 套用標準圖紙（圖框、標題欄、比例尺、指北針） */
  titleBlock?: boolean;
  sheetSize?: SheetSize;
  orientation?: SheetOrientation;
  /** 比例尺分母；0 或未設定 = 自動選擇 */
  scale?: number;
  title?: string;
  info?: SheetInfo;
  /** 北方方向：自圖面正上方順時針量測的角度（°） */
  northDeg?: number;
  /** 旋轉整張圖面，使北方朝上 */
  rotateToNorth?: boolean;
  bgImage?: any;
  /** 額外輸出的原語（例如軌跡模擬結果） */
  extraPrims?: Primitive[];
  /** 圖例（軌跡顏色與說明） */
  legend?: { color: string; label: string }[];
}

const FONT = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export async function renderElementsToPng(elements: CadElement[], o: PngExportOptions): Promise<string> {
  let prims: Primitive[] = [];
  elements.forEach(el => prims.push(...getElementPrimitives(el, {
    includeConstruction: o.includeConstruction ?? false,
    includeAnnotations: o.includeAnnotations ?? true,
  })));
  if (o.extraPrims) prims.push(...o.extraPrims);

  const bg = o.bgImage && o.bgImage.src && o.bgImage.widthMeters && o.bgImage.heightMeters ? o.bgImage : null;
  const northDeg = ((o.northDeg ?? 0) % 360 + 360) % 360;
  // 北方向量為自 +Y 順時針 θ；逆時針轉 θ 即朝上
  const rot = o.rotateToNorth ? (northDeg * Math.PI) / 180 : 0;
  const arrowDeg = o.rotateToNorth ? 0 : northDeg;

  // 旋轉中心：原始範圍中心
  let b0 = primitivesBounds(prims);
  if (bg) {
    b0 = {
      minX: Math.min(b0.minX, bg.x - bg.widthMeters / 2), maxX: Math.max(b0.maxX, bg.x + bg.widthMeters / 2),
      minY: Math.min(b0.minY, bg.y - bg.heightMeters / 2), maxY: Math.max(b0.maxY, bg.y + bg.heightMeters / 2),
    };
  }
  if (!isFinite(b0.minX)) b0 = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
  const center = { x: (b0.minX + b0.maxX) / 2, y: (b0.minY + b0.maxY) / 2 };
  prims = rotatePrims(prims, center, rot);

  let b = primitivesBounds(prims);
  if (bg) {
    const hw = bg.widthMeters / 2, hh = bg.heightMeters / 2;
    [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].forEach(([dx, dy]) => {
      const p = rotatePoint({ x: bg.x + dx, y: bg.y + dy }, center, rot);
      b = { minX: Math.min(b.minX, p.x), maxX: Math.max(b.maxX, p.x), minY: Math.min(b.minY, p.y), maxY: Math.max(b.maxY, p.y) };
    });
  }
  if (!isFinite(b.minX)) b = { minX: -20, minY: -20, maxX: 20, maxY: 20 };

  const pal = PALETTES[o.palette];
  const light = isLightPalette(o.palette);
  const ink = light ? '#111111' : '#e2e8f0';
  const sub = light ? '#555555' : '#94a3b8';
  const mono = o.palette === 'mono';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  let zoom: number;
  let area: { x: number; y: number; w: number; h: number };
  let pxPerMm = 1;
  let scaleDen = 0;
  let layout: ReturnType<typeof sheetLayout> | null = null;

  if (o.titleBlock) {
    const size = o.sheetSize ?? 'A3';
    layout = sheetLayout(size, o.orientation ?? 'landscape');
    pxPerMm = SHEET_DPI[size] / 25.4;
    canvas.width = Math.round(layout.paper.w * pxPerMm);
    canvas.height = Math.round(layout.paper.h * pxPerMm);
    const d = layout.drawing, inset = 5;
    scaleDen = o.scale && o.scale > 0
      ? o.scale
      : pickScale(b.maxX - b.minX, b.maxY - b.minY, d.w - inset * 2, d.h - inset * 2);
    zoom = (pxPerMm * 1000) / scaleDen;
    area = { x: d.x * pxPerMm, y: d.y * pxPerMm, w: d.w * pxPerMm, h: d.h * pxPerMm };
  } else {
    const padX = Math.max(1, (b.maxX - b.minX) * 0.08);
    const padY = Math.max(1, (b.maxY - b.minY) * 0.08);
    const W = o.width ?? 2480;
    zoom = W / (b.maxX - b.minX + padX * 2);
    const H = Math.max(400, Math.round((b.maxY - b.minY + padY * 2) * zoom));
    canvas.width = W;
    canvas.height = H;
    area = { x: 0, y: 0, w: W, h: H };
  }

  ctx.fillStyle = pal.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 圖面置中於繪圖區
  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  const sx0 = area.x + area.w / 2, sy0 = area.y + area.h / 2;
  const w2s = (x: number, y: number) => ({ x: sx0 + (x - cx) * zoom, y: sy0 - (y - cy) * zoom });
  const pxScale = o.titleBlock ? pxPerMm * 0.25 : area.w / 1200;

  ctx.save();
  ctx.beginPath();
  ctx.rect(area.x, area.y, area.w, area.h);
  ctx.clip();
  if (bg) {
    const img = await loadImage(bg.src);
    if (img) {
      const c = rotatePoint({ x: bg.x, y: bg.y }, center, rot);
      const s = w2s(c.x, c.y);
      ctx.save();
      ctx.globalAlpha = bg.opacity ?? 0.5;
      if (mono) ctx.filter = 'grayscale(1)';
      ctx.translate(s.x, s.y);
      ctx.rotate(-rot);
      ctx.drawImage(img, -bg.widthMeters / 2 * zoom, -bg.heightMeters / 2 * zoom, bg.widthMeters * zoom, bg.heightMeters * zoom);
      ctx.restore();
    }
  }
  renderPrimitives(ctx, prims, { zoom, w2s, palette: o.palette, pxScale });
  ctx.restore();

  if (o.legend && o.legend.length) {
    const k = o.titleBlock ? pxPerMm * 0.3 : area.w / 1200;
    const fs = Math.round(12 * k);
    const pad = Math.round(8 * k);
    ctx.font = `${fs}px ${FONT}`;
    const w = Math.max(...o.legend.map(l => ctx.measureText(l.label).width)) + fs * 2 + pad * 2;
    const h = o.legend.length * (fs + 6 * k) + pad * 2 + fs;
    const x0 = area.x + pad, y0 = area.y + pad;
    ctx.fillStyle = light ? 'rgba(255,255,255,0.9)' : 'rgba(15,17,21,0.85)';
    ctx.strokeStyle = light ? '#888' : '#444';
    ctx.lineWidth = Math.max(1, k * 0.8);
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeRect(x0, y0, w, h);
    ctx.fillStyle = ink;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('車輛軌跡模擬', x0 + pad, y0 + pad + fs / 2);
    o.legend.forEach((l, i) => {
      const y = y0 + pad + fs + (i + 0.5) * (fs + 6 * k) + 4 * k;
      ctx.fillStyle = mono ? ink : l.color;
      ctx.fillRect(x0 + pad, y - fs / 3, fs * 1.2, (fs * 2) / 3);
      ctx.fillStyle = ink;
      ctx.fillText(l.label, x0 + pad + fs * 1.6, y);
    });
  }

  if (layout) drawSheet(ctx, layout, pxPerMm, { ink, sub, zoom, scaleDen, arrowDeg, title: o.title, info: o.info });

  return canvas.toDataURL('image/png');
}

/** 圖框與右側標題欄 */
function drawSheet(
  ctx: CanvasRenderingContext2D,
  L: ReturnType<typeof sheetLayout>,
  mm: number,
  d: { ink: string; sub: string; zoom: number; scaleDen: number; arrowDeg: number; title?: string; info?: SheetInfo },
) {
  const R = (r: Rect) => [r.x * mm, r.y * mm, r.w * mm, r.h * mm] as const;
  const k = L.k;
  const thin = 0.25 * mm, thick = 0.7 * mm;
  ctx.save();
  ctx.strokeStyle = d.ink;
  ctx.fillStyle = d.ink;
  ctx.textBaseline = 'middle';

  // 圖框（粗）、標題欄分隔（細）
  ctx.lineWidth = thick;
  ctx.strokeRect(...R(L.frame));
  const c = L.cells;
  ctx.beginPath();
  ctx.moveTo(c.north.x * mm, L.frame.y * mm);
  ctx.lineTo(c.north.x * mm, (L.frame.y + L.frame.h) * mm);
  ctx.stroke();
  ctx.lineWidth = thin;
  Object.values(c).forEach(r => {
    if (r.y <= L.frame.y + 0.01) return;
    ctx.beginPath();
    ctx.moveTo(r.x * mm, r.y * mm);
    ctx.lineTo((r.x + r.w) * mm, r.y * mm);
    ctx.stroke();
  });

  const font = (sizeMm: number, bold = false) => { ctx.font = `${bold ? 'bold ' : ''}${Math.round(sizeMm * k * mm)}px ${FONT}`; };
  const pad = 1.5 * k;
  const label = (r: Rect, text: string) => {
    font(2.2);
    ctx.fillStyle = d.sub;
    ctx.textAlign = 'left';
    ctx.fillText(text, (r.x + pad) * mm, (r.y + 2.6 * k) * mm);
  };
  /** 欄名＋內容同一列（左欄名、右內容） */
  const labelW = 11 * k;
  const row = (r: Rect, name: string, value: string) => {
    ctx.beginPath();
    ctx.moveTo((r.x + labelW) * mm, r.y * mm);
    ctx.lineTo((r.x + labelW) * mm, (r.y + r.h) * mm);
    ctx.stroke();
    font(2.4);
    ctx.fillStyle = d.sub;
    ctx.textAlign = 'center';
    ctx.fillText(name, (r.x + labelW / 2) * mm, (r.y + r.h / 2) * mm);
    font(2.8);
    ctx.fillStyle = d.ink;
    ctx.textAlign = 'left';
    fitText(ctx, value, (r.x + labelW + pad) * mm, (r.y + r.h / 2) * mm, (r.w - labelW - pad * 2) * mm);
  };

  // 指北針：箭頭與 N 全在格內的圓中
  label(c.north, '指北針');
  {
    const top = c.north.y + 5 * k;
    const cxm = c.north.x + c.north.w / 2, cym = (top + c.north.y + c.north.h) / 2;
    const rad = Math.min(c.north.w, c.north.y + c.north.h - top) / 2 - 1.5 * k;
    const x = cxm * mm, y = cym * mm, r = rad * mm;
    ctx.lineWidth = thin;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((d.arrowDeg * Math.PI) / 180);
    const t = r * 0.58;
    ctx.beginPath();
    ctx.moveTo(0, -t); ctx.lineTo(t * 0.36, t * 0.7); ctx.lineTo(0, t * 0.4); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -t); ctx.lineTo(-t * 0.36, t * 0.7); ctx.lineTo(0, t * 0.4); ctx.closePath();
    ctx.lineJoin = 'miter';
    ctx.stroke();
    ctx.translate(0, -r * 0.8);
    ctx.rotate(-(d.arrowDeg * Math.PI) / 180);
    ctx.font = `bold ${Math.round(r * 0.26)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText('N', 0, 0);
    ctx.restore();
  }

  // 比例尺：四段黑白交替
  label(c.scaleBar, '比例尺');
  {
    const r = c.scaleBar;
    const maxBarMm = r.w - pad * 2 - 6 * k;
    const len = niceLength((maxBarMm / 1000) * d.scaleDen);
    const barMm = (len * 1000) / d.scaleDen;
    const x0 = (r.x + (r.w - barMm) / 2) * mm, y0 = (r.y + r.h * 0.55) * mm, bh = 1.6 * k * mm, seg = (barMm * mm) / 4;
    ctx.lineWidth = thin;
    for (let i = 0; i < 4; i++) {
      if (i % 2 === 0) ctx.fillRect(x0 + seg * i, y0, seg, bh);
      ctx.strokeRect(x0 + seg * i, y0, seg, bh);
    }
    font(2.2);
    ctx.textAlign = 'center';
    ctx.fillStyle = d.ink;
    const ty = y0 + bh + 2.6 * k * mm;
    ctx.fillText('0', x0, ty);
    ctx.fillText(fmtLen(len / 2), x0 + seg * 2, ty);
    ctx.fillText(`${fmtLen(len)} m`, x0 + seg * 4, ty);
  }

  label(c.notes, '附註');

  const info = d.info || {};
  ctx.lineWidth = thin;
  ctx.strokeStyle = d.ink;
  row(c.designer, '設計', info.designer || '');
  row(c.drafter, '繪圖', info.drafter || '');
  row(c.checker, '校核', info.checker || '');
  row(c.date, '日期', info.date || new Date().toISOString().slice(0, 10));
  row(c.scale, '比例', `1:${d.scaleDen}`);
  row(c.unit, '單位', '公尺');

  // 圖名：大字，最多兩行
  label(c.title, '圖名');
  {
    const r = c.title;
    const text = d.title || '交通標線配置圖';
    const maxW = (r.w - pad * 2) * mm;
    let sz = 4.6;
    font(sz, true);
    let lines = wrap(ctx, text, maxW);
    while ((lines.length > 2 || lines.some(l => ctx.measureText(l).width > maxW)) && sz > 2.4) {
      sz -= 0.2;
      font(sz, true);
      lines = wrap(ctx, text, maxW);
    }
    lines = lines.slice(0, 2);
    ctx.fillStyle = d.ink;
    ctx.textAlign = 'center';
    const lh = sz * k * 1.3;
    const midY = r.y + 5 * k + (r.h - 5 * k) / 2;
    lines.forEach((l, i) => ctx.fillText(l, (r.x + r.w / 2) * mm, (midY + (i - (lines.length - 1) / 2) * lh) * mm));
  }

  row(c.drawingNo, '圖號', info.drawingNo || '');

  font(1.9);
  ctx.fillStyle = d.sub;
  ctx.textAlign = 'center';
  ctx.fillText('WebTrafficCAD', (c.credit.x + c.credit.w / 2) * mm, (c.credit.y + c.credit.h / 2) * mm);
  ctx.restore();
}

const fmtLen = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** 單行文字：太長時縮小字寬塞進欄位 */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number) {
  if (!text) return;
  const w = ctx.measureText(text).width;
  if (w <= maxW) { ctx.fillText(text, x, y); return; }
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(maxW / w, 1);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/** 依字元斷行（中文無空格） */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (cur && ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
