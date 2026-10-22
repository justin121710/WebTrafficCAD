/**
 * 軌跡模擬的畫布操作（由 CadCanvas 的指標事件轉交）
 *
 * 鎖點、平移、縮放由 CadCanvas 處理；此模組只負責繪製與編輯路徑。
 * 拖曳一律包在 store.begin()/end() 之間，一次拖曳只產生一筆復原紀錄。
 */
import { CadElement } from '../types';
import { suggestHeading } from '../markings';
import { Pt, PathSource, PolyNode, PenNode, SimPath } from './model';
import { DRAFT_ID, SimStore } from './store';
import { Handle, applyHandleDrag, getHandles, translateSource } from './handles';
import { bboxOverlap, closestOnSegment, dir, dist, pointInPolygon } from './geom';

export interface SimPointer {
  sx: number;
  sy: number;
  /** 鎖點後的世界座標（m） */
  world: Pt;
  shift: boolean;
  alt: boolean;
  button: number;
  pointerType: string;
  w2s: (x: number, y: number) => { x: number; y: number };
  elements: CadElement[];
}

type Drag =
  | { type: 'handle'; pathId: string; handle: Handle }
  | { type: 'pathPending'; pathId: string; startWorld: Pt; sx: number; sy: number }
  | { type: 'path'; pathId: string; startWorld: Pt; startSource: PathSource }
  | { type: 'penNew'; index: number }
  | { type: 'freehand' }
  | { type: 'interPlace'; which: 'p0' | 'p3'; moved: boolean };

const SNAP_STEP = Math.PI / 12; // 15°

/** Shift：相對前一點以 15° 為單位鎖定方向 */
export function constrainAngle(prev: Pt, p: Pt): Pt {
  const d = dist(prev, p);
  if (d < 1e-9) return p;
  const a = Math.round(Math.atan2(p.y - prev.y, p.x - prev.x) / SNAP_STEP) * SNAP_STEP;
  return { x: prev.x + d * Math.cos(a), y: prev.y + d * Math.sin(a) };
}

export class SimInteraction {
  private drag: Drag | null = null;
  constructor(private store: SimStore) {}

  private hitR(e: SimPointer) { return e.pointerType === 'touch' ? 22 : 12; }

  private screenDist(e: SimPointer, p: Pt) {
    const s = e.w2s(p.x, p.y);
    return Math.hypot(s.x - e.sx, s.y - e.sy);
  }

  private hitHandle(e: SimPointer, path: SimPath): Handle | null {
    if (path.locked) return null;
    const entry = this.store.getResults().find(r => r.pathId === path.id);
    const hs = getHandles(path, entry?.result.built ?? null);
    let best: Handle | null = null, bd = this.hitR(e);
    // 手柄優先於節點（重疊時較容易抓到）
    for (const h of hs) {
      const d = this.screenDist(e, h.world) - (h.kind === 'node' || h.kind === 'p0' || h.kind === 'p3' ? 0 : 2);
      if (d <= bd) { bd = d; best = h; }
    }
    return best;
  }

  /** 點選路徑：落在掃掠範圍內或靠近引導線 */
  private hitPath(e: SimPointer): string | null {
    const res = this.store.getResults();
    const activeId = this.store.activePath()?.id;
    const ordered = [...res].sort((a, b) => Number(b.pathId === activeId) - Number(a.pathId === activeId));
    const r = this.hitR(e);
    for (const entry of ordered) {
      const pts = entry.result.built.pts;
      for (let i = 0; i < pts.length - 1; i += 4) {
        const a = e.w2s(pts[i].x, pts[i].y), b = e.w2s(pts[Math.min(pts.length - 1, i + 4)].x, pts[Math.min(pts.length - 1, i + 4)].y);
        if (closestOnSegment({ x: e.sx, y: e.sy }, a, b).d <= r) return entry.pathId;
      }
    }
    const box = { minX: e.world.x, minY: e.world.y, maxX: e.world.x, maxY: e.world.y };
    for (const entry of ordered) {
      for (const h of entry.result.hulls) {
        if (bboxOverlap(h.bbox, box) && pointInPolygon(e.world, h.pts)) return entry.pathId;
      }
    }
    return null;
  }

  isDragging() { return !!this.drag; }

  down(e: SimPointer): boolean {
    const st = this.store;
    if (e.button === 2) {
      if (st.draft) {
        if (!st.finishDraft()) st.cancelDraft();
      }
      return true;
    }
    if (e.button !== 0) return false;
    if (st.playing) st.stop();
    const tool = st.ui.tool;
    const draft = st.draft;

    if (tool === 'select') {
      const active = st.activePath();
      if (active) {
        const h = this.hitHandle(e, active);
        if (h) {
          if (e.alt && h.kind === 'node' && active.source.kind === 'pen') {
            this.togglePenSmooth(active, h.index);
            return true;
          }
          st.begin();
          this.drag = { type: 'handle', pathId: active.id, handle: h };
          if (h.kind === 'node' || h.kind === 'p0' || h.kind === 'p3') st.setUi({ selectedNode: h.index });
          return true;
        }
      }
      const hit = this.hitPath(e);
      if (hit) {
        if (hit !== st.ui.activePathId) st.selectPath(hit);
        else if (st.ui.selectedNode !== null) st.setUi({ selectedNode: null });
        const p = st.getPath(hit);
        if (p && !p.locked) this.drag = { type: 'pathPending', pathId: hit, startWorld: e.world, sx: e.sx, sy: e.sy };
        return true;
      }
      st.selectPath(null);
      return true;
    }

    if (tool === 'polyline') {
      const R = st.doc.settings.defaultRadius;
      if (!draft) {
        st.setDraft(st.newPathFor({ kind: 'polyline', nodes: [{ p: e.world, R, Ls: 0 }] }));
        return true;
      }
      const s = draft.source;
      if (s.kind !== 'polyline') return true;
      const last = s.nodes[s.nodes.length - 1].p;
      const p = e.shift ? constrainAngle(last, e.world) : e.world;
      if (dist(last, p) < 0.05) return true;
      st.updateDraftSource(() => ({ kind: 'polyline', nodes: [...s.nodes, { p, R, Ls: 0 } as PolyNode] }));
      return true;
    }

    if (tool === 'pen') {
      let p = e.world;
      const s = draft?.source;
      if (s && s.kind === 'pen' && s.nodes.length && e.shift) p = constrainAngle(s.nodes[s.nodes.length - 1].p, p);
      if (s && s.kind === 'pen' && s.nodes.length && dist(s.nodes[s.nodes.length - 1].p, p) < 0.05) return true;
      st.begin();
      const node: PenNode = { p, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 }, smooth: true };
      if (!draft || draft.source.kind !== 'pen') {
        st.setDraft(st.newPathFor({ kind: 'pen', nodes: [node] }));
        this.drag = { type: 'penNew', index: 0 };
      } else {
        const nodes = (draft.source as any).nodes as PenNode[];
        st.updateDraftSource(() => ({ kind: 'pen', nodes: [...nodes, node] }));
        this.drag = { type: 'penNew', index: nodes.length };
      }
      return true;
    }

    if (tool === 'freehand') {
      if (draft && draft.source.kind === 'freehand') {
        const pts = draft.source.points;
        if (pts.length && this.screenDist(e, pts[pts.length - 1]) <= 20) {
          st.begin();
          this.drag = { type: 'freehand' };
          return true;
        }
        st.finishDraft();
      }
      st.begin();
      st.setDraft(st.newPathFor({ kind: 'freehand', points: [e.world] }));
      this.drag = { type: 'freehand' };
      return true;
    }

    if (tool === 'intersection') {
      if (!draft || draft.source.kind !== 'intersection') st.startIntersectionDraft();
      const cur = st.draft!;
      if (st.ui.intersectionStep === 'done') {
        const h = this.hitHandle(e, cur);
        if (h) {
          st.begin();
          this.drag = { type: 'handle', pathId: DRAFT_ID, handle: h };
          return true;
        }
        // 點在空白處：完成目前這條並開始下一條
        st.finishDraft();
        st.startIntersectionDraft();
      }
      const which = st.ui.intersectionStep === 'p3' ? 'p3' : 'p0';
      st.begin();
      st.updateDraftSource(src => (src.kind === 'intersection' ? { ...src, params: { ...src.params, [which]: e.world } } : src));
      this.drag = { type: 'interPlace', which, moved: false };
      return true;
    }
    return false;
  }

  move(e: SimPointer) {
    const st = this.store;
    const d = this.drag;
    if (!d) {
      if (st.ui.tool === 'polyline' || st.ui.tool === 'pen') {
        const s = st.draft?.source;
        let p = e.world;
        if (s && (s.kind === 'polyline' || s.kind === 'pen') && s.nodes.length && e.shift) p = constrainAngle(s.nodes[s.nodes.length - 1].p, p);
        st.setUi({ hover: p });
      }
      return;
    }
    if (d.type === 'handle') {
      const path = st.getPath(d.pathId);
      if (!path) return;
      st.updateSourceLive(d.pathId, applyHandleDrag(path, d.handle, e.world, { breakSymmetry: e.alt }));
      return;
    }
    if (d.type === 'pathPending') {
      if (Math.hypot(e.sx - d.sx, e.sy - d.sy) < 4) return;
      const path = st.getPath(d.pathId);
      if (!path) { this.drag = null; return; }
      st.begin();
      this.drag = { type: 'path', pathId: d.pathId, startWorld: d.startWorld, startSource: path.source };
      return this.move(e);
    }
    if (d.type === 'path') {
      st.updateSourceLive(d.pathId, translateSource(d.startSource, { x: e.world.x - d.startWorld.x, y: e.world.y - d.startWorld.y }));
      return;
    }
    if (d.type === 'penNew') {
      const s = st.draft?.source;
      if (!s || s.kind !== 'pen') return;
      const nodes = s.nodes.map(n => ({ ...n }));
      const n = nodes[d.index];
      const v = { x: e.world.x - n.p.x, y: e.world.y - n.p.y };
      if (Math.hypot(v.x, v.y) * 1 < 0.05) { n.hOut = { x: 0, y: 0 }; n.hIn = { x: 0, y: 0 }; }
      else { n.hOut = v; n.hIn = { x: -v.x, y: -v.y }; }
      st.updateSourceLive(DRAFT_ID, { kind: 'pen', nodes });
      return;
    }
    if (d.type === 'freehand') {
      const s = st.draft?.source;
      if (!s || s.kind !== 'freehand') return;
      const last = s.points[s.points.length - 1];
      if (dist(last, e.world) >= 0.1) st.updateSourceLive(DRAFT_ID, { kind: 'freehand', points: [...s.points, e.world] });
      return;
    }
    if (d.type === 'interPlace') {
      const s = st.draft?.source;
      if (!s || s.kind !== 'intersection') return;
      const p = s.params[d.which];
      if (!p) return;
      if (dist(p, e.world) < 0.5 && !d.moved) return;
      d.moved = true;
      let h = Math.atan2(e.world.y - p.y, e.world.x - p.x);
      if (e.shift) h = Math.round(h / SNAP_STEP) * SNAP_STEP;
      st.updateSourceLive(DRAFT_ID, { ...s, params: { ...s.params, [d.which === 'p0' ? 'h0' : 'h3']: h } });
    }
  }

  up(e: SimPointer) {
    const st = this.store;
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.type === 'interPlace') {
      const s = st.draft?.source;
      if (s && s.kind === 'intersection' && !d.moved) {
        // 沒有拖曳：沿最近的車道線方向，終點方向取遠離起點者
        const p = s.params[d.which]!;
        const sug = suggestHeading(p, e.elements, d.which === 'p0' ? s.params.h0 : s.params.p0 ? Math.atan2(p.y - s.params.p0.y, p.x - s.params.p0.x) : s.params.h3, 15);
        let h = sug ?? (d.which === 'p0' ? s.params.h0 : s.params.h3);
        if (d.which === 'p3' && s.params.p0) {
          const away = { x: p.x - s.params.p0.x, y: p.y - s.params.p0.y };
          const u = dir(h);
          if (u.x * away.x + u.y * away.y < 0) h += Math.PI;
        }
        st.updateSourceLive(DRAFT_ID, { ...s, params: { ...s.params, [d.which === 'p0' ? 'h0' : 'h3']: h } });
      }
      st.end();
      if (d.which === 'p0') st.setUi({ intersectionStep: 'p3' });
      else {
        st.setUi({ intersectionStep: 'done' });
        st.onToast('已產生路口轉彎曲線：可拖曳起終點與方向箭頭微調，按 Enter 完成', 'info');
      }
      return;
    }
    if (d.type === 'pathPending') {
      if (d.pathId !== DRAFT_ID) st.setUi({ selectedNode: null });
      return;
    }
    if (st.inTransaction()) st.end();
  }

  /** 雙擊：繪製中完成；選取模式在線段上插入節點 */
  doubleClick(e: SimPointer): boolean {
    const st = this.store;
    if (st.draft && (st.ui.tool === 'polyline' || st.ui.tool === 'pen')) {
      const s = st.draft.source;
      if (s.kind === 'pen' && s.nodes.length >= 2 && dist(s.nodes[s.nodes.length - 1].p, s.nodes[s.nodes.length - 2].p) < 0.3) {
        st.updateDraftSource(() => ({ kind: 'pen', nodes: s.nodes.slice(0, -1) }), false);
      }
      st.finishDraft();
      return true;
    }
    if (st.ui.tool === 'select') {
      const p = st.activePath();
      if (!p || p.locked) return false;
      const s = p.source;
      if (s.kind !== 'polyline' && s.kind !== 'pen') return false;
      let bestI = -1, bd = Infinity;
      for (let i = 0; i < s.nodes.length - 1; i++) {
        const a = e.w2s(s.nodes[i].p.x, s.nodes[i].p.y), b = e.w2s(s.nodes[i + 1].p.x, s.nodes[i + 1].p.y);
        const r = closestOnSegment({ x: e.sx, y: e.sy }, a, b);
        if (r.d < bd) { bd = r.d; bestI = i; }
      }
      if (bestI < 0 || bd > 30) return false;
      if (s.kind === 'polyline') {
        const nodes = [...s.nodes];
        nodes.splice(bestI + 1, 0, { p: e.world, R: st.doc.settings.defaultRadius, Ls: 0 });
        st.updatePath(p.id, x => ({ ...x, source: { kind: 'polyline', nodes } }));
      } else {
        const nodes = [...s.nodes];
        nodes.splice(bestI + 1, 0, { p: e.world, hIn: { x: 0, y: 0 }, hOut: { x: 0, y: 0 }, smooth: true });
        st.updatePath(p.id, x => ({ ...x, source: { kind: 'pen', nodes } }));
      }
      st.setUi({ selectedNode: bestI + 1 });
      return true;
    }
    return false;
  }

  private togglePenSmooth(path: SimPath, i: number) {
    const s = path.source;
    if (s.kind !== 'pen') return;
    const nodes = s.nodes.map(n => ({ ...n }));
    const n = nodes[i];
    if (n.smooth) {
      n.smooth = false;
    } else {
      // 轉回平滑：兩側手柄對齊為共線
      const L = Math.max(Math.hypot(n.hOut.x, n.hOut.y), Math.hypot(n.hIn.x, n.hIn.y));
      const prev = nodes[i - 1]?.p, next = nodes[i + 1]?.p;
      const a = prev && next ? Math.atan2(next.y - prev.y, next.x - prev.x) : Math.atan2(n.hOut.y - n.hIn.y, n.hOut.x - n.hIn.x);
      const len = L > 1e-6 ? L : Math.max(1, (prev && next ? dist(prev, next) : 6) / 6);
      n.hOut = { x: Math.cos(a) * len, y: Math.sin(a) * len };
      n.hIn = { x: -n.hOut.x, y: -n.hOut.y };
      n.smooth = true;
    }
    this.store.updatePath(path.id, x => ({ ...x, source: { kind: 'pen', nodes } }));
  }

  /** 工具提示（與 CAD 繪圖相同樣式的說明卡） */
  hint(): { name: string; desc: string } | null {
    const st = this.store;
    const R = st.doc.settings.defaultRadius;
    switch (st.ui.tool) {
      case 'polyline': {
        const n = st.draft?.source.kind === 'polyline' ? st.draft.source.nodes.length : 0;
        return {
          name: `點選＋半徑（已放置 ${n} 點）`,
          desc: `依序點擊節點，轉角自動以 R = ${R} m 圓弧連接（可拖曳◆或在右側修改，也可加緩和曲線）。Shift 每 15°；Backspace 刪除上一點；Enter／雙擊／右鍵完成；Esc 取消。`,
        };
      }
      case 'pen':
        return { name: '鋼筆曲線', desc: '點擊新增節點，按住拖曳拉出切線；Alt 拖曳手柄可做尖角、Alt 點節點切換平滑。Enter／雙擊／右鍵完成；Esc 取消。' };
      case 'freehand':
        return { name: '筆刷手繪', desc: '按住左鍵拖曳手繪（會自動去除抖動）；放開後從終點按下可接續。Enter／右鍵完成；Esc 取消。' };
      case 'intersection': {
        const step = st.ui.intersectionStep;
        if (step === 'p0') return { name: '路口轉彎（步驟 1／2：起點）', desc: '在進入路口的車道上按下，並往行駛方向拖曳以定出起點與方向（不拖曳則沿最近的車道線方向）。Shift 每 15°。' };
        if (step === 'p3') return { name: '路口轉彎（步驟 2／2：終點）', desc: '在離開路口的車道上按下，並往行駛方向拖曳以定出終點與方向。' };
        return { name: '路口轉彎（完成）', desc: '拖曳起終點方塊或方向箭頭微調；右側可調整控制比例、外擺與延伸。Enter 完成，或在空白處點擊開始下一條。' };
      }
      default:
        return null;
    }
  }

  cursor(): string {
    if (this.drag?.type === 'path') return 'move';
    if (this.drag?.type === 'handle') return 'grabbing';
    return 'crosshair';
  }
}
