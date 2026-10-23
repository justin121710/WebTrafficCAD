import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CadElement, CadTool, IslandElement, TextElement } from './types';
import { 
  calculateWidening, 
  generateChannelizingIsland, 
  sampleCubicBezier, 
  getLineBezierRepresentation, 
  getPathOffsetCurves, 
  generateHatchingLines,
  distance,
  lerp,
  normalize,
  sampleClosedBezierLoop,
  generateCrosswalkStripes,
  getBezierMinRadiusOfCurvature,
  generateParkingZoneSlots
} from './geometry';
import { simStore, useSimStore } from './simulation/store';
import { buildObstacles } from './simulation/obstacles';
import { loadSimulation, serializeSimulation } from './simulation/persist';
import { emptyDoc } from './simulation/model';
import { cadMinPathRadius, CAD_VEHICLE_MAP, CadDesignVehicle } from './simulation/vehicles';
import SimPanel from './simulation/ui/SimPanel';
import { getSimulationPrimitives, simulationLegend, exportableEntries } from './simulation/exportPrims';
import SimHud from './simulation/ui/SimHud';
import SimTour, { simTourSeen } from './simulation/ui/SimTour';
import { SIM_TOOLS, SIM_SELECT_DEF } from './simulation/ui/SimToolPalette';
import { renderToolIcon } from './components/Toolbar';
import PropsPanel from './components/PropsPanel';
import CadCanvas, { transformElement, getElementBoundingBox } from './components/CadCanvas';
import { exportElementsToDXF } from './dxf';
import { renderElementsToPng } from './exportPng';
import { computeQuantities, layerKeyOf, MARKING_NAMES } from './markings';
import { buildCrossroadTemplate } from './templates';
import { saveAutosave, loadAutosave, clearAutosave } from './autosave';
import { TOOL_CATEGORIES, ALL_TOOLS } from './ui/toolCatalog';
import { MenuBar, MenuDef, MenuItem, RibbonTabs, Ribbon, RibbonGroup, RibbonBigButton, RibbonButton, RibbonCheck, StatusBar, StatusToggle } from './ui/Drafting';
import { LayerPanel, QuantityPanel, ArrowTypeBar, ConfirmDialog, AutosaveBanner, Toggle } from './ui/Panels';
import logoUrl from './assets/logo.svg';
import { PaletteName } from './renderPrimitives';
import { Info, CheckCircle2, AlertTriangle, RotateCcw, RotateCw, Image as ImageIcon, Upload, Trash2, Ruler, X, MousePointer2, Copy, ClipboardPaste, CopyPlus, Maximize, FileCode2, Table, Download, ChevronUp, ChevronDown } from 'lucide-react';

export default function App() {
  // App Mode State: 'cad' | 'simulation' (預設為 'cad')
  const [appMode, setAppMode] = useState<'cad' | 'simulation'>('cad');

  // 軌跡模擬狀態集中在 simStore（src/simulation/store.ts）
  const sim = useSimStore();
  const [showSimTour, setShowSimTour] = useState<boolean>(false);
  const [simDocVersion, setSimDocVersion] = useState<number>(0);

  // Central elements state (Geometries Array)
  const [elements, setElements] = useState<CadElement[]>([]);
  const [activeTool, setActiveTool] = useState<CadTool>('select');
  const [selectedElement, setSelectedElement] = useState<CadElement | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const [selectedAnchorIndices, setSelectedAnchorIndices] = useState<number[]>([]);

  // Parking stamp & zone state configurations for default parameters
  const [parkingStampConfig, setParkingStampConfig] = useState({
    slotType: 'car' as 'car' | 'motorcycle',
    width: 2.5,
    length: 5.5,
    angle: 0 // in radians
  });

  const [parkingZoneConfig, setParkingZoneConfig] = useState({
    slotType: 'car' as 'car' | 'motorcycle',
    width: 2.5,
    length: 5.5,
    angle: 90, // in degrees relative to tangent
    gap: 0.2,  // in meters
    side: 'right' as 'left' | 'right'
  });

  const [roadArrowConfig, setRoadArrowConfig] = useState({
    arrowType: 'straight' as 'straight' | 'left' | 'right' | 'straight_left' | 'straight_right',
    length: 5.0,
    angle: 0 // in radians
  });

  // Undo / Redo system historical timeline
  const [historyStack, setHistoryStack] = useState<CadElement[][]>([]);
  const [redoStack, setRedoStack] = useState<CadElement[][]>([]);

  // Custom persistent toast state for graceful sandboxed alerts
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
  };

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => {
        setToast(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Clear selected handle indices when selected element changes
  useEffect(() => {
    setSelectedAnchorIndices([]);
  }, [selectedElement?.id]);

  // Global Engineering settings
  const [R2, setR2] = useState<number>(10.0); // Default 10 meters radius
  const [designVehicle, setDesignVehicle] = useState<'passenger' | 'semi_trailer' | 'articulated'>('semi_trailer');
  const [bgImage, setBgImage] = useState<any>(null);
  const [exportedImage, setExportedImage] = useState<string | null>(null);
  const [projectName, setProjectName] = useState<string>('未命名路口配置');
  const [exportOptions, setExportOptions] = useState<{ palette: PaletteName; includeConstruction: boolean; includeAnnotations: boolean; titleBlock: boolean; includeSimulation: boolean }>({
    palette: 'print',
    includeConstruction: false,
    includeAnnotations: true,
    titleBlock: true,
    includeSimulation: true,
  });
  const [fitRequest, setFitRequest] = useState<number>(0);
  const [ribbonTab, setRibbonTab] = useState<'draw' | 'view' | 'output'>('draw');
  const [bottomTab, setBottomTab] = useState<'layers' | 'qty'>('layers');
  const [showHelp, setShowHelp] = useState<boolean>(false);
  const [layersCollapsed, setLayersCollapsed] = useState<boolean>(false);
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const [snapToIntersection, setSnapToIntersection] = useState<boolean>(true);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const [autosaveOffer, setAutosaveOffer] = useState<{ savedAt: string; project: any } | null>(null);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const [autosaveFailed, setAutosaveFailed] = useState<boolean>(false);
  const autosaveReadyRef = useRef<boolean>(false);
  // 載入專案後的第一次內容變更不算「未存檔」
  const skipDirtyRef = useRef<boolean>(false);
  const projectFileBase = () => `${(projectName || 'WebTrafficCAD').replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(0, 10)}`;
  const fileInputRef = useRef<HTMLInputElement>(null);




  // Snapping options
  const [snapToGrid, setSnapToGrid] = useState<boolean>(false);
  const [snapToEndpoint, setSnapToEndpoint] = useState<boolean>(true);
  const [snapToMidpoint, setSnapToMidpoint] = useState<boolean>(true);
  const [snapToNearest, setSnapToNearest] = useState<boolean>(true);

  // Background Grid options
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [minorGridInterval, setMinorGridInterval] = useState<number>(1);
  const [majorGridInterval, setMajorGridInterval] = useState<number>(5);

  // Register Global Hotkeys (Ctrl+Z, Ctrl+Y, V to select, and Delete/Backspace to delete selected elements)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      if (appMode === 'simulation') {
        if (e.target instanceof HTMLSelectElement) return;
        handleSimKey(e);
        return;
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (!isCmdOrCtrl && !e.altKey && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        setActiveTool('select');
      } else if (activeTool === 'select' && (selectedElement || selectedElementIds.length > 0) && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        const idsToDel = selectedElementIds.length > 0 ? selectedElementIds : (selectedElement ? [selectedElement.id] : []);
        if (idsToDel.length > 0) {
          saveHistory(elements);
          setElements(prev => prev.filter(el => !idsToDel.includes(el.id)));
          setSelectedElement(null);
          setSelectedElementIds([]);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    elements, historyStack, redoStack, activeTool, selectedElement, selectedElementIds,
    appMode,
  ]);

  // ---------- 軌跡模擬：快捷鍵、障礙物同步、提示與確認 ----------
  /** 模擬模式快捷鍵（與 CAD 一致：V 選取、Enter 完成、Esc 取消、Ctrl+Z／Y 復原重做） */
  const spaceTapRef = useRef<{ t: number; used: boolean } | null>(null);
  const handleSimKey = (e: KeyboardEvent) => {
    const st = simStore;
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); st.undo(); return; }
    if (ctrl && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); st.redo(); return; }
    if (ctrl) return;
    if (k === 'Enter') { e.preventDefault(); if (st.draft) st.finishDraft(); return; }
    if (k === 'Escape') {
      e.preventDefault();
      const d = st.draft;
      const hasContent = d && !(d.source.kind === 'intersection' && !d.source.params.p0);
      if (hasContent) st.cancelDraft();
      else if (st.ui.tool !== 'select') st.setTool('select');
      else st.selectPath(null);
      return;
    }
    if (k === 'Backspace') {
      e.preventDefault();
      if (st.draft) st.removeLastDraftNode();
      else st.deleteSelectedNode();
      return;
    }
    if (k === 'Delete') {
      e.preventDefault();
      if (st.draft) st.removeLastDraftNode();
      else if (!st.deleteSelectedNode() && st.ui.activePathId) st.deletePath(st.ui.activePathId);
      return;
    }
    if (e.code === 'Space') {
      if (!e.repeat) spaceTapRef.current = { t: performance.now(), used: false };
      return;
    }
    const map: Record<string, 'select' | 'polyline' | 'intersection' | 'pen' | 'freehand'> = { v: 'select', p: 'polyline', i: 'intersection', n: 'pen', b: 'freehand' };
    const tool = map[k.toLowerCase()];
    if (tool) { e.preventDefault(); st.setTool(tool); }
  };

  // 單按 Space（沒有拖曳平移）＝播放／暫停
  useEffect(() => {
    if (appMode !== 'simulation') return;
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !spaceTapRef.current) return;
      const tap = spaceTapRef.current;
      spaceTapRef.current = null;
      if (!tap.used && performance.now() - tap.t < 300 && !(e.target instanceof HTMLInputElement)) simStore.togglePlay();
    };
    const onDown = () => { if (spaceTapRef.current) spaceTapRef.current.used = true; };
    window.addEventListener('keyup', onUp);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keyup', onUp); window.removeEventListener('pointerdown', onDown, true); };
  }, [appMode]);

  // 提示、確認對話框與文件變更通知
  useEffect(() => {
    simStore.onToast = (m, t) => showToast(m, t ?? 'info');
    simStore.onConfirm = (title, message, confirmLabel, run) => setConfirmDialog({ title, message, confirmLabel, onConfirm: run });
    simStore.onDocChange = () => setSimDocVersion(v => v + 1);
  });


  const saveHistory = (currentElements: CadElement[]) => {
    try {
      const json = JSON.stringify(currentElements);
      const clone = JSON.parse(json);
      // 與上一筆相同（例如屬性面板聚焦後未修改）不重複記錄，避免多按一次復原才有反應
      setHistoryStack(prev => (prev.length && JSON.stringify(prev[prev.length - 1]) === json ? prev : [...prev, clone]));
      setRedoStack([]);
    } catch (e) {
      setHistoryStack(prev => [...prev, [...currentElements]]);
      setRedoStack([]);
    }
  };

  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const previous = historyStack[historyStack.length - 1];
    setHistoryStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, JSON.parse(JSON.stringify(elements))]);
    setElements(previous);
    setSelectedElement(null);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setHistoryStack(prev => [...prev, JSON.parse(JSON.stringify(elements))]);
    setElements(next);
    setSelectedElement(null);
  };

  // Handlers
  const handleAddElement = (el: CadElement) => {
    saveHistory(elements);
    setElements(prev => [...prev, el]);
  };

  const handleUpdateElement = (updated: CadElement) => {
    // Only update elements state
    setElements(prev => prev.map(el => el.id === updated.id ? updated : el));
    // Synced properties updates
    if (selectedElement && selectedElement.id === updated.id) {
      setSelectedElement(updated);
    }
  };

  const handlePropsUpdateElement = (updated: CadElement) => {
    setElements(prev => {
      const isUpdatingSelected = selectedElement && selectedElement.id === updated.id;
      if (isUpdatingSelected && selectedElementIds.length > 1 && selectedElementIds.includes(updated.id)) {
        const diff: Record<string, any> = {};
        const excludeKeys = ['id', 'p1', 'p2', 'points', 'center', 'cpLeft', 'cpRight', 'pA1', 'pA2', 'pB1', 'pB2'];
        
        for (const key in updated) {
          if (excludeKeys.includes(key)) continue;
          const oldVal = (selectedElement as any)[key];
          const newVal = (updated as any)[key];
          if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
            diff[key] = newVal;
          }
        }
        
        if (Object.keys(diff).length > 0) {
          return prev.map(el => {
            if (selectedElementIds.includes(el.id) && el.type === updated.type) {
              return {
                ...el,
                ...diff
              };
            }
            return el;
          });
        }
      }
      return prev.map(el => el.id === updated.id ? updated : el);
    });

    if (selectedElement && selectedElement.id === updated.id) {
      setSelectedElement(updated);
    }
  };

  // 畫布只收到「可見」物件，因此以 id 合併，避免隱藏圖層的物件被覆蓋掉
  const handleUpdateElements = (nextElements: CadElement[]) => {
    const byId = new Map(nextElements.map(el => [el.id, el]));
    setElements(prev => prev.map(el => byId.get(el.id) ?? el));
    if (selectedElement) {
      const updatedSel = nextElements.find(el => el.id === selectedElement.id);
      if (updatedSel) {
        setSelectedElement(updatedSel);
      }
    }
  };

  const handleDeleteElement = (id: string) => {
    saveHistory(elements);
    setElements(prev => prev.filter(el => el.id !== id));
    if (selectedElement?.id === id) {
      setSelectedElement(null);
    }
    setSelectedElementIds(prev => prev.filter(x => x !== id));
  };

  // 清空畫布：先以內建對話框確認（不使用瀏覽器 confirm，沙盒環境也能用），且可復原
  const handleClearCanvas = () => {
    setConfirmDialog({
      title: '清空畫布',
      message: `將刪除畫布上全部 ${elements.length} 個物件。清空後仍可按「復原（Ctrl+Z）」找回。`,
      confirmLabel: '清空',
      onConfirm: () => {
        saveHistory(elements);
        setElements([]);
        setSelectedElement(null);
        setSelectedElementIds([]);
      },
    });
  };

  // Save history before discrete active handles drag begins
  const handleSaveHistoryBeforeDrag = () => {
    saveHistory(elements);
  };

  // Road intersection template helper (載入交叉路口 Demo)
  // 載入十字路口範本（已有內容時先確認）
  const handleLoadDemo = () => {
    const load = () => {
      saveHistory(elements);
      setElements(buildCrossroadTemplate());
      setSelectedElement(null);
      setSelectedElementIds([]);
      setActiveTool('select');
      setFitRequest(n => n + 1);
      showToast('已載入十字路口範本，可直接修改或匯出。', 'success');
    };
    if (elements.length > 0) {
      setConfirmDialog({ title: '載入範本', message: '載入範本會取代目前畫布內容（可用復原 Ctrl+Z 找回）。確定要繼續嗎？', confirmLabel: '載入範本', onConfirm: load });
    } else {
      load();
    }
  };

  // Generate channelizing island automatically from selected curve or smart paths
  const handleGenerateIslandFromCurve = (curve: any) => {
    saveHistory(elements);
    const laneWidth = calculateWidening(R2, designVehicle);
    // Since we upgraded curves to Bezier points, generate the inner polygon from sampled points
    let refPoints: any[] = [];
    if (curve.points) {
      refPoints = curve.points;
    } else if (curve.pStart && curve.pEnd) {
      refPoints = [curve.pStart, curve.pIntersection, curve.pEnd];
    }
    
    if (refPoints.length < 2) return;

    // Approximated island offsets: shifted inwards relative to bounding logic
    const islandPoints = refPoints.map((pt: any) => ({
      x: pt.x + (pt.y > 0 ? 0.3 * laneWidth : -0.3 * laneWidth),
      y: pt.y + (pt.x > 0 ? -0.3 * laneWidth : 0.3 * laneWidth)
    }));

    if (islandPoints && islandPoints.length > 0) {
      const existingId = `island-of-${curve.id}`;
      const newIsland: IslandElement = {
        id: existingId,
        type: 'island',
        outerCurveId: curve.id,
        points: islandPoints,
        hasHatching: true,
        laneWidth,
        designVehicle
      };

      setElements(prev => {
        const filtered = prev.filter(el => el.id !== existingId);
        return [...filtered, newIsland];
      });
      setSelectedElement(newIsland);
    }
  };

  // 專案快照（存檔、自動儲存共用）
  const buildProjectData = () => ({
    version: '1.2.0',
    appMode,
    projectName,
    cad: {
      elements,
      R2,
      designVehicle,
    },
    bgImage,
    // 軌跡模擬：只存來源幾何與參數（version 2），結果載入後重新計算
    simulation: serializeSimulation(simStore.doc),
    settings: {
      snapToGrid,
      snapToEndpoint,
      snapToMidpoint,
      snapToNearest,
      snapToIntersection,
      showGrid,
      minorGridInterval,
      majorGridInterval,
      hiddenLayers,
      exportOptions,
    }
  });

  // 套用專案資料（開啟檔案、還原自動儲存共用）；回傳是否成功
  const applyProjectData = (json: any): boolean => {
    if (!json || !json.cad || !Array.isArray(json.cad.elements)) return false;
    skipDirtyRef.current = true;
    if (json.appMode) setAppMode(json.appMode);
    setProjectName(typeof json.projectName === 'string' ? json.projectName : '未命名路口配置');
    setElements(json.cad.elements);
    setHistoryStack([]);
    setRedoStack([]);
    if (typeof json.cad.R2 === 'number') setR2(json.cad.R2);
    if (json.cad.designVehicle) setDesignVehicle(json.cad.designVehicle);
    setBgImage(json.bgImage ?? null);

    // 模擬軌跡：新版直接驗證，舊版（像素座標）自動轉換
    simStore.load(json.simulation ? loadSimulation(json.simulation) : emptyDoc());

    if (json.settings) {
      const st = json.settings;
      if (typeof st.snapToGrid === 'boolean') setSnapToGrid(st.snapToGrid);
      if (typeof st.snapToEndpoint === 'boolean') setSnapToEndpoint(st.snapToEndpoint);
      if (typeof st.snapToMidpoint === 'boolean') setSnapToMidpoint(st.snapToMidpoint);
      if (typeof st.snapToNearest === 'boolean') setSnapToNearest(st.snapToNearest);
      if (typeof st.snapToIntersection === 'boolean') setSnapToIntersection(st.snapToIntersection);
      if (typeof st.showGrid === 'boolean') setShowGrid(st.showGrid);
      if (typeof st.minorGridInterval === 'number') setMinorGridInterval(st.minorGridInterval);
      if (typeof st.majorGridInterval === 'number') setMajorGridInterval(st.majorGridInterval);
      setHiddenLayers(Array.isArray(st.hiddenLayers) ? st.hiddenLayers : []);
      if (st.exportOptions) setExportOptions(prev => ({ ...prev, ...st.exportOptions }));
    }

    setSelectedElement(null);
    setSelectedElementIds([]);
    setSelectedAnchorIndices([]);
    setFitRequest(n => n + 1);
    return true;
  };

  // 儲存整個專案狀態為 JSON
  const handleSaveProject = () => {
    try {
      const jsonString = JSON.stringify(buildProjectData(), null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${projectFileBase()}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setIsDirty(false);
      showToast('已儲存專案檔（JSON）。', 'success');
    } catch (e) {
      console.error(e);
      showToast('儲存專案失敗。', 'error');
    }
  };

  // 匯入 JSON 專案檔
  const handleLoadProject = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = JSON.parse(e.target?.result as string);
        if (!applyProjectData(json)) {
          showToast('不是有效的專案檔。', 'error');
          return;
        }
        setIsDirty(false);
        showToast('已開啟專案。', 'success');
      } catch (err) {
        console.error(err);
        showToast('無法讀取這個檔案，請選擇 WebTrafficCAD 的 JSON 專案檔。', 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // 匯出 DXF：與畫布共用同一份幾何（具線寬、精確虛線、完整圖層）
  /** 匯出時一併輸出的模擬結果（依顯示設定決定要輸出的圖層） */
  const simExportPrims = () => {
    if (!exportOptions.includeSimulation) return [];
    const disp = simStore.doc.settings.display;
    return getSimulationPrimitives(simStore, { swept: true, buffer: disp.buffer, wheels: disp.wheelTracks, poses: disp.poses, annotations: exportOptions.includeAnnotations });
  };
  const hasSimExport = () => exportOptions.includeSimulation && exportableEntries(simStore).length > 0;

  const handleExportDXF = () => {
    if (elements.length === 0 && !hasSimExport()) {
      showToast('圖面上沒有物件，無法匯出 DXF。', 'error');
      return;
    }
    try {
      const dxfContent = exportElementsToDXF(visibleElements, {
        includeConstruction: exportOptions.includeConstruction,
        includeAnnotations: exportOptions.includeAnnotations,
        extraPrims: simExportPrims(),
      });
      downloadBlob(new Blob([dxfContent], { type: 'application/dxf' }), `${projectFileBase()}.dxf`);
      showToast('DXF 已匯出（單位：公尺，圖層依標線類型分層）', 'success');
    } catch (e) {
      console.error(e);
      showToast('匯出 DXF 失敗：' + (e as Error).message, 'error');
    }
  };

  // 匯出 PNG：與畫布共用同一份幾何，可選白底列印與圖框
  const handleExportPNG = async () => {
    if (elements.length === 0 && !bgImage && !hasSimExport()) {
      showToast('圖面上沒有物件，無法匯出 PNG。', 'error');
      return;
    }
    try {
      const dataUrl = await renderElementsToPng(visibleElements, {
        palette: exportOptions.palette,
        includeConstruction: exportOptions.includeConstruction,
        includeAnnotations: exportOptions.includeAnnotations,
        titleBlock: exportOptions.titleBlock,
        title: projectName,
        bgImage,
        extraPrims: simExportPrims(),
        legend: exportOptions.includeSimulation ? simulationLegend(simStore) : undefined,
      });
      setExportedImage(dataUrl);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${projectFileBase()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      showToast('匯出 PNG 失敗：' + (e as Error).message, 'error');
    }
  };

  // 匯出數量計算表（CSV，Excel 可直接開啟）
  const handleExportQuantities = () => {
    const rows = computeQuantities(visibleElements);
    if (rows.length === 0) {
      showToast('目前沒有可計算數量的標線。', 'error');
      return;
    }
    const lines = ['項目,物件數,實線長度(m),塗佈面積(m2)'];
    rows.forEach(r => lines.push(`${r.name},${r.count},${r.length.toFixed(2)},${r.area.toFixed(2)}`));
    const totalArea = rows.reduce((s, r) => s + r.area, 0);
    lines.push(`合計,,,${totalArea.toFixed(2)}`);
    downloadBlob(new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${projectFileBase()}_數量表.csv`);
    showToast('數量計算表已匯出（CSV）', 'success');
  };

  // ---------- 複製／貼上／旋轉 ----------
  const clipboardRef = useRef<CadElement[]>([]);
  const pasteCountRef = useRef<number>(0);
  const [canPaste, setCanPaste] = useState<boolean>(false);
  const getSelectedElements = (): CadElement[] => {
    const ids = selectedElementIds.length > 0 ? selectedElementIds : (selectedElement ? [selectedElement.id] : []);
    return elements.filter(el => ids.includes(el.id));
  };
  const cloneWithOffset = (els: CadElement[], d: number): CadElement[] =>
    els.map(el => ({ ...transformElement(JSON.parse(JSON.stringify(el)), d, -d, 0, { x: 0, y: 0 }), id: `${el.type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` }));
  const addAndSelect = (added: CadElement[]) => {
    if (!added.length) return;
    saveHistory(elements);
    setElements(prev => [...prev, ...added]);
    setSelectedElement(added[0]);
    setSelectedElementIds(added.length > 1 ? added.map(el => el.id) : []);
    setActiveTool('select');
  };
  const handleContextAction = (action: 'copy' | 'paste' | 'duplicate' | 'rotate90' | 'rotate-90' | 'delete') => {
    const sel = getSelectedElements();
    if (action === 'copy') {
      if (!sel.length) return;
      clipboardRef.current = JSON.parse(JSON.stringify(sel));
      pasteCountRef.current = 0;
      setCanPaste(true);
      showToast(`已複製 ${sel.length} 個物件`, 'info');
    } else if (action === 'paste') {
      if (!clipboardRef.current.length) return;
      pasteCountRef.current += 1;
      addAndSelect(cloneWithOffset(clipboardRef.current, 2 * pasteCountRef.current));
    } else if (action === 'duplicate') {
      addAndSelect(cloneWithOffset(sel, 2));
    } else if (action === 'rotate90' || action === 'rotate-90') {
      if (!sel.length) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      sel.forEach(el => { const b = getElementBoundingBox(el); minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY); });
      const c = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      const ang = action === 'rotate90' ? Math.PI / 2 : -Math.PI / 2;
      const ids = sel.map(el => el.id);
      saveHistory(elements);
      const next = elements.map(el => (ids.includes(el.id) ? transformElement(el, 0, 0, ang, c) : el));
      setElements(next);
      if (selectedElement) setSelectedElement(next.find(el => el.id === selectedElement.id) || null);
    } else if (action === 'delete') {
      if (!sel.length) return;
      saveHistory(elements);
      const ids = sel.map(el => el.id);
      setElements(prev => prev.filter(el => !ids.includes(el.id)));
      setSelectedElement(null);
      setSelectedElementIds([]);
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (appMode !== 'cad') return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'c') handleContextAction('copy');
      else if (k === 'v') { e.preventDefault(); handleContextAction('paste'); }
      else if (k === 'd') { e.preventDefault(); handleContextAction('duplicate'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- 自動儲存 ----------
  // 啟動時檢查是否有上次未存檔的自動儲存
  useEffect(() => {
    loadAutosave().then(rec => {
      const simPaths = rec?.project?.simulation?.paths?.length ?? rec?.project?.simulation?.simLockedPaths?.length ?? 0;
      if (rec && rec.project && Array.isArray(rec.project?.cad?.elements) && (rec.project.cad.elements.length > 0 || simPaths > 0)) {
        setAutosaveOffer(rec);
      }
      autosaveReadyRef.current = true;
    });
  }, []);

  // 內容變更後 1.5 秒自動儲存，並標記為「尚未存檔」
  useEffect(() => {
    if (!autosaveReadyRef.current || autosaveOffer) return;
    if (skipDirtyRef.current) skipDirtyRef.current = false;
    else setIsDirty(true);
    const t = setTimeout(() => {
      saveAutosave(buildProjectData()).then(ok => setAutosaveFailed(!ok));
    }, 1500);
    return () => clearTimeout(t);
  }, [elements, bgImage, simDocVersion, projectName, hiddenLayers]);

  // 有未存檔的變更時，關閉或重新整理頁面前提醒
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirty || (elements.length === 0 && simStore.doc.paths.length === 0)) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty, elements.length]);

  const handleRestoreAutosave = () => {
    if (autosaveOffer && applyProjectData(autosaveOffer.project)) {
      showToast('已還原上次自動儲存的內容。', 'success');
    }
    setAutosaveOffer(null);
  };
  const handleDiscardAutosave = () => {
    clearAutosave();
    setAutosaveOffer(null);
  };

  // 圖層顯示：隱藏的圖層不繪製、不可選取、不匯出
  const visibleElements = useMemo(
    () => (hiddenLayers.length ? elements.filter(el => !hiddenLayers.includes(layerKeyOf(el))) : elements),
    [elements, hiddenLayers]
  );
  // 模擬淨距檢核的障礙物：只取畫面上可見的物件
  const islandIsHard = sim.doc.settings.islandIsHard;
  useEffect(() => {
    simStore.setObstacles(buildObstacles(visibleElements, { islandIsHard }));
  }, [visibleElements, islandIsHard]);

  const toggleLayer = (key: string) => {
    setHiddenLayers(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
    setSelectedElement(null);
    setSelectedElementIds([]);
  };

  // ---------- 介面風格共用 ----------
  /** CAD 的車輛軌跡標線（貝茲）轉為模擬的鋼筆路徑，切換到軌跡模擬並選取 */
  const handleSimulateSmartPath = (el: any) => {
    const pts = el?.points || [];
    if (pts.length < 2) return;
    const cpL = el.cpLeft || pts, cpR = el.cpRight || pts;
    const nodes = pts.map((p: any, i: number) => ({
      p: { x: p.x, y: p.y },
      hIn: { x: (cpL[i]?.x ?? p.x) - p.x, y: (cpL[i]?.y ?? p.y) - p.y },
      hOut: { x: (cpR[i]?.x ?? p.x) - p.x, y: (cpR[i]?.y ?? p.y) - p.y },
      smooth: true,
    }));
    const vid = CAD_VEHICLE_MAP[(el.designVehicle || designVehicle) as CadDesignVehicle];
    const draft = simStore.newPathFor({ kind: 'pen', nodes });
    simStore.setDraft({ ...draft, name: `${draft.name}（由 CAD 引導線）`, vehicleIds: [vid] }, false);
    simStore.finishDraft(true);
    handleModeChange('simulation');
    simStore.setUi({ rightTab: 'result' });
    showToast('已建立模擬軌跡，可在右側查看檢核結果', 'success');
  };

  const handleModeChange = (mode: 'cad' | 'simulation') => {
    if (mode === 'cad') {
      // 離開模擬：繪製中的軌跡若已完整就完成，否則捨棄
      simStore.stop();
      if (simStore.ui.tool !== 'select') simStore.setTool('select');
      setAppMode('cad');
      return;
    }
    setAppMode('simulation');
    setActiveTool('select');
    setSelectedElement(null);
    setSelectedElementIds([]);
    if (!simTourSeen()) setShowSimTour(true);
  };

  const handleUploadBg = (file: File) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const src = event.target?.result as string;
      const img = new Image();
      img.onload = () => {
        setBgImage({
          src,
          x: 0,
          y: 0,
          widthMeters: img.width / 20,
          heightMeters: img.height / 20,
          opacity: 0.6,
          isCalibrated: false,
          pixelPerMeter: 20,
          fileName: file.name
        });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };


  // CAD 圖層面板：軌跡模擬結果的唯讀參考圖層
  const simRefLayerRow = sim.doc.paths.length > 0 ? (
    <div className="flex items-center justify-between gap-3 px-2 py-1.5 mt-2 rounded text-xs" style={{ border: '1px dashed var(--ui-border)' }}>
      <span>軌跡模擬結果（唯讀參考，{sim.doc.paths.length} 條）</span>
      <Toggle id="layer-sim-ref" on={sim.doc.settings.display.showInCad} onClick={() => simStore.setDisplay({ showInCad: !sim.doc.settings.display.showInCad })} />
    </div>
  ) : null;

  const hasToolConfig = activeTool === 'parking_space' || activeTool === 'parking_zone' || activeTool === 'road_arrow';
  const hasSelection = !!selectedElement || selectedElementIds.length > 0;

  // ---------- 狀態列：游標座標與比例直接寫入 DOM，避免每次移動滑鼠都重繪整個 App ----------
  const coordRef = useRef<HTMLSpanElement>(null);
  const scaleRef = useRef<HTMLSpanElement>(null);
  const handleCursorMove = useCallback((x: number, y: number, zoom: number) => {
    if (coordRef.current) coordRef.current.textContent = `${x.toFixed(3)}, ${y.toFixed(3)}`;
    if (scaleRef.current) {
      const n = 3780 / zoom;
      const m = Math.pow(10, Math.floor(Math.log10(n)) - 1);
      scaleRef.current.textContent = `比例 1:${Math.round(n / m) * m}`;
    }
  }, []);

  const canvasAreaEl = (
        <div className="flex-1 h-full min-w-0 relative flex flex-col">
          <CadCanvas
            onContextAction={handleContextAction}
            canPaste={canPaste}
            canvasBackground="#1d2127"
            fitRequest={fitRequest}
            onCursorMove={handleCursorMove}
            hideStatusBar
            snapToIntersection={snapToIntersection}
            elements={visibleElements}
            onAddElement={handleAddElement}
            onUpdateElement={handleUpdateElement}
          onUpdateElements={handleUpdateElements}
          selectedElement={selectedElement}
          onSelectElement={setSelectedElement}
          selectedElementIds={selectedElementIds}
          onSelectElementIdsChange={setSelectedElementIds}
          selectedAnchorIndices={selectedAnchorIndices}
          setSelectedAnchorIndices={setSelectedAnchorIndices}
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          parkingStampConfig={parkingStampConfig}
          setParkingStampConfig={setParkingStampConfig}
          parkingZoneConfig={parkingZoneConfig}
          roadArrowConfig={roadArrowConfig}
          setRoadArrowConfig={setRoadArrowConfig}
          R2={R2}
          designVehicle={designVehicle}
          snapToGrid={snapToGrid}
          snapToEndpoint={snapToEndpoint}
          snapToMidpoint={snapToMidpoint}
          snapToNearest={snapToNearest}
          onSaveHistoryBeforeDrag={handleSaveHistoryBeforeDrag}
          bgImage={bgImage}
          setBgImage={setBgImage}
          showGrid={showGrid}
          minorGridInterval={minorGridInterval}
          majorGridInterval={majorGridInterval}
          appMode={appMode}
          focusRequest={sim.focus}
          />
          {appMode === 'simulation' && <SimHud />}
        </div>
  );
  const propsPanelEl = (
              <PropsPanel 
                selectedElement={selectedElement}
                R2={R2}
                setR2={setR2}
                designVehicle={designVehicle}
                setDesignVehicle={setDesignVehicle}
                onUpdateElement={handlePropsUpdateElement}
                onDeleteElement={handleDeleteElement}
                onAddElement={(el) => { handleAddElement(el); setSelectedElement(el); }}
                onGenerateIslandFromCurve={handleGenerateIslandFromCurve}
                onSimulatePath={handleSimulateSmartPath}
                onSaveHistory={handleSaveHistoryBeforeDrag}
                selectedAnchorIndices={selectedAnchorIndices}
                activeTool={activeTool}
                parkingStampConfig={parkingStampConfig}
                setParkingStampConfig={setParkingStampConfig}
                parkingZoneConfig={parkingZoneConfig}
                setParkingZoneConfig={setParkingZoneConfig}
                roadArrowConfig={roadArrowConfig}
                setRoadArrowConfig={setRoadArrowConfig}
                onClearSelectedAnchors={() => setSelectedAnchorIndices([])}
                onTranslateSelectedAnchors={(dx, dy) => {
                  if (!selectedElement) return;
                  handleSaveHistoryBeforeDrag();
                  const updated = { ...selectedElement } as any;
                  if (updated.points) {
                    const newPts = updated.points.map((pt: any, idx: number) => {
                      if (selectedAnchorIndices.includes(idx)) {
                        return { x: pt.x + dx, y: pt.y + dy };
                      }
                      return pt;
                    });
                    const newCpLeft = updated.cpLeft ? updated.cpLeft.map((pt: any, idx: number) => {
                      if (selectedAnchorIndices.includes(idx)) {
                        return { x: pt.x + dx, y: pt.y + dy };
                      }
                      return pt;
                    }) : [];
                    const newCpRight = updated.cpRight ? updated.cpRight.map((pt: any, idx: number) => {
                      if (selectedAnchorIndices.includes(idx)) {
                        return { x: pt.x + dx, y: pt.y + dy };
                      }
                      return pt;
                    }) : [];

                    let minR = updated.minRadius || 999;
                    if ('minRadius' in updated && newPts.length > 1) {
                      let calcMinR = Infinity;
                      for (let j = 0; j < newPts.length - 1; j++) {
                        const r = getBezierMinRadiusOfCurvature(
                          newPts[j], 
                          newCpRight[j] || newPts[j], 
                          newCpLeft[j + 1] || newPts[j + 1], 
                          newPts[j + 1]
                        );
                        if (r < calcMinR) calcMinR = r;
                      }
                      minR = calcMinR === Infinity ? 999 : calcMinR;
                    }

                    const limit = cadMinPathRadius(designVehicle);
                    const isValid = minR >= limit;

                    handleUpdateElement({
                      ...updated,
                      points: newPts,
                      cpLeft: newCpLeft,
                      cpRight: newCpRight,
                      minRadius: minR,
                      isValid
                    });
                  }
                }}
              />
  );
  const simRightPanelEl = <SimPanel projectName={projectName} />;

  const sharedOverlaysEl = (
    <>
      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
      {appMode === 'simulation' && showSimTour && <SimTour onClose={() => setShowSimTour(false)} />}
      <AutosaveBanner offer={autosaveOffer} onRestore={handleRestoreAutosave} onDiscard={handleDiscardAutosave} />

      {exportedImage && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center p-4 z-[150]">
          <div className="bg-[#14161c] border border-zinc-800 rounded p-4 max-w-4xl w-full flex flex-col gap-3 shadow-xl">
            <div className="flex justify-between items-center pb-2 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white">PNG 預覽</h3>
              <button
                onClick={() => setExportedImage(null)}
                aria-label="關閉"
                className="text-zinc-400 hover:text-white p-1 rounded hover:bg-white/5 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-400">
              檔案已開始下載。若瀏覽器擋下載，可在預覽圖上按右鍵「另存圖片」，行動裝置請長按圖片。
            </p>

            <div className="flex-1 overflow-auto max-h-[60vh] border border-zinc-800 rounded bg-zinc-950 p-2 flex items-center justify-center">
              <img 
                src={exportedImage} 
                alt="WebTrafficCAD High Resolution Export" 
                className="max-h-full max-w-full object-contain" 
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-850">
              <a
                href={exportedImage}
                download={`TrafficCAD_Blueprint_${new Date().toISOString().slice(0, 10)}.png`}
                className="px-3.5 py-1.5 text-xs rounded flex items-center gap-1.5 cursor-pointer hover:brightness-90" style={{ background: "var(--ui-accent)", color: "var(--ui-accent-text)" }}
              >
                <Download className="w-3.5 h-3.5" /> 再次下載
              </a>
              <button
                onClick={() => setExportedImage(null)}
                className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs rounded cursor-pointer"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Elegant Toast notification */}
      {toast && (
        <div id="app-toast" role="status" className={`fixed bottom-[96px] left-1/2 -translate-x-1/2 z-[250] max-w-md bg-[#1b1d22] border border-zinc-700/70 text-zinc-100 pl-3 pr-1.5 py-2 rounded shadow-lg flex items-center gap-2.5`}>
          {toast.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            : toast.type === 'error' ? <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            : <Info className="w-4 h-4 shrink-0 text-sky-400" />}
          <p className="text-xs leading-relaxed flex-1">{toast.message}</p>
          <button
            onClick={() => setToast(null)}
            aria-label="關閉"
            className="text-zinc-500 hover:text-zinc-200 p-1 rounded hover:bg-white/5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </>
  );


  // ====================================================================
  // 製圖桌介面：選單列＋功能區＋畫布／性質面板＋指令列＋狀態列
  // ====================================================================
  const isCad = appMode === 'cad';
  const zoomToFit = () => setFitRequest(n => n + 1);
  const toolDef = ALL_TOOLS.find(t => t.id === activeTool);
  const simTool = sim.ui.tool;

  const editItems: MenuItem[] = [
    { label: '復原', shortcut: 'Ctrl+Z', onClick: isCad ? handleUndo : () => simStore.undo(), disabled: isCad ? historyStack.length === 0 : !sim.canUndo(), id: 'undo-btn' },
    { label: '重做', shortcut: 'Ctrl+Y', onClick: isCad ? handleRedo : () => simStore.redo(), disabled: isCad ? redoStack.length === 0 : !sim.canRedo(), id: 'redo-btn' },
    { label: '複製', shortcut: 'Ctrl+C', onClick: () => handleContextAction('copy'), disabled: !isCad || !hasSelection, separator: true },
    { label: '貼上', shortcut: 'Ctrl+V', onClick: () => handleContextAction('paste'), disabled: !isCad || !canPaste },
    { label: '原地複製', shortcut: 'Ctrl+D', onClick: () => handleContextAction('duplicate'), disabled: !isCad || !hasSelection },
    { label: '旋轉 90°', onClick: () => handleContextAction('rotate90'), disabled: !isCad || !hasSelection },
    { label: '刪除', shortcut: 'Del', onClick: () => handleContextAction('delete'), disabled: !isCad || !hasSelection, danger: true, separator: true },
  ];
  const menus: MenuDef[] = [
    {
      key: 'file', label: '檔案', items: [
        { label: '開啟專案…', onClick: () => fileInputRef.current?.click(), id: 'load-project-btn' },
        { label: '儲存專案（JSON）', onClick: handleSaveProject, id: 'save-project-btn' },
        { label: '載入十字路口範本', onClick: handleLoadDemo, separator: true, id: 'menu-template-btn' },
        { label: isCad ? '清空畫布…' : '清除所有軌跡', onClick: () => (isCad ? handleClearCanvas() : simStore.clearAll()), danger: true, disabled: isCad ? elements.length === 0 : (sim.doc.paths.length === 0 && !sim.draft), id: 'menu-clear-btn' },
        { label: '匯出工程圖 PNG', onClick: handleExportPNG, separator: true },
        { label: '匯出 AutoCAD DXF', onClick: handleExportDXF },
        { label: '匯出數量計算表 CSV', onClick: handleExportQuantities, disabled: !isCad },
      ],
    },
    { key: 'edit', label: '編輯', items: editItems },
    {
      key: 'view', label: '檢視', items: [
        { label: '縮放全圖', onClick: zoomToFit },
        { label: showGrid ? '隱藏網格' : '顯示網格', onClick: () => setShowGrid(!showGrid) },
        { label: '功能區：繪圖', onClick: () => setRibbonTab('draw'), separator: true },
        { label: '功能區：檢視', onClick: () => setRibbonTab('view') },
        { label: '功能區：輸出', onClick: () => setRibbonTab('output') },
      ],
    },
    { key: 'help', label: '說明', items: [{ label: '快捷鍵', onClick: () => setShowHelp(true) }] },
  ];

  const modeSwitch = (
    <div className="flex ml-3 rounded overflow-hidden" style={{ border: '1px solid var(--ui-border)' }}>
      {([['cad', 'CAD 繪圖'], ['simulation', '軌跡模擬']] as const).map(([m, label]) => (
        <button key={m} id={`mode-${m}`} onClick={() => handleModeChange(m)} className="h-[22px] px-3 text-xs cursor-pointer"
          style={appMode === m ? { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)' } : { color: 'var(--ui-muted)' }}>
          {label}
        </button>
      ))}
    </div>
  );
  const menuRight = (
    <>
      <input
        id="project-name-header"
        value={projectName}
        onChange={e => setProjectName(e.target.value)}
        className="hidden md:block bg-transparent text-xs outline-none px-1.5 h-[22px] w-40 text-right rounded hover:bg-white/5 focus:bg-white/5"
        style={{ color: 'var(--ui-text)' }}
        title="圖名（用於匯出檔名與圖框）"
        aria-label="圖名"
      />
      <span className="text-[11px] hidden lg:inline whitespace-nowrap ml-1" style={{ color: autosaveFailed ? '#f87171' : 'var(--ui-muted)' }}
        title={autosaveFailed ? '瀏覽器儲存空間不足或被封鎖，請立即另存專案檔' : isDirty ? '已自動暫存於瀏覽器，建議另存專案檔' : '已儲存'}>
        ·　{autosaveFailed ? '自動暫存失敗' : isDirty ? '已自動暫存' : '已儲存'}
      </span>
      {modeSwitch}
    </>
  );

  const icon = (id: CadTool) => renderToolIcon(id);
  const selectIcon = <MousePointer2 />;
  const drawRibbon = isCad ? (
    <>
      <RibbonGroup title="選取">
        <RibbonBigButton id="tool-btn-select" icon={selectIcon} label="選取" active={activeTool === 'select'} onClick={() => setActiveTool('select')} title="選取與編輯（V）" />
      </RibbonGroup>
      {TOOL_CATEGORIES.map(cat => (
        <RibbonGroup key={cat.key} title={cat.title}>
          {cat.tools.map(t => (
            <RibbonButton key={t.id} id={`tool-btn-${t.id}`} icon={icon(t.id)} label={t.label} title={t.desc} active={activeTool === t.id} onClick={() => setActiveTool(t.id)} />
          ))}
        </RibbonGroup>
      ))}
      <RibbonGroup title="修改">
        <RibbonButton icon={<Copy />} label="複製" title="Ctrl+C" disabled={!hasSelection} onClick={() => handleContextAction('copy')} />
        <RibbonButton icon={<ClipboardPaste />} label="貼上" title="Ctrl+V" disabled={!canPaste} onClick={() => handleContextAction('paste')} />
        <RibbonButton icon={<CopyPlus />} label="原地複製" title="Ctrl+D" disabled={!hasSelection} onClick={() => handleContextAction('duplicate')} />
        <RibbonButton icon={<RotateCw />} label="旋轉 90°" disabled={!hasSelection} onClick={() => handleContextAction('rotate90')} />
        <RibbonButton icon={<RotateCcw />} label="反轉 90°" disabled={!hasSelection} onClick={() => handleContextAction('rotate-90')} />
        <RibbonButton icon={<Trash2 />} label="刪除" title="Delete" disabled={!hasSelection} onClick={() => handleContextAction('delete')} />
      </RibbonGroup>
    </>
  ) : (
    <>
      <RibbonGroup title="選取">
        <RibbonBigButton id="sim-tool-select" icon={selectIcon} label="選取" active={simTool === 'select'} onClick={() => simStore.setTool('select')} title={SIM_SELECT_DEF.desc} />
      </RibbonGroup>
      <RibbonGroup title="繪製車輛軌跡">
        {SIM_TOOLS.map(t => (
          <RibbonButton key={t.id} id={`sim-tool-${t.id}`} icon={t.icon} label={`${t.label}（${t.key}）`} title={t.desc} active={simTool === t.id} onClick={() => simStore.setTool(t.id)} />
        ))}
      </RibbonGroup>
      <RibbonGroup title="檢核流程">
        {([['vehicle', '① 選車種'], ['path', '② 畫路徑'], ['result', '③ 看結果']] as const).map(([k, label]) => (
          <RibbonButton key={k} label={label} active={sim.ui.rightTab === k} onClick={() => simStore.setUi({ rightTab: k })} />
        ))}
      </RibbonGroup>
    </>
  );

  const gridSelect = (label: string, value: number, options: number[], onChange: (n: number) => void, isDisabled?: (n: number) => boolean) => (
    <label className="flex items-center gap-1.5 h-[24px] px-1.5 text-xs whitespace-nowrap">
      <span style={{ color: 'var(--ui-muted)' }}>{label}</span>
      <select value={value} onChange={e => onChange(parseFloat(e.target.value))} className="h-[20px] text-xs rounded outline-none cursor-pointer" style={{ background: 'var(--ui-bg)', color: 'var(--ui-text)', border: '1px solid var(--ui-border)' }}>
        {options.map(n => <option key={n} value={n} disabled={isDisabled?.(n)}>{n === 0 ? '無' : `${n} m`}</option>)}
      </select>
    </label>
  );
  const viewRibbon = (
    <>
      <RibbonGroup title="視圖">
        <RibbonBigButton icon={<Maximize />} label="縮放全圖" onClick={zoomToFit} />
      </RibbonGroup>
      <RibbonGroup title="網格">
        <RibbonCheck label="顯示網格" checked={showGrid} onChange={() => setShowGrid(!showGrid)} />
        {gridSelect('細網格', minorGridInterval, [0, 0.2, 0.5, 1, 2], n => { setMinorGridInterval(n); if (n > 0 && n >= majorGridInterval) setMajorGridInterval(n * 5); })}
        {gridSelect('粗網格', majorGridInterval, [0, 2, 5, 10, 20], setMajorGridInterval, n => n !== 0 && minorGridInterval !== 0 && n <= minorGridInterval)}
      </RibbonGroup>
      <RibbonGroup title="物件鎖點">
        <RibbonCheck id="snap-endpoint" label="端點" checked={snapToEndpoint} onChange={() => setSnapToEndpoint(!snapToEndpoint)} />
        <RibbonCheck id="snap-midpoint" label="中點" checked={snapToMidpoint} onChange={() => setSnapToMidpoint(!snapToMidpoint)} />
        <RibbonCheck id="snap-intersection" label="交點" checked={snapToIntersection} onChange={() => setSnapToIntersection(!snapToIntersection)} />
        <RibbonCheck id="snap-nearest" label="最近點／垂足" checked={snapToNearest} onChange={() => setSnapToNearest(!snapToNearest)} />
        <RibbonCheck id="snap-grid" label="格點" checked={snapToGrid} onChange={() => setSnapToGrid(!snapToGrid)} />
      </RibbonGroup>
      <RibbonGroup title="底圖">
        {!bgImage ? (
          <label className="row-span-3 flex flex-col items-center justify-center gap-1 w-[76px] text-xs cursor-pointer hover:bg-white/5 [&_svg]:w-6 [&_svg]:h-6" style={{ color: 'var(--ui-text)' }}>
            <Upload />
            <span className="text-center leading-tight">上傳航照<br />或現況圖</span>
            <input id="bg-image-uploader" type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadBg(f); e.target.value = ''; }} />
          </label>
        ) : (
          <>
            <span className="h-[24px] px-1.5 text-xs flex items-center max-w-[180px] truncate" style={{ color: 'var(--ui-muted)' }} title={bgImage.fileName}>{bgImage.fileName || '底圖'}（{bgImage.widthMeters.toFixed(0)}×{bgImage.heightMeters.toFixed(0)} m）</span>
            <label className="flex items-center gap-1.5 h-[24px] px-1.5 text-xs">
              <span style={{ color: 'var(--ui-muted)' }}>不透明度</span>
              <input type="range" min="0.1" max="1" step="0.05" value={bgImage.opacity || 0.6} onChange={e => { const n = parseFloat(e.target.value); setBgImage((prev: any) => prev ? { ...prev, opacity: n } : null); }} className="w-20" />
              <span className="font-mono w-8 text-right">{Math.round((bgImage.opacity || 0.6) * 100)}%</span>
            </label>
            <div className="flex">
              <RibbonButton icon={<Ruler />} label={activeTool === 'map_scale' ? '取消校正' : bgImage.isCalibrated ? '重新校正' : '校正比例'} active={activeTool === 'map_scale'} onClick={() => setActiveTool(activeTool === 'map_scale' ? 'select' : 'map_scale')} />
              <RibbonButton icon={<Trash2 />} label="移除" onClick={() => { setBgImage(null); if (activeTool === 'map_scale') setActiveTool('select'); }} />
            </div>
          </>
        )}
      </RibbonGroup>
    </>
  );

  const outputRibbon = (
    <>
      <RibbonGroup title="匯出">
        <RibbonBigButton id="export-png-btn" icon={<ImageIcon />} label="工程圖 PNG" onClick={handleExportPNG} />
        <RibbonBigButton id="export-dxf-btn" icon={<FileCode2 />} label="AutoCAD DXF" onClick={handleExportDXF} />
        {isCad && <RibbonBigButton id="export-csv-btn" icon={<Table />} label="數量表 CSV" onClick={handleExportQuantities} />}
      </RibbonGroup>
      <RibbonGroup title="出圖設定">
        <label className="flex items-center gap-1.5 h-[24px] px-1.5 text-xs whitespace-nowrap">
          <span style={{ color: 'var(--ui-muted)' }}>配色</span>
          <select value={exportOptions.palette} onChange={e => setExportOptions({ ...exportOptions, palette: e.target.value as PaletteName })} className="h-[20px] text-xs rounded outline-none cursor-pointer" style={{ background: 'var(--ui-bg)', color: 'var(--ui-text)', border: '1px solid var(--ui-border)' }}>
            <option value="print">白底列印</option>
            <option value="screen">深色簡報</option>
          </select>
        </label>
        <RibbonCheck label="圖框、比例尺、指北針" checked={exportOptions.titleBlock} onChange={() => setExportOptions({ ...exportOptions, titleBlock: !exportOptions.titleBlock })} />
        <RibbonCheck label="尺寸標註" checked={exportOptions.includeAnnotations} onChange={() => setExportOptions({ ...exportOptions, includeAnnotations: !exportOptions.includeAnnotations })} />
        <RibbonCheck label="輔助線／輔助圓" checked={exportOptions.includeConstruction} onChange={() => setExportOptions({ ...exportOptions, includeConstruction: !exportOptions.includeConstruction })} />
        <RibbonCheck id="export-include-sim" label="軌跡模擬結果" checked={exportOptions.includeSimulation} onChange={() => setExportOptions({ ...exportOptions, includeSimulation: !exportOptions.includeSimulation })} />
        {hiddenLayers.length > 0 && <span className="h-[24px] px-1.5 text-[11px] flex items-center whitespace-nowrap" style={{ color: '#f0a92b' }}>{hiddenLayers.length} 個圖層隱藏中，不會匯出</span>}
      </RibbonGroup>
      <RibbonGroup title="圖名">
        <input id="project-name-input" value={projectName} onChange={e => setProjectName(e.target.value)} aria-label="圖名"
          className="h-[22px] w-48 px-1.5 text-xs rounded outline-none" style={{ background: 'var(--ui-bg)', color: 'var(--ui-text)', border: '1px solid var(--ui-border)' }} />
      </RibbonGroup>
    </>
  );

  // ---------- 右側：性質（上）＋圖層／數量（下） ----------
  const selectionLabel = selectedElementIds.length > 1
    ? `${selectedElementIds.length} 個物件`
    : selectedElement
      ? `${MARKING_NAMES[(selectedElement as any).hatchPattern === 'cross' ? 'grid_box' : selectedElement.type] || selectedElement.type}（1）`
      : hasToolConfig && toolDef ? `${toolDef.label}：放置參數` : '未選取物件';
  const rightPanel = isCad ? (
    <div id="right-property-panel" className="w-[300px] shrink-0 h-full flex flex-col min-h-0" style={{ background: 'var(--ui-surface)', borderLeft: '1px solid var(--ui-border)' }}>
      <div className="flex items-center justify-between h-[28px] px-2.5 shrink-0 text-xs" style={{ background: 'var(--ui-ribbon)', borderBottom: '1px solid var(--ui-border)' }}>
        <span className="font-bold" style={{ color: 'var(--ui-strong)' }}>性質</span>
        <span className="truncate ml-2" style={{ color: 'var(--ui-muted)' }}>{selectionLabel}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {hasSelection || hasToolConfig ? propsPanelEl : (
          <div className="p-4 text-xs leading-relaxed" style={{ color: 'var(--ui-muted)' }}>
            點選圖面上的物件，即可在這裡修改尺寸、座標與規格。
            <ul className="mt-2 space-y-0.5">
              <li>框選可一次選取多個物件</li>
              <li>Delete 刪除；Ctrl+C／V／D 複製、貼上、原地複製</li>
              <li>繪製時按 Shift 鎖定水平／垂直</li>
            </ul>
          </div>
        )}
      </div>
      <div className={`${layersCollapsed ? '' : 'h-[38%] min-h-[180px]'} shrink-0 flex flex-col`} style={{ borderTop: '1px solid var(--ui-border)' }}>
        <div className="flex items-end h-[26px] pl-1.5 pr-1 shrink-0" style={{ background: 'var(--ui-ribbon)', borderBottom: layersCollapsed ? 'none' : '1px solid var(--ui-border)' }}>
          {([['layers', '圖層'], ['qty', '數量']] as const).map(([k, label]) => {
            const active = bottomTab === k && !layersCollapsed;
            return (
              <button key={k} id={`right-tab-${k}`} onClick={() => { setBottomTab(k); setLayersCollapsed(false); }} className="h-[24px] px-3 text-xs rounded-t cursor-pointer -mb-px"
                style={active ? { background: 'var(--ui-surface)', color: 'var(--ui-strong)', border: '1px solid var(--ui-border)', borderBottomColor: 'var(--ui-surface)' } : { color: 'var(--ui-muted)', border: '1px solid transparent' }}>
                {label}
              </button>
            );
          })}
          <button id="toggle-layers-panel" onClick={() => setLayersCollapsed(!layersCollapsed)} title={layersCollapsed ? '展開' : '收合'} aria-label={layersCollapsed ? '展開圖層面板' : '收合圖層面板'} aria-expanded={!layersCollapsed}
            className="ml-auto self-center w-6 h-6 flex items-center justify-center rounded cursor-pointer hover:bg-white/5" style={{ color: 'var(--ui-muted)' }}>
            {layersCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
        {!layersCollapsed && (
          <div className="flex-1 min-h-0 overflow-y-auto p-1.5">
            {bottomTab === 'layers'
              ? <LayerPanel elements={elements} hidden={hiddenLayers} onToggle={toggleLayer} onShowAll={() => setHiddenLayers([])} extra={simRefLayerRow} />
              : <div className="p-1"><QuantityPanel elements={visibleElements} onExport={handleExportQuantities} /></div>}
          </div>
        )}
      </div>
    </div>
  ) : (
    <div id="right-property-panel" className="w-[320px] shrink-0 h-full flex flex-col min-h-0" style={{ background: 'var(--ui-surface)', borderLeft: '1px solid var(--ui-border)' }}>
      <div className="flex-1 min-h-0 overflow-y-auto">{simRightPanelEl}</div>
    </div>
  );

  const statusToggles: StatusToggle[] = [
    { label: '網格', on: showGrid, onClick: () => setShowGrid(!showGrid), title: '顯示網格' },
    { label: '格點鎖點', on: snapToGrid, onClick: () => setSnapToGrid(!snapToGrid) },
    { label: '端點', on: snapToEndpoint, onClick: () => setSnapToEndpoint(!snapToEndpoint), title: '端點鎖點' },
    { label: '中點', on: snapToMidpoint, onClick: () => setSnapToMidpoint(!snapToMidpoint), title: '中點鎖點' },
    { label: '交點', on: snapToIntersection, onClick: () => setSnapToIntersection(!snapToIntersection), title: '交點鎖點' },
    { label: '最近點', on: snapToNearest, onClick: () => setSnapToNearest(!snapToNearest), title: '最近點／垂足鎖點' },
  ];

  const fileInput = <input type="file" ref={fileInputRef} accept=".json" onChange={handleLoadProject} style={{ display: 'none' }} />;
  const arrowBar = isCad && activeTool === 'road_arrow' && (
    <ArrowTypeBar value={roadArrowConfig.arrowType} onChange={(t) => setRoadArrowConfig({ ...roadArrowConfig, arrowType: t as any })} style={{ top: 12 }} />
  );

  return (
    <div id="webtrafficcad-app-root" className="ui-drafting flex flex-col h-screen w-screen overflow-hidden text-xs" style={{ background: 'var(--ui-bg)', color: 'var(--ui-text)' }}>
      {fileInput}
      <MenuBar logoSrc={logoUrl} menus={menus} right={menuRight} />
      <RibbonTabs tabs={[['draw', '繪圖'], ['view', '檢視'], ['output', '輸出']]} value={ribbonTab} onChange={k => setRibbonTab(k as any)} />
      <Ribbon>{ribbonTab === 'draw' ? drawRibbon : ribbonTab === 'view' ? viewRibbon : outputRibbon}</Ribbon>
      <div className="flex flex-1 min-h-0 relative">
        <div className="flex-1 min-w-0 h-full relative flex">
          {canvasAreaEl}
          {arrowBar}
        </div>
        {rightPanel}
      </div>
      <StatusBar coordRef={coordRef} scaleRef={scaleRef} toggles={statusToggles} right={<span className="whitespace-nowrap shrink-0 pr-1">單位 公尺</span>} />
      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
      {sharedOverlaysEl}
    </div>
  );
}

function HelpDialog({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ['V', '選取工具'], ['Enter／雙擊', '完成目前線段'], ['Esc', '第一次：完成或放棄目前繪製；第二次：回到選取'],
    ['Shift', '繪製時鎖定水平／垂直；旋轉時每 15°'], ['Space＋拖曳／中鍵', '平移畫面'], ['Ctrl+Z／Ctrl+Y', '復原／重做'],
    ['Ctrl+C／V／D', '複製／貼上／原地複製'], ['Delete', '刪除選取物件'],
  ];
  const sim: [string, string][] = [
    ['P／I／N／B', '點選＋半徑／路口轉彎／鋼筆／筆刷'], ['Enter、雙擊、右鍵', '完成目前軌跡'], ['Backspace', '刪除上一點或選取的節點'],
    ['Space（單按）', '播放／暫停'], ['Shift', '以 15° 鎖定方向'], ['Alt', '鋼筆：拖曳手柄做尖角'],
  ];
  const table = (title: string, data: [string, string][]) => (
    <div>
      <div className="font-bold mb-1.5" style={{ color: 'var(--ui-strong)' }}>{title}</div>
      {data.map(([k, v]) => (
        <div key={k} className="flex gap-3 py-[3px]" style={{ borderTop: '1px solid var(--ui-border)' }}>
          <span className="font-mono w-32 shrink-0">{k}</span><span style={{ color: 'var(--ui-muted)' }}>{v}</span>
        </div>
      ))}
    </div>
  );
  return (
    <div className="fixed inset-0 z-[400] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div id="help-dialog" className="w-full max-w-2xl p-5 rounded shadow-lg text-xs space-y-4" style={{ background: 'var(--ui-surface)', border: '1px solid var(--ui-border)', color: 'var(--ui-text)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold" style={{ color: 'var(--ui-strong)' }}>快捷鍵</h3>
          <button onClick={onClose} aria-label="關閉" className="p-1 rounded hover:bg-white/5 cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="grid md:grid-cols-2 gap-5">
          {table('CAD 繪圖', rows)}
          {table('軌跡模擬', sim)}
        </div>
      </div>
    </div>
  );
}
