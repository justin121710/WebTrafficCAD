/**
 * 軌跡模擬狀態容器（React 外部 store，以 useSyncExternalStore 訂閱）
 *
 * - doc：可存檔的資料（路徑來源、自訂車種、設定），所有修改都經過 commit() 進入復原堆疊
 * - draft：繪製中尚未完成的路徑；節點層級的復原另有 draftPast
 * - 拖曳以 transaction 包起來，一次拖曳只產生一筆復原紀錄
 * - 結果（姿態、掃掠、檢核）由 doc＋圖面障礙物衍生並快取，不寫回 doc
 * - 播放進度獨立通知，避免每一幀都讓整個介面重新繪製
 */
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_DRIVE, DEFAULT_INTERSECTION, PATH_COLORS, PathKind, PathSource, Pt, SimDoc, SimPath, SimSettings,
  emptyDoc, newId, sourceIsBuildable,
} from './model';
import { SimResult, computeFromBuilt } from './compute';
import { buildPath, BuiltPath } from './pathBuilder';
import { Obstacle } from './analysis';
import { VEHICLE_LIBRARY, VehicleSpec, findVehicle } from './vehicles';

export type SimTool = 'select' | PathKind;

export type IntersectionStep = 'p0' | 'p3' | 'done';

export interface SimUi {
  tool: SimTool;
  activePathId: string | null;
  /** 選取的節點（點選／鋼筆節點索引；路口 0 = P0、1 = P3） */
  selectedNode: number | null;
  intersectionStep: IntersectionStep;
  rightTab: 'vehicle' | 'path' | 'result';
  /** HUD 與播放使用的車種（同一路徑套疊多車種時） */
  activeVehicleId: string | null;
  /** 繪製預覽：游標位置 */
  hover: Pt | null;
  /** 正在拖曳（結果改用快速計算） */
  dragging: boolean;
}

export interface ResultEntry {
  key: string;
  pathId: string;
  vehicleId: string;
  path: SimPath;
  result: SimResult;
  /** 拖曳中的快速結果：未計算掃掠寬度、偏移與淨距 */
  partial: boolean;
}

interface CacheItem { source: PathSource; drive: SimPath['drive']; vehicle: VehicleSpec; obstacles: Obstacle[]; bufferM: number; partial: boolean; result: SimResult }

const HISTORY_LIMIT = 100;
const COALESCE_MS = 800;
export const DRAFT_ID = '__draft__';

function cloneDoc(d: SimDoc): SimDoc {
  return JSON.parse(JSON.stringify(d));
}

export class SimStore {
  doc: SimDoc = emptyDoc();
  draft: SimPath | null = null;
  ui: SimUi = {
    tool: 'select', activePathId: null, selectedNode: null, intersectionStep: 'p0', rightTab: 'path',
    activeVehicleId: null, hover: null, dragging: false,
  };
  private past: SimDoc[] = [];
  private future: SimDoc[] = [];
  private draftPast: (SimPath | null)[] = [];
  private txn: { before: SimDoc; draftBefore: SimPath | null } | null = null;
  private lastCoalesce: { key: string; t: number } | null = null;
  private listeners = new Set<() => void>();
  private playListeners = new Set<() => void>();
  private version = 0;

  obstacles: Obstacle[] = [];
  private cache = new Map<string, CacheItem>();
  private builtCache = new Map<string, { source: PathSource; built: BuiltPath | null }>();
  private resultsVersion = -1;
  private resultsSnapshot: ResultEntry[] = [];

  // 播放
  playing = false;
  playS = 0;
  private raf: number | null = null;
  private lastT = 0;

  // 由 App 注入
  onToast: (msg: string, type?: 'success' | 'error' | 'info') => void = () => {};
  onConfirm: (title: string, message: string, label: string, run: () => void) => void = (_t, _m, _l, run) => run();
  onDocChange: () => void = () => {};

  /* ---------------- 訂閱 */
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  subscribePlay = (fn: () => void) => { this.playListeners.add(fn); return () => this.playListeners.delete(fn); };
  getVersion = () => this.version;
  getPlayS = () => this.playS;
  private emit(docChanged = false) {
    this.version++;
    if (docChanged) this.onDocChange();
    this.listeners.forEach(l => l());
  }
  private emitPlay() { this.playListeners.forEach(l => l()); }

  /* ---------------- 車種 */
  vehicles(): VehicleSpec[] { return [...VEHICLE_LIBRARY, ...this.doc.customVehicles]; }
  vehicle(id: string): VehicleSpec { return findVehicle(id, this.doc.customVehicles) ?? VEHICLE_LIBRARY[0]; }

  /* ---------------- 查詢 */
  getPath(id: string | null): SimPath | null {
    if (!id) return null;
    if (id === DRAFT_ID) return this.draft;
    return this.doc.paths.find(p => p.id === id) ?? null;
  }
  activePath(): SimPath | null {
    return this.draft ?? this.getPath(this.ui.activePathId);
  }
  canUndo() { return this.draftPast.length > 0 || (!this.draft && this.past.length > 0); }
  canRedo() { return !this.draft && this.future.length > 0; }

  /* ---------------- 文件修改 */
  /** 以 fn 修改 doc 並記錄復原；coalesceKey 相同且間隔短時合併為一筆（例如連續輸入數值） */
  commit(fn: (d: SimDoc) => void, coalesceKey?: string) {
    const before = this.doc;
    const next = cloneDoc(before);
    fn(next);
    if (this.txn) {
      this.doc = next;
    } else {
      const now = Date.now();
      const merge = coalesceKey && this.lastCoalesce && this.lastCoalesce.key === coalesceKey && now - this.lastCoalesce.t < COALESCE_MS;
      if (!merge) {
        this.past.push(before);
        if (this.past.length > HISTORY_LIMIT) this.past.shift();
      }
      this.future = [];
      this.lastCoalesce = coalesceKey ? { key: coalesceKey, t: now } : null;
      this.doc = next;
    }
    this.emit(true);
  }

  /** 拖曳開始：之後的修改不逐筆記錄，結束時合併成一筆 */
  begin() {
    if (this.txn) return;
    this.txn = { before: this.doc, draftBefore: this.draft };
    this.ui = { ...this.ui, dragging: true };
    this.emit();
  }
  end() {
    if (!this.txn) return;
    const { before, draftBefore } = this.txn;
    this.txn = null;
    if (before !== this.doc) {
      this.past.push(before);
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
    }
    if (draftBefore !== this.draft && this.draft) this.draftPast.push(draftBefore);
    this.lastCoalesce = null;
    this.ui = { ...this.ui, dragging: false };
    this.emit(true);
  }
  inTransaction() { return !!this.txn; }

  undo() {
    if (this.txn) return;
    if (this.draft) {
      if (this.draftPast.length) {
        this.draft = this.draftPast.pop() ?? null;
        if (!this.draft) this.ui = { ...this.ui, intersectionStep: 'p0' };
        else if (this.draft.source.kind === 'intersection') this.ui = { ...this.ui, intersectionStep: this.draft.source.params.p3 ? 'done' : this.draft.source.params.p0 ? 'p3' : 'p0' };
        this.emit();
      }
      return;
    }
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(this.doc);
    this.doc = prev;
    this.fixSelection();
    this.lastCoalesce = null;
    this.emit(true);
  }
  redo() {
    if (this.txn || this.draft) return;
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.doc);
    this.doc = next;
    this.fixSelection();
    this.emit(true);
  }
  private fixSelection() {
    if (this.ui.activePathId && !this.doc.paths.some(p => p.id === this.ui.activePathId)) {
      this.ui = { ...this.ui, activePathId: null, selectedNode: null };
    }
  }

  /** 載入專案或還原自動暫存：清空復原堆疊 */
  load(doc: SimDoc) {
    this.stop();
    this.doc = doc;
    this.draft = null;
    this.past = [];
    this.future = [];
    this.draftPast = [];
    this.txn = null;
    this.ui = { ...this.ui, activePathId: doc.paths[0]?.id ?? null, selectedNode: null, intersectionStep: 'p0', tool: 'select', hover: null, dragging: false };
    this.playS = 0;
    this.cache.clear();
    this.builtCache.clear();
    this.emit();
    this.emitPlay();
  }

  setSettings(patch: Partial<SimSettings>, coalesceKey?: string) {
    this.commit(d => { Object.assign(d.settings, patch); }, coalesceKey ?? `settings:${Object.keys(patch).join(',')}`);
  }
  setDisplay(patch: Partial<SimSettings['display']>) {
    this.commit(d => { Object.assign(d.settings.display, patch); });
  }

  /* ---------------- UI */
  setUi(patch: Partial<SimUi>) {
    this.ui = { ...this.ui, ...patch };
    this.emit();
  }

  setTool(tool: SimTool) {
    if (this.draft) this.finishDraft(true);
    this.ui = { ...this.ui, tool, hover: null, selectedNode: null, intersectionStep: 'p0' };
    if (tool === 'intersection') this.startIntersectionDraft();
    this.emit();
  }

  selectPath(id: string | null) {
    if (this.draft) this.finishDraft(true);
    const p = this.getPath(id);
    this.ui = {
      ...this.ui,
      activePathId: id,
      selectedNode: null,
      activeVehicleId: p ? (p.vehicleIds.includes(this.ui.activeVehicleId ?? '') ? this.ui.activeVehicleId : p.vehicleIds[0]) : null,
    };
    this.playS = 0;
    this.emit();
    this.emitPlay();
  }

  /* ---------------- 路徑操作 */
  private nextName(): string {
    let n = this.doc.paths.length + 1;
    const names = new Set(this.doc.paths.map(p => p.name));
    while (names.has(`軌跡 ${n}`)) n++;
    return `軌跡 ${n}`;
  }
  private nextColor(): string {
    const used = this.doc.paths.map(p => p.color);
    return PATH_COLORS.find(c => !used.includes(c)) ?? PATH_COLORS[this.doc.paths.length % PATH_COLORS.length];
  }

  newPathFor(source: PathSource): SimPath {
    const defaultVeh = findVehicle(this.doc.settings.defaultVehicleId, this.doc.customVehicles) ? this.doc.settings.defaultVehicleId : VEHICLE_LIBRARY[0].id;
    return {
      id: DRAFT_ID,
      name: this.nextName(),
      color: this.nextColor(),
      source,
      vehicleIds: [defaultVeh],
      drive: { ...DEFAULT_DRIVE },
      visible: true,
      locked: false,
    };
  }

  startIntersectionDraft() {
    this.draft = this.newPathFor({ kind: 'intersection', params: { ...DEFAULT_INTERSECTION } });
    this.draftPast = [];
    this.ui = { ...this.ui, intersectionStep: 'p0', activeVehicleId: this.draft.vehicleIds[0] };
  }

  /** 設定草稿（push = true 時記錄一筆節點層級復原） */
  setDraft(draft: SimPath | null, push = true) {
    if (push && !this.txn) this.draftPast.push(this.draft);
    this.draft = draft;
    if (draft && !this.ui.activeVehicleId) this.ui = { ...this.ui, activeVehicleId: draft.vehicleIds[0] };
    this.emit();
  }
  updateDraftSource(fn: (s: PathSource) => PathSource, push = true) {
    if (!this.draft) return;
    this.setDraft({ ...this.draft, source: fn(this.draft.source) }, push);
  }
  patchDraft(patch: Partial<SimPath>) {
    if (!this.draft) return;
    this.setDraft({ ...this.draft, ...patch }, false);
  }

  /** 完成草稿：可建構時加入文件（可復原），否則捨棄 */
  finishDraft(silent = false): boolean {
    const d = this.draft;
    if (!d) return false;
    this.draft = null;
    this.draftPast = [];
    if (!sourceIsBuildable(d.source) || !buildPath(d.source)) {
      this.ui = { ...this.ui, intersectionStep: 'p0', hover: null };
      this.emit();
      return false;
    }
    const id = newId();
    this.commit(doc => { doc.paths.push({ ...d, id }); });
    this.ui = { ...this.ui, activePathId: id, selectedNode: null, intersectionStep: 'p0', hover: null, activeVehicleId: d.vehicleIds[0] };
    this.playS = 0;
    this.emit();
    if (!silent) this.onToast(`已完成「${d.name}」（Ctrl+Z 可復原）`, 'success');
    return true;
  }

  cancelDraft() {
    if (!this.draft) return false;
    this.draft = null;
    this.draftPast = [];
    this.ui = { ...this.ui, intersectionStep: 'p0', hover: null };
    if (this.ui.tool === 'intersection') this.startIntersectionDraft();
    this.emit();
    return true;
  }

  /** 更新路徑（草稿或已完成） */
  updatePath(id: string, fn: (p: SimPath) => SimPath, coalesceKey?: string) {
    if (id === DRAFT_ID) {
      if (this.draft) this.setDraft(fn(this.draft), !coalesceKey);
      return;
    }
    const p = this.getPath(id);
    if (!p) return;
    this.commit(d => {
      const i = d.paths.findIndex(x => x.id === id);
      if (i >= 0) d.paths[i] = fn(d.paths[i]);
    }, coalesceKey);
  }

  /** 拖曳中更新來源（不逐筆記錄；需先 begin()） */
  updateSourceLive(id: string, source: PathSource) {
    if (id === DRAFT_ID) {
      if (this.draft) { this.draft = { ...this.draft, source }; this.emit(); }
      return;
    }
    const i = this.doc.paths.findIndex(x => x.id === id);
    if (i < 0) return;
    const paths = this.doc.paths.slice();
    paths[i] = { ...paths[i], source };
    this.doc = { ...this.doc, paths };
    this.emit(true);
  }

  deletePath(id: string) {
    const p = this.getPath(id);
    if (!p) return;
    if (p.locked) { this.onToast(`「${p.name}」已鎖定，請先解除鎖定再刪除`, 'info'); return; }
    this.onConfirm('刪除軌跡', `確定要刪除「${p.name}」嗎？刪除後可以用 Ctrl+Z 復原。`, '刪除', () => {
      this.commit(d => { d.paths = d.paths.filter(x => x.id !== id); });
      if (this.ui.activePathId === id) this.ui = { ...this.ui, activePathId: null, selectedNode: null };
      this.emit();
    });
  }

  duplicatePath(id: string) {
    const p = this.getPath(id);
    if (!p || id === DRAFT_ID) return;
    const nid = newId();
    this.commit(d => {
      d.paths.push({ ...JSON.parse(JSON.stringify(p)), id: nid, name: `${p.name}（複本）`, color: this.nextColor(), locked: false });
    });
    this.ui = { ...this.ui, activePathId: nid };
    this.emit();
  }

  clearAll() {
    if (!this.doc.paths.length && !this.draft) return;
    this.onConfirm('清除所有軌跡', `確定要清除全部 ${this.doc.paths.length} 條軌跡嗎？可以用 Ctrl+Z 復原。`, '全部清除', () => {
      this.draft = null;
      this.draftPast = [];
      this.commit(d => { d.paths = []; });
      this.ui = { ...this.ui, activePathId: null, selectedNode: null };
      this.emit();
    });
  }

  /** 刪除選取的節點（至少保留 2 個） */
  deleteSelectedNode(): boolean {
    const p = this.activePath();
    const i = this.ui.selectedNode;
    if (!p || i === null || p.locked) return false;
    const s = p.source;
    if ((s.kind === 'polyline' || s.kind === 'pen') && s.nodes.length > 2) {
      const nodes = s.nodes.filter((_, k) => k !== i) as any;
      this.updatePath(p.id, x => ({ ...x, source: { ...s, nodes } as PathSource }));
      this.ui = { ...this.ui, selectedNode: null };
      this.emit();
      return true;
    }
    return false;
  }

  /** 草稿刪除最後一個節點（Backspace） */
  removeLastDraftNode(): boolean {
    const d = this.draft;
    if (!d) return false;
    const s = d.source;
    if (s.kind === 'polyline' || s.kind === 'pen') {
      if (s.nodes.length <= 1) { this.cancelDraft(); return true; }
      this.updateDraftSource(() => ({ ...s, nodes: s.nodes.slice(0, -1) } as PathSource));
      return true;
    }
    if (s.kind === 'freehand') { this.cancelDraft(); return true; }
    if (s.kind === 'intersection') {
      if (s.params.p3) { this.updateDraftSource(() => ({ ...s, params: { ...s.params, p3: null } })); this.ui = { ...this.ui, intersectionStep: 'p3' }; this.emit(); return true; }
      if (s.params.p0) { this.updateDraftSource(() => ({ ...s, params: { ...s.params, p0: null } })); this.ui = { ...this.ui, intersectionStep: 'p0' }; this.emit(); return true; }
    }
    return false;
  }

  /* ---------------- 車種 */
  addCustomVehicle(v: VehicleSpec) {
    this.commit(d => { d.customVehicles.push(v); });
  }
  updateCustomVehicle(id: string, patch: Partial<VehicleSpec>, coalesceKey?: string) {
    this.commit(d => {
      const v = d.customVehicles.find(x => x.id === id);
      if (v) Object.assign(v, patch);
    }, coalesceKey);
  }
  deleteCustomVehicle(id: string) {
    const used = this.doc.paths.filter(p => p.vehicleIds.includes(id));
    const run = () => this.commit(d => {
      d.customVehicles = d.customVehicles.filter(v => v.id !== id);
      d.paths.forEach(p => {
        p.vehicleIds = p.vehicleIds.filter(x => x !== id);
        if (!p.vehicleIds.length) p.vehicleIds = [d.settings.defaultVehicleId === id ? VEHICLE_LIBRARY[0].id : d.settings.defaultVehicleId];
      });
      if (d.settings.defaultVehicleId === id) d.settings.defaultVehicleId = VEHICLE_LIBRARY[0].id;
    });
    if (used.length) this.onConfirm('刪除自訂車種', `有 ${used.length} 條軌跡使用此車種，刪除後會改用預設車種。確定刪除？`, '刪除', run);
    else run();
  }

  /* ---------------- 結果 */
  setObstacles(obs: Obstacle[]) {
    this.obstacles = obs;
    this.emit();
  }

  private built(key: string, source: PathSource): BuiltPath | null {
    const c = this.builtCache.get(key);
    if (c && c.source === source) return c.built;
    const built = buildPath(source);
    this.builtCache.set(key, { source, built });
    return built;
  }

  /** 所有可見路徑（含草稿）× 車種的結果；以版本號快取 */
  getResults = (): ResultEntry[] => {
    if (this.resultsVersion === this.version) return this.resultsSnapshot;
    const out: ResultEntry[] = [];
    const paths: SimPath[] = [...this.doc.paths];
    if (this.draft) paths.push(this.draft);
    const bufferM = this.doc.settings.bufferM;
    const live = new Set<string>();
    for (const p of paths) {
      if (!p.visible || !sourceIsBuildable(p.source)) continue;
      const built = this.built(p.id, p.source);
      if (!built) continue;
      // 拖曳中只有正在編輯的路徑用快速計算
      const partial = this.ui.dragging && (p.id === DRAFT_ID || p.id === this.ui.activePathId);
      for (const vid of p.vehicleIds) {
        const vehicle = this.vehicle(vid);
        const key = `${p.id}|${vid}`;
        live.add(key);
        const c = this.cache.get(key);
        let result: SimResult;
        let isPartial = partial;
        if (c && c.source === p.source && c.drive === p.drive && c.vehicle === vehicle && c.obstacles === this.obstacles && c.bufferM === bufferM && (!c.partial || partial)) {
          result = c.result;
          isPartial = c.partial;
        } else {
          result = computeFromBuilt(built, vehicle, p.drive, partial ? [] : this.obstacles, bufferM, partial);
          this.cache.set(key, { source: p.source, drive: p.drive, vehicle, obstacles: this.obstacles, bufferM, partial, result });
        }
        out.push({ key, pathId: p.id, vehicleId: vid, path: p, result, partial: isPartial });
      }
    }
    for (const k of Array.from(this.cache.keys())) if (!live.has(k)) this.cache.delete(k);
    for (const k of Array.from(this.builtCache.keys())) if (!paths.some(p => p.id === k)) this.builtCache.delete(k);
    this.resultsVersion = this.version;
    this.resultsSnapshot = out;
    return out;
  };

  /** HUD／播放使用的結果 */
  activeResult(): ResultEntry | null {
    const res = this.getResults();
    const p = this.activePath();
    if (!p) return null;
    const list = res.filter(r => r.pathId === p.id);
    return list.find(r => r.vehicleId === this.ui.activeVehicleId) ?? list[0] ?? null;
  }

  /* ---------------- 播放 */
  setPlayS(s: number) {
    this.playS = Math.max(0, s);
    this.emitPlay();
  }
  togglePlay() {
    if (this.playing) this.stop();
    else this.play();
  }
  play() {
    const r = this.activeResult();
    if (!r) return;
    const total = r.result.traj.poses[r.result.traj.poses.length - 1]?.s ?? 0;
    if (this.playS >= total - 1e-6) this.playS = 0;
    this.playing = true;
    this.lastT = 0;
    const tick = (t: number) => {
      if (!this.playing) return;
      if (!this.lastT) this.lastT = t;
      const dt = Math.min(0.05, (t - this.lastT) / 1000);
      this.lastT = t;
      const cur = this.activeResult();
      if (!cur) { this.stop(); return; }
      const end = cur.result.traj.poses[cur.result.traj.poses.length - 1]?.s ?? 0;
      this.playS += (this.doc.settings.animKmh / 3.6) * dt;
      if (this.playS >= end) {
        this.playS = end;
        this.emitPlay();
        this.stop();
        return;
      }
      this.emitPlay();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
    this.emit();
  }
  stop() {
    this.playing = false;
    if (this.raf !== null && typeof cancelAnimationFrame !== 'undefined') cancelAnimationFrame(this.raf);
    this.raf = null;
    this.emit();
  }

  /* ---------------- 畫布定位請求（衝突清單點擊） */
  focus: { pt: Pt; seq: number } | null = null;
  requestFocus(pt: Pt) {
    this.focus = { pt, seq: (this.focus?.seq ?? 0) + 1 };
    this.emit();
  }
}

export const simStore = new SimStore();

/** 訂閱 store（任何變動都重新繪製；用於面板與畫布） */
export function useSimStore(store: SimStore = simStore): SimStore {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}

/** 只訂閱播放進度 */
export function useSimPlayS(store: SimStore = simStore): number {
  return useSyncExternalStore(store.subscribePlay, store.getPlayS);
}
