/**
 * 掃掠範圍外框（聯集）快取：以 Web Worker 背景計算，完成後通知畫布重繪。
 * 不支援 Worker 的環境（測試）改用 setTimeout 在主執行緒計算。
 */
import { Hull, unionPolygons } from './analysis';
import { Pt } from './model';

type Rings = Pt[][][];

class OutlineService {
  private cache = new Map<string, { hulls: Hull[]; rings: Rings | null }>();
  private pending = new Map<number, { key: string; hulls: Hull[] }>();
  private listeners = new Set<() => void>();
  private worker: Worker | null = null;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue = new Map<string, Hull[]>();

  constructor() {
    try {
      if (typeof Worker !== 'undefined') {
        this.worker = new Worker(new URL('./envelope.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = (e: MessageEvent<{ id: number; rings: Rings }>) => this.done(e.data.id, e.data.rings);
        this.worker.onerror = () => { this.worker = null; };
      }
    } catch {
      this.worker = null;
    }
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };

  private done(id: number, rings: Rings) {
    const job = this.pending.get(id);
    this.pending.delete(id);
    if (!job) return;
    const c = this.cache.get(job.key);
    if (c && c.hulls === job.hulls) {
      c.rings = rings;
      this.listeners.forEach(l => l());
    }
  }

  /** 取得外框；尚未計算時排入佇列並回傳 null */
  get(key: string, hulls: Hull[]): Rings | null {
    const c = this.cache.get(key);
    if (c && c.hulls === hulls) return c.rings;
    this.cache.set(key, { hulls, rings: null });
    this.queue.set(key, hulls);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
    return null;
  }

  /** 立即同步計算（匯出用） */
  getSync(key: string, hulls: Hull[]): Rings {
    const c = this.cache.get(key);
    if (c && c.hulls === hulls && c.rings) return c.rings;
    const rings = unionPolygons(hulls.map(h => h.pts));
    this.cache.set(key, { hulls, rings });
    return rings;
  }

  private flush() {
    this.timer = null;
    const jobs = Array.from(this.queue.entries());
    this.queue.clear();
    for (const [key, hulls] of jobs) {
      const c = this.cache.get(key);
      if (!c || c.hulls !== hulls) continue;
      const id = ++this.seq;
      this.pending.set(id, { key, hulls });
      if (this.worker) {
        this.worker.postMessage({ id, polys: hulls.map(h => h.pts) });
      } else {
        setTimeout(() => this.done(id, unionPolygons(hulls.map(h => h.pts))), 0);
      }
    }
  }

  prune(liveKeys: Set<string>) {
    for (const k of Array.from(this.cache.keys())) if (!liveKeys.has(k)) this.cache.delete(k);
  }
}

export const outlineService = new OutlineService();
