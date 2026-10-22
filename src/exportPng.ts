/**
 * PNG 工程圖匯出：與畫布、DXF 使用同一份幾何原語，確保三者一致。
 * 支援白底列印／深色兩種配色，並可加上圖框（圖名、比例尺、指北針、日期）。
 */
import { CadElement } from './types';
import { getElementPrimitives, primitivesBounds, Primitive } from './markings';
import { renderPrimitives, PALETTES, PaletteName } from './renderPrimitives';

export interface PngExportOptions {
  palette: PaletteName;
  /** 輸出寬度（px） */
  width?: number;
  includeConstruction?: boolean;
  includeAnnotations?: boolean;
  /** 加上圖框與圖名欄 */
  titleBlock?: boolean;
  title?: string;
  bgImage?: any;
}

function niceScaleLength(metersPerPx: number, targetPx: number): number {
  const raw = metersPerPx * targetPx;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const nice = n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10;
  return nice * pow;
}

export async function renderElementsToPng(elements: CadElement[], o: PngExportOptions): Promise<string> {
  const prims: Primitive[] = [];
  elements.forEach(el => prims.push(...getElementPrimitives(el, {
    includeConstruction: o.includeConstruction ?? false,
    includeAnnotations: o.includeAnnotations ?? true,
  })));

  let b = primitivesBounds(prims);
  const bg = o.bgImage;
  if (bg && bg.widthMeters && bg.heightMeters) {
    b = {
      minX: Math.min(b.minX, bg.x - bg.widthMeters / 2), maxX: Math.max(b.maxX, bg.x + bg.widthMeters / 2),
      minY: Math.min(b.minY, bg.y - bg.heightMeters / 2), maxY: Math.max(b.maxY, bg.y + bg.heightMeters / 2),
    };
  }
  if (!isFinite(b.minX)) b = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
  const padX = Math.max(1, (b.maxX - b.minX) * 0.08);
  const padY = Math.max(1, (b.maxY - b.minY) * 0.08);
  const minX = b.minX - padX, maxX = b.maxX + padX, minY = b.minY - padY, maxY = b.maxY + padY;

  const W = o.width ?? 2480;
  const drawW = W;
  const zoom = drawW / (maxX - minX);
  const drawH = Math.max(400, Math.round((maxY - minY) * zoom));
  const footer = o.titleBlock ? Math.round(W * 0.07) : 0;
  const margin = o.titleBlock ? Math.round(W * 0.02) : 0;
  const H = drawH + footer + margin * 2;
  const canvas = document.createElement('canvas');
  canvas.width = W + margin * 2;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const pal = PALETTES[o.palette];
  ctx.fillStyle = pal.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const w2s = (x: number, y: number) => ({ x: margin + (x - minX) * zoom, y: margin + (maxY - y) * zoom });

  if (bg && bg.src) {
    await new Promise<void>(resolve => {
      const img = new Image();
      if (!bg.src.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tl = w2s(bg.x - bg.widthMeters / 2, bg.y + bg.heightMeters / 2);
        const br = w2s(bg.x + bg.widthMeters / 2, bg.y - bg.heightMeters / 2);
        ctx.save();
        ctx.globalAlpha = bg.opacity ?? 0.5;
        ctx.drawImage(img, tl.x, tl.y, br.x - tl.x, br.y - tl.y);
        ctx.restore();
        resolve();
      };
      img.onerror = () => resolve();
      img.src = bg.src;
    });
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(margin, margin, drawW, drawH);
  ctx.clip();
  renderPrimitives(ctx, prims, { zoom, w2s, palette: o.palette, pxScale: W / 1200 });
  ctx.restore();

  if (o.titleBlock) {
    const ink = o.palette === 'print' ? '#111' : '#e2e8f0';
    const sub = o.palette === 'print' ? '#555' : '#94a3b8';
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(2, W * 0.0012);
    ctx.strokeRect(margin, margin, drawW, drawH + footer);
    ctx.beginPath();
    ctx.moveTo(margin, margin + drawH);
    ctx.lineTo(margin + drawW, margin + drawH);
    ctx.stroke();

    const fy = margin + drawH;
    const fs = Math.round(footer * 0.3);
    ctx.fillStyle = ink;
    ctx.font = `bold ${fs}px "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(o.title || '交通標線配置圖', margin + footer * 0.3, fy + footer * 0.38);
    ctx.font = `${Math.round(fs * 0.6)}px "Noto Sans TC", sans-serif`;
    ctx.fillStyle = sub;
    ctx.fillText(`繪製日期 ${new Date().toISOString().slice(0, 10)}　單位：公尺　WebTrafficCAD`, margin + footer * 0.3, fy + footer * 0.75);

    // 比例尺
    const len = niceScaleLength(1 / zoom, W * 0.12);
    const barPx = len * zoom;
    const bx = margin + drawW - barPx - footer * 1.6;
    const by = fy + footer * 0.55;
    ctx.fillStyle = ink;
    ctx.fillRect(bx, by, barPx / 2, footer * 0.08);
    ctx.strokeRect(bx, by, barPx, footer * 0.08);
    ctx.font = `${Math.round(fs * 0.55)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('0', bx, by - footer * 0.14);
    ctx.fillText(`${len} m`, bx + barPx, by - footer * 0.14);

    // 指北針
    const nx = margin + drawW - footer * 0.7, ny = fy + footer * 0.5, r = footer * 0.32;
    ctx.beginPath();
    ctx.moveTo(nx, ny - r); ctx.lineTo(nx + r * 0.45, ny + r * 0.6); ctx.lineTo(nx, ny + r * 0.25); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(nx, ny - r); ctx.lineTo(nx - r * 0.45, ny + r * 0.6); ctx.lineTo(nx, ny + r * 0.25); ctx.closePath();
    ctx.stroke();
    ctx.font = `bold ${Math.round(fs * 0.55)}px sans-serif`;
    ctx.fillText('N', nx, ny - r - fs * 0.35);
  }

  return canvas.toDataURL('image/png');
}
