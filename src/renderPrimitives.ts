import { Point2D } from './types';
import { Primitive, MarkColor } from './markings';

export type PaletteName = 'screen' | 'print';

/** 畫面（深色底）與列印（白底）兩種調色盤 */
export const PALETTES: Record<PaletteName, Record<MarkColor, string> & { background: string; islandFill: string }> = {
  screen: {
    background: '#0f1115',
    white: '#ffffff', yellow: '#f59e0b', red: '#ef4444', pink: '#f472b6', gray: '#a9a9a9',
    cyan: '#00ffff', guide: 'rgba(56, 189, 248, 0.6)', annot: '#fb923c', angle: '#ec4899',
    curve: '#3b82f6', text: '#e2e8f0', moto: '#16a34a',
    islandFill: 'rgba(15, 23, 42, 0.55)',
  },
  print: {
    background: '#ffffff',
    white: '#111111', yellow: '#c98a00', red: '#d10000', pink: '#d63384', gray: '#c8c8c8',
    cyan: '#0090a8', guide: 'rgba(30, 110, 200, 0.55)', annot: '#c2410c', angle: '#be185d',
    curve: '#1d4ed8', text: '#111111', moto: '#16a34a',
    islandFill: 'rgba(0, 0, 0, 0)',
  },
};

export interface RenderOptions {
  zoom: number;
  w2s: (x: number, y: number) => { x: number; y: number };
  palette?: PaletteName;
  /** 覆寫所有顏色（選取高亮等） */
  overrideColor?: string;
  /** 像素尺寸倍率（高解析度匯出時放大細線、標註字與螢幕虛線） */
  pxScale?: number;
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Point2D[], w2s: RenderOptions['w2s'], closed = false) {
  pts.forEach((p, i) => {
    const s = w2s(p.x, p.y);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (closed) ctx.closePath();
}

function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  if (color.startsWith('#') && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

export function renderPrimitives(ctx: CanvasRenderingContext2D, prims: Primitive[], opts: RenderOptions) {
  const pal = PALETTES[opts.palette || 'screen'];
  const { zoom, w2s } = opts;
  const col = (c: MarkColor) => opts.overrideColor || pal[c];
  const k = opts.pxScale ?? 1;
  const scaleDash = (d: [number, number]) => [d[0] * k, d[1] * k];

  prims.forEach(pr => {
    ctx.save();
    if (pr.kind === 'line') {
      if (pr.pts.length < 2) { ctx.restore(); return; }
      ctx.strokeStyle = col(pr.color);
      ctx.lineCap = pr.dash ? 'butt' : 'butt';
      ctx.lineJoin = pr.closed ? 'miter' : 'round';
      ctx.lineWidth = pr.width > 0 ? Math.max((pr.minPx ?? 1) * k, pr.width * zoom) : (pr.minPx ?? 1) * k;
      if (pr.dash) ctx.setLineDash([pr.dash[0] * zoom, pr.dash[1] * zoom]);
      else if (pr.dashPx) ctx.setLineDash(scaleDash(pr.dashPx));
      ctx.beginPath();
      tracePath(ctx, pr.pts, w2s, pr.closed);
      ctx.stroke();
    } else if (pr.kind === 'poly') {
      if (pr.pts.length < 3) { ctx.restore(); return; }
      ctx.beginPath();
      tracePath(ctx, pr.pts, w2s, true);
      (pr.holes || []).forEach(h => tracePath(ctx, h, w2s, true));
      if (pr.fill) {
        ctx.fillStyle = opts.overrideColor ? withAlpha(opts.overrideColor, 0.35) : withAlpha(pal[pr.fill], pr.fillAlpha ?? 1);
        ctx.fill(pr.holes && pr.holes.length ? 'evenodd' : 'nonzero');
      }
      if (pr.stroke) {
        ctx.strokeStyle = col(pr.stroke);
        ctx.lineJoin = 'miter';
        ctx.lineWidth = Math.max(1, (pr.strokeWidth ?? 0.1) * zoom);
        ctx.stroke();
      }
    } else if (pr.kind === 'text') {
      const s = w2s(pr.p.x, pr.p.y);
      const px = pr.fixedPx ? pr.fixedPx * k : Math.max((pr.minPx ?? 0) * k, pr.size * zoom);
      ctx.translate(s.x, s.y);
      ctx.rotate(-(pr.angle || 0));
      if (pr.widthFactor && pr.widthFactor !== 1) ctx.scale(pr.widthFactor, 1);
      ctx.font = `${px}px "Noto Sans TC", "Microsoft JhengHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (pr.fixedPx) {
        // 標註文字加底色遮罩，避免壓線
        const w = ctx.measureText(pr.text).width;
        ctx.fillStyle = opts.palette === 'print' ? 'rgba(255,255,255,0.85)' : 'rgba(15,17,21,0.8)';
        ctx.fillRect(-w / 2 - 3 * k, -px / 2 - 2 * k, w + 6 * k, px + 4 * k);
      }
      ctx.fillStyle = col(pr.color);
      ctx.fillText(pr.text, 0, 0);
    } else if (pr.kind === 'circle') {
      const s = w2s(pr.c.x, pr.c.y);
      ctx.strokeStyle = col(pr.color);
      ctx.lineWidth = 1.5 * k;
      if (pr.dashPx) ctx.setLineDash(scaleDash(pr.dashPx));
      ctx.beginPath();
      ctx.arc(s.x, s.y, pr.r * zoom, 0, Math.PI * 2);
      ctx.stroke();
    } else if (pr.kind === 'arc') {
      const s = w2s(pr.c.x, pr.c.y);
      ctx.strokeStyle = col(pr.color);
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      // 螢幕 y 軸向下，角度取負並反向
      ctx.arc(s.x, s.y, pr.r * zoom, -pr.a0, -pr.a1, true);
      ctx.stroke();
    }
    ctx.restore();
  });
}
