import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { simStore, useSimPlayS, useSimStore } from './store';
import { drawSimulation } from './render';
import { outlineService } from './outlines';

/**
 * 軌跡模擬覆蓋層：疊在 CAD 畫布上方（不攔截滑鼠），使用與 CAD 畫布相同的視窗換算。
 * mode = 'cad' 時只顯示唯讀參考（掃掠範圍與引導線）。
 */
export default function SimulationLayer({ viewport, width, height, mode }: {
  viewport: { zoom: number; panX: number; panY: number };
  width: number;
  height: number;
  mode: 'sim' | 'cad';
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const store = useSimStore();
  const playS = useSimPlayS();
  const outlineTick = useSyncExternalStore(outlineService.subscribe, () => outlineVersion());

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    if (c.width !== width || c.height !== height) { c.width = width; c.height = height; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (mode === 'cad' && !store.doc.settings.display.showInCad) return;
    const { zoom, panX, panY } = viewport;
    const w2s = (x: number, y: number) => ({ x: width / 2 + x * zoom + panX, y: height / 2 - y * zoom + panY });
    const results = store.getResults().filter(r => mode === 'sim' || r.pathId !== '__draft__');
    drawSimulation({ ctx, w2s, zoom, width, height }, store, results, { mode, playS });
  });

  void outlineTick;
  return <canvas ref={ref} className="absolute inset-0 pointer-events-none" style={{ width, height }} />;
}

let outlineVer = 0;
outlineService.subscribe(() => { outlineVer++; });
function outlineVersion() { return outlineVer; }

export { simStore };
