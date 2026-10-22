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
import SimPanel from './simulation/ui/SimPanel';
import SimHud from './simulation/ui/SimHud';
import SimTour, { simTourSeen } from './simulation/ui/SimTour';
import { GuidedSimSidebar, MinimalSimRail, PolishedSimDock } from './simulation/ui/SimToolPalette';
import Toolbar from './components/Toolbar';
import PropsPanel from './components/PropsPanel';
import CadCanvas, { transformElement, getElementBoundingBox } from './components/CadCanvas';
import { exportElementsToDXF } from './dxf';
import { renderElementsToPng } from './exportPng';
import { computeQuantities, layerKeyOf } from './markings';
import { buildCrossroadTemplate } from './templates';
import { saveAutosave, loadAutosave, clearAutosave } from './autosave';
import { UiStyle, loadUiStyle, saveUiStyle } from './ui/uiStyle';
import StylePicker from './ui/StylePicker';
import { MinimalToolRail, GuidedToolSidebar, PolishedDock } from './ui/ToolPalette';
import { ExportPanel, SettingsPanel, LayerPanel, QuantityPanel, ArrowTypeBar, ConfirmDialog, AutosaveBanner, ViewSettings } from './ui/Panels';
import { PaletteName } from './renderPrimitives';
import { Compass, Info, CheckCircle2, RotateCcw, RotateCw, Image as ImageIcon, Download, Upload, Trash2, Ruler, X, Grid, ChevronLeft, ChevronRight, Play, Pause, Sliders, Layers, Truck, Lock, Unlock, GitBranch, MapPin, Save, FolderOpen, ChevronDown, PenTool, Paintbrush } from 'lucide-react';

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
  const [isPropsCollapsed, setIsPropsCollapsed] = useState<boolean>(false);

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
  const [exportOptions, setExportOptions] = useState<{ palette: PaletteName; includeConstruction: boolean; includeAnnotations: boolean; titleBlock: boolean }>({
    palette: 'print',
    includeConstruction: false,
    includeAnnotations: true,
    titleBlock: true,
  });
  const [fitRequest, setFitRequest] = useState<number>(0);
  const [uiStyle, setUiStyleState] = useState<UiStyle>(() => loadUiStyle());
  const setUiStyle = (st: UiStyle) => { setUiStyleState(st); saveUiStyle(st); };
  const [modernMenu, setModernMenu] = useState<null | 'file' | 'export' | 'view'>(null);
  const [rightTab, setRightTab] = useState<'props' | 'layers' | 'qty'>('props');
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(true);
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const [snapToIntersection, setSnapToIntersection] = useState<boolean>(true);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const [autosaveOffer, setAutosaveOffer] = useState<{ savedAt: string; project: any } | null>(null);
  const [isDirty, setIsDirty] = useState<boolean>(false);
  const autosaveReadyRef = useRef<boolean>(false);
  // 載入專案後的第一次內容變更不算「未存檔」
  const skipDirtyRef = useRef<boolean>(false);
  const projectFileBase = () => `${(projectName || 'WebTrafficCAD').replace(/[\\/:*?"<>|]/g, '_')}_${new Date().toISOString().slice(0, 10)}`;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isExportDropdownOpen, setIsExportDropdownOpen] = useState<boolean>(false);




  // Snapping options
  const [snapToGrid, setSnapToGrid] = useState<boolean>(false);
  const [snapToEndpoint, setSnapToEndpoint] = useState<boolean>(true);
  const [snapToMidpoint, setSnapToMidpoint] = useState<boolean>(true);
  const [snapToNearest, setSnapToNearest] = useState<boolean>(true);

  // Background Grid options
  const [showGrid, setShowGrid] = useState<boolean>(true);
  const [minorGridInterval, setMinorGridInterval] = useState<number>(1);
  const [majorGridInterval, setMajorGridInterval] = useState<number>(5);
  const [isGridSettingsOpen, setIsGridSettingsOpen] = useState<boolean>(false);
  const [isSnapSettingsOpen, setIsSnapSettingsOpen] = useState<boolean>(false);

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
      } else if (e.key.toLowerCase() === 'v') {
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


  // 點擊外部時關閉匯出選單
  useEffect(() => {
    if (!isExportDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#export-dropdown-container')) {
        setIsExportDropdownOpen(false);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [isExportDropdownOpen]);

  const saveHistory = (currentElements: CadElement[]) => {

    try {
      const clone = JSON.parse(JSON.stringify(currentElements));
      setHistoryStack(prev => [...prev, clone]);
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
      showToast('專案已儲存為 JSON 檔！', 'success');
    } catch (e) {
      console.error(e);
      showToast('儲存專案時發生錯誤！', 'error');
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
          showToast('無效的專案檔案格式！', 'error');
          return;
        }
        setIsDirty(false);
        showToast('專案已成功匯入！', 'success');
      } catch (err) {
        console.error(err);
        showToast('解析專案檔案失敗，請確保是合法的 JSON 專案檔！', 'error');
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
  const handleExportDXF = () => {
    if (elements.length === 0) {
      showToast('當前畫布為空，無幾何資料可以匯出為 DXF！', 'error');
      return;
    }
    try {
      const dxfContent = exportElementsToDXF(visibleElements, {
        includeConstruction: exportOptions.includeConstruction,
        includeAnnotations: exportOptions.includeAnnotations,
      });
      downloadBlob(new Blob([dxfContent], { type: 'application/dxf' }), `${projectFileBase()}.dxf`);
      showToast('DXF 已匯出（單位：公尺，圖層依標線類型分層）', 'success');
    } catch (e) {
      console.error(e);
      showToast('匯出 DXF 發生異常：' + (e as Error).message, 'error');
    }
  };

  // 匯出 PNG：與畫布共用同一份幾何，可選白底列印與圖框
  const handleExportPNG = async () => {
    if (elements.length === 0 && !bgImage) {
      showToast('當前畫布為空，無底圖與幾何資料可以匯出為圖片！', 'error');
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
      });
      setExportedImage(dataUrl);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = `${projectFileBase()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      showToast('渲染工程圖時發生錯誤：' + (e as Error).message, 'error');
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

  // 新版介面選單：點擊選單外任何地方即關閉（玻璃面板的 backdrop-filter 會限制 fixed 遮罩，因此改用全域監聽）
  useEffect(() => {
    if (!modernMenu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest('[data-menu-root]')) setModernMenu(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setModernMenu(null); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [modernMenu]);

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
      saveAutosave(buildProjectData());
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

  const viewSettings: ViewSettings = {
    showGrid, setShowGrid, minorGridInterval, setMinorGridInterval, majorGridInterval, setMajorGridInterval,
    snapToGrid, setSnapToGrid, snapToEndpoint, setSnapToEndpoint, snapToMidpoint, setSnapToMidpoint,
    snapToNearest, setSnapToNearest, snapToIntersection, setSnapToIntersection,
    bgImage, setBgImage, onUploadBg: handleUploadBg,
    isCalibrating: activeTool === 'map_scale',
    onCalibrate: () => setActiveTool(activeTool === 'map_scale' ? 'select' : 'map_scale'),
  };

  const exportPanelEl = (
    <ExportPanel
      options={exportOptions}
      setOptions={setExportOptions}
      projectName={projectName}
      setProjectName={setProjectName}
      onPng={() => { handleExportPNG(); setModernMenu(null); setIsExportDropdownOpen(false); }}
      onDxf={() => { handleExportDXF(); setModernMenu(null); setIsExportDropdownOpen(false); }}
      onCsv={() => { handleExportQuantities(); setModernMenu(null); setIsExportDropdownOpen(false); }}
      hiddenCount={hiddenLayers.length}
    />
  );

  const hasToolConfig = activeTool === 'parking_space' || activeTool === 'parking_zone' || activeTool === 'road_arrow';
  const hasSelection = !!selectedElement || selectedElementIds.length > 0;
  // 簡潔風格：屬性面板只在有選取、工具有參數或模擬模式時出現
  const minimalPanelVisible = appMode === 'simulation' || hasSelection || hasToolConfig || rightTab !== 'props';
  const polishedPanelVisible = isRightPanelOpen && (appMode === 'simulation' || hasSelection || hasToolConfig || rightTab !== 'props');
  const canvasInsets = uiStyle === 'polished'
    ? { top: 64, right: polishedPanelVisible ? 352 : 0, bottom: 112, left: 0 }
    : { top: 0, right: 0, bottom: 0, left: 0 };

  const modeSwitchEl = (
          <div className="flex items-center bg-[#0a0b0e] border border-[#2d3039] rounded-lg p-0.5 select-none shrink-0">
            <button
              onClick={() => handleModeChange('cad')}
              className={`px-4 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                appMode === 'cad'
                  ? 'bg-blue-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              CAD 繪圖
            </button>
            <button
              onClick={() => handleModeChange('simulation')}
              className={`px-4 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                appMode === 'simulation'
                  ? 'bg-blue-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              軌跡模擬
            </button>
          </div>
  );
  const historyBtnsEl = (
<>
          {/* Clear Canvas Button */}
          <button
            onClick={() => {
              if (appMode === 'cad') {
                handleClearCanvas();
              } else {
                simStore.clearAll();
              }
            }}
            disabled={appMode === 'cad' ? elements.length === 0 : (sim.doc.paths.length === 0 && !sim.draft)}
            className="flex items-center justify-center w-8 h-8 rounded bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-[#1f2229] disabled:cursor-not-allowed transition-all text-slate-350 cursor-pointer"
            title={appMode === 'cad' ? "清空 CAD 標線畫布" : "一次清除所有軌跡"}
          >
            <Trash2 className="w-4 h-4 text-red-400" />
          </button>

          {/* Undo Button (Symbol Only) */}
          <button
            onClick={appMode === 'cad' ? handleUndo : () => simStore.undo()}
            disabled={appMode === 'cad' ? historyStack.length === 0 : !sim.canUndo()}
            className="flex items-center justify-center w-8 h-8 rounded bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-[#1f2229] disabled:cursor-not-allowed transition-all text-slate-300 cursor-pointer"
            title="撤銷 (Ctrl+Z)"
          >
            <RotateCcw className="w-4 h-4 text-slate-400" />
          </button>

          {/* Redo Button (Symbol Only) */}
          <button
            onClick={appMode === 'cad' ? handleRedo : () => simStore.redo()}
            disabled={appMode === 'cad' ? redoStack.length === 0 : !sim.canRedo()}
            className="flex items-center justify-center w-8 h-8 rounded bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-[#1f2229] disabled:cursor-not-allowed transition-all text-slate-300 cursor-pointer"
            title="重做 (Ctrl+Y)"
          >
            <RotateCw className="w-4 h-4 text-slate-400" />
          </button>

</>
  );
  const fileBtnsEl = (
<>
          {/* Save Project (JSON) */}
          <button
            id="save-project-btn"
            onClick={handleSaveProject}
            className="flex items-center justify-center w-8 h-8 rounded bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400 cursor-pointer transition-all shrink-0"
            title="儲存專案 (JSON)"
          >
            <Save className="w-4 h-4 text-emerald-400" />
          </button>

          {/* Load Project (JSON) */}
          <button
            id="load-project-btn"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center justify-center w-8 h-8 rounded bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-400 cursor-pointer transition-all shrink-0"
            title="開啟專案 (JSON)"
          >
            <FolderOpen className="w-4 h-4 text-amber-400" />
          </button>
          <input
            type="file"
            ref={fileInputRef}
            accept=".json"
            onChange={handleLoadProject}
            style={{ display: 'none' }}
          />

</>
  );
  const classicExportEl = (
          <div id="export-dropdown-container" className="relative shrink-0">
            <button
              id="export-dropdown-toggle-btn"
              onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
              className="flex items-center gap-1.5 h-8 px-3 text-xs rounded bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 text-blue-400 font-medium cursor-pointer transition-all shrink-0"
              title="匯出工程圖 (PNG) 或 AutoCAD DXF 向量檔"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden xl:inline">匯出</span>
              <ChevronDown className="w-3 h-3 text-blue-400/70" />
            </button>
            {isExportDropdownOpen && (
              <div className="ui-classic absolute right-0 top-full mt-1.5 w-72 rounded-lg bg-[#1f2229] border border-[#2d3039] shadow-xl p-3 z-30">
                {exportPanelEl}
              </div>
            )}
          </div>
  );
  const gridPopoverEl = (
          <div className="relative">
            <button
              id="grid-settings-toggle-btn"
              onClick={() => {
                setIsGridSettingsOpen(!isGridSettingsOpen);
                setIsSnapSettingsOpen(false);
              }}
              className={`flex items-center gap-1.5 h-8 px-3 text-xs rounded transition-all cursor-pointer font-medium ${
                isGridSettingsOpen || !showGrid
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/40' 
                  : 'bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 text-slate-300'
              }`}
              title="網格背景配置與尺寸間距設定"
            >
              <Grid className="w-3.5 h-3.5 text-blue-400" />
              <span className="hidden xl:inline">網格背景設定</span>
            </button>

            {isGridSettingsOpen && (
              <div 
                id="grid-settings-popup"
                className="absolute right-0 mt-2 w-64 bg-[#14161c] border border-[#2d3039] rounded-lg p-3.5 shadow-2xl z-50 text-left space-y-3"
                style={{ top: '100%' }}
              >
                <div className="flex items-center justify-between border-b border-[#2d3039] pb-2 mb-1">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1">
                    <Grid className="w-3.5 h-3.5 text-blue-400" />
                    <span>背景細部網格設定</span>
                  </span>
                  <button 
                    onClick={() => setIsGridSettingsOpen(false)}
                    className="text-slate-500 hover:text-slate-300 text-xs cursor-pointer"
                  >
                    ✕
                  </button>
                </div>

                {/* Show/Hide switch */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">啟用背景網格</span>
                  <button
                    id="toggle-grid-vis-btn"
                    onClick={() => setShowGrid(!showGrid)}
                    className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                      showGrid ? 'bg-blue-600' : 'bg-[#1f2229] border border-[#2d3039]'
                    }`}
                  >
                    <div className={`bg-white w-4 h-4 rounded-full transition-transform ${
                      showGrid ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>

                {showGrid && (
                  <>
                    {/* Minor Grid Input */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">細網格間距 (Minor)</span>
                        <span className="text-blue-400 font-bold font-mono">
                          {minorGridInterval === 0 ? "無" : `${minorGridInterval} m`}
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {[0, 0.2, 0.5, 1, 2].map((val) => (
                          <button
                            key={val}
                            onClick={() => {
                              setMinorGridInterval(val);
                              if (val > 0 && val >= majorGridInterval) {
                                setMajorGridInterval(val * 5);
                              }
                            }}
                            className={`py-1 text-[10px] rounded border font-mono transition-colors cursor-pointer ${
                              minorGridInterval === val
                                ? 'bg-blue-600 text-white border-blue-500'
                                : 'bg-[#1f2229] hover:bg-slate-800 border-[#2d3039] text-slate-400'
                            }`}
                          >
                            {val === 0 ? "無" : `${val}m`}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Major Grid Input */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-400">粗網格間距 (Major)</span>
                        <span className="text-blue-400 font-bold font-mono">
                          {majorGridInterval === 0 ? "無" : `${majorGridInterval} m`}
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {[0, 2, 5, 10, 20].map((val) => (
                          <button
                            key={val}
                            onClick={() => {
                              setMajorGridInterval(val);
                            }}
                            disabled={val !== 0 && minorGridInterval !== 0 && val <= minorGridInterval}
                            className={`py-1 text-[10px] rounded border font-mono transition-colors cursor-pointer disabled:opacity-25 disabled:cursor-not-allowed ${
                              majorGridInterval === val
                                ? 'bg-blue-600 text-white border-blue-500'
                                : 'bg-[#1f2229] hover:bg-slate-800 border-[#2d3039] text-slate-400'
                            }`}
                          >
                            {val === 0 ? "無" : `${val}m`}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
  );
  const snapPopoverEl = (
          <div className="relative">
            <button
              id="snap-settings-toggle-btn"
              onClick={() => {
                setIsSnapSettingsOpen(!isSnapSettingsOpen);
                setIsGridSettingsOpen(false);
              }}
              className={`flex items-center gap-1.5 h-8 px-3 text-xs rounded transition-all cursor-pointer font-medium ${
                isSnapSettingsOpen || (snapToGrid || snapToEndpoint || snapToMidpoint || snapToNearest || snapToIntersection)
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40 shadow-[0_0_8px_rgba(0,255,255,0.15)] bg-[#1e222b]'
                  : 'bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 text-slate-300'
              }`}
              title="鎖點設定 (Snap Settings)"
            >
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden xl:inline">SNAP 鎖點設定</span>
            </button>

            {isSnapSettingsOpen && (
              <>
                {/* Click outside backdrop overlay */}
                <div 
                  className="fixed inset-0 z-40 cursor-default" 
                  onClick={() => setIsSnapSettingsOpen(false)} 
                />
                <div 
                  id="snap-checkboxes-header-popup"
                  className="absolute right-0 mt-2 w-48 bg-[#14161c] border border-[#2d3039] rounded-lg p-3.5 shadow-2xl z-50 text-left space-y-2.5 text-xs select-none"
                  style={{ top: '100%' }}
                >
                  <div className="flex items-center justify-between border-b border-[#2d3039] pb-2 mb-1">
                    <span className="text-xs font-bold text-slate-200 flex items-center gap-1">
                      <Compass className="w-3.5 h-3.5 text-cyan-400" />
                      <span>鎖點功能 (Snap)</span>
                    </span>
                    <button 
                      onClick={() => setIsSnapSettingsOpen(false)}
                      className="text-slate-500 hover:text-slate-300 text-xs cursor-pointer"
                    >
                      ✕
                    </button>
                  </div>
                  <button 
                    onClick={() => setSnapToGrid(!snapToGrid)} 
                    className="flex items-center justify-between w-full hover:bg-[#1f2229] p-1.5 rounded-md transition-colors text-slate-300 hover:text-white text-left cursor-pointer"
                  >
                    <span>網格鎖點 (Grid)</span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${snapToGrid ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>
                      {snapToGrid ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button 
                    onClick={() => setSnapToEndpoint(!snapToEndpoint)} 
                    className="flex items-center justify-between w-full hover:bg-[#1f2229] p-1.5 rounded-md transition-colors text-slate-300 hover:text-white text-left cursor-pointer"
                  >
                    <span>端點鎖點 (Endpoint)</span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${snapToEndpoint ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>
                      {snapToEndpoint ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button 
                    onClick={() => setSnapToMidpoint(!snapToMidpoint)} 
                    className="flex items-center justify-between w-full hover:bg-[#1f2229] p-1.5 rounded-md transition-colors text-slate-300 hover:text-white text-left cursor-pointer"
                  >
                    <span>中點鎖點 (Midpoint)</span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${snapToMidpoint ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>
                      {snapToMidpoint ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button 
                    onClick={() => setSnapToNearest(!snapToNearest)} 
                    className="flex items-center justify-between w-full hover:bg-[#1f2229] p-1.5 rounded-md transition-colors text-slate-300 hover:text-white text-left cursor-pointer"
                  >
                    <span>最近鎖點 (Nearest)</span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${snapToNearest ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>
                      {snapToNearest ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  <button 
                    onClick={() => setSnapToIntersection(!snapToIntersection)} 
                    className="flex items-center justify-between w-full hover:bg-[#1f2229] p-1.5 rounded-md transition-colors text-slate-300 hover:text-white text-left cursor-pointer"
                  >
                    <span>交點鎖點 (Intersection)</span>
                    <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded ${snapToIntersection ? 'bg-cyan-500/20 text-cyan-400' : 'bg-slate-800 text-slate-500'}`}>
                      {snapToIntersection ? 'ON' : 'OFF'}
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>
  );
  const bgManagerEl = (
!bgImage ? (
            <div className="relative flex items-center h-8 rounded bg-[#1f2229] border border-dashed border-blue-500/35 hover:border-blue-500 hover:bg-slate-800 transition-all text-xs font-medium text-blue-450 cursor-pointer overflow-hidden px-3">
              <input 
                id="bg-image-uploader"
                type="file" 
                accept="image/*" 
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
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
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" 
              />
              <Upload className="w-3.5 h-3.5 mr-1.5 text-blue-400" />
              <span className="hidden xl:inline">上傳底圖</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-[#0f1115] border border-[#2d3039] rounded px-2.5 h-8 text-xs select-none">
              <div className="flex items-center gap-1 max-w-[150px] shrink-0">
                <span className="text-[10px] text-zinc-400 font-bold truncate" title={bgImage.fileName || "底圖已載入"}>
                  📁 {bgImage.fileName || "底圖"}
                </span>
                <span className="text-[9px] text-zinc-500 whitespace-nowrap hidden sm:inline">
                  ({bgImage.widthMeters.toFixed(1)}m × {bgImage.heightMeters.toFixed(1)}m)
                </span>
              </div>

              <div className="h-4 w-px bg-zinc-800" />

              {/* Opacity control */}
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-zinc-500 whitespace-nowrap">不透明度</span>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  value={bgImage.opacity || 0.6}
                  onChange={(e) => {
                    const nextVal = parseFloat(e.target.value);
                    setBgImage((prev: any) => prev ? { ...prev, opacity: nextVal } : null);
                  }}
                  className="w-12 h-1 accent-blue-500 bg-zinc-800 rounded appearance-none cursor-pointer"
                />
                <span className="text-[9px] font-mono text-zinc-400 w-6 text-right">{Math.round((bgImage.opacity || 0.6) * 100)}%</span>
              </div>

              <div className="h-4 w-px bg-zinc-800" />

              {/* Calibration Controls */}
              {activeTool === 'map_scale' ? (
                <button
                  onClick={() => {
                    setActiveTool('select');
                  }}
                  className="flex items-center gap-1 px-2 h-5 text-[10px] bg-red-950 hover:bg-red-900 border border-red-500/25 rounded text-red-200 font-medium transition-colors cursor-pointer"
                  title="取消比例尺校正"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse inline-block animate-pulse" />
                  <span>取消校正</span>
                </button>
              ) : (
                <button
                  onClick={() => setActiveTool('map_scale')}
                  className={`flex items-center gap-1 px-2 h-5 text-[10px] rounded border font-medium transition-colors cursor-pointer ${
                    bgImage.isCalibrated
                      ? 'bg-emerald-950/20 hover:bg-emerald-950/40 border-emerald-500/20 text-emerald-400'
                      : 'bg-amber-950/20 hover:bg-amber-950/40 border-amber-500/20 text-amber-400'
                  }`}
                  title="開始拖曳劃出已知長度（如比例尺條或兩點距離）進行校正"
                >
                  <Ruler className="w-3 h-3 text-amber-505" />
                  <span>{bgImage.isCalibrated ? '重新校正' : '校正比例尺'}</span>
                </button>
              )}

              {/* Remove Button */}
              <button
                onClick={() => {
                  setBgImage(null);
                  if (activeTool === 'map_scale') setActiveTool('select');
                }}
                className="p-1 text-zinc-500 hover:text-red-400 hover:bg-red-950/30 rounded transition-colors cursor-pointer ml-1"
                title="清除藍圖底圖"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )
  );
  const classicToolbarEl = (
          <>
            <Toolbar 
              activeTool={activeTool} 
              setActiveTool={setActiveTool} 
              onLoadDemo={handleLoadDemo}
              designVehicle={designVehicle}
              setDesignVehicle={setDesignVehicle}
              snapToGrid={snapToGrid}
              setSnapToGrid={setSnapToGrid}
              snapToEndpoint={snapToEndpoint}
              setSnapToEndpoint={setSnapToEndpoint}
              snapToMidpoint={snapToMidpoint}
              setSnapToMidpoint={setSnapToMidpoint}
              snapToNearest={snapToNearest}
              setSnapToNearest={setSnapToNearest}
              roadArrowConfig={roadArrowConfig}
              setRoadArrowConfig={setRoadArrowConfig}
            />
            {/* Floating style selector for road_arrow - Rendered outside Toolbar to prevent boundary clipping */}
            {activeTool === 'road_arrow' && (
              <div className="flex flex-col gap-1.5 p-2.5 bg-[#1f2229] border border-[#2d3039] rounded-lg w-[115px] absolute left-[153px] top-[290px] z-50 shadow-2xl shadow-black/80 animate-fade-in">
                <span className="text-[10px] font-bold text-cyan-400 border-b border-[#2d3039]/50 pb-1 text-center">箭頭樣式</span>
                <div className="flex flex-col gap-1.5 w-full mt-1.5">
                  {[
                    { type: 'straight', name: '直行' },
                    { type: 'left', name: '左轉' },
                    { type: 'right', name: '右轉' },
                    { type: 'straight_left', name: '直左' },
                    { type: 'straight_right', name: '直右' }
                  ].map(item => (
                    <button 
                      key={item.type}
                      onClick={() => { 
                        setRoadArrowConfig({
                          ...roadArrowConfig,
                          arrowType: item.type
                        }); 
                      }} 
                      className={`px-2 py-1 rounded text-[11px] font-bold cursor-pointer text-left transition-all ${
                        roadArrowConfig.arrowType === item.type 
                          ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white shadow-md shadow-blue-500/20' 
                          : 'text-slate-300 hover:bg-[#252830] hover:text-white'
                      }`} 
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
  );
  // 軌跡模擬左側工具（依介面風格與 CAD 工具列一致）
  const simLeftPanelEl = uiStyle === 'minimal' ? <MinimalSimRail /> : <GuidedSimSidebar />;
  const canvasAreaEl = (
        <div className="flex-1 h-full min-w-0 relative flex flex-col">
          <CadCanvas 
            onContextAction={handleContextAction}
            canPaste={canPaste}
            insets={canvasInsets}
            canvasBackground={uiStyle === 'polished' ? '#0c1222' : uiStyle === 'minimal' ? '#0f1012' : '#101216'}
            fitRequest={fitRequest}
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
          {appMode === 'simulation' && <SimHud bottom={canvasInsets.bottom} polished={uiStyle === 'polished'} />}
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
                onGenerateIslandFromCurve={handleGenerateIslandFromCurve}
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

                    const limit = designVehicle === 'passenger' ? 4.5 : 12.5;
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
  const simRightPanelEl = <SimPanel polished={uiStyle === 'polished'} projectName={projectName} />;

  const sharedOverlaysEl = (
    <>
      <ConfirmDialog dialog={confirmDialog} onClose={() => setConfirmDialog(null)} />
      {appMode === 'simulation' && showSimTour && <SimTour onClose={() => setShowSimTour(false)} />}
      <AutosaveBanner offer={autosaveOffer} onRestore={handleRestoreAutosave} onDiscard={handleDiscardAutosave} />

      {exportedImage && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center p-4 z-[150] backdrop-blur-sm">
          <div className="bg-[#14161c] border border-zinc-800 rounded-2xl p-5 max-w-4xl w-full flex flex-col gap-4 shadow-2xl">
            <div className="flex justify-between items-center pb-2 border-b border-zinc-800">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <span>📸 匯出道路標線幾何工程圖</span>
                <span className="text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-normal">高解析藍圖</span>
              </h3>
              <button 
                onClick={() => setExportedImage(null)}
                className="text-zinc-400 hover:text-white text-xs font-bold font-mono p-1 px-2.5 bg-zinc-850 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              >
                ✕ 關閉
              </button>
            </div>

            <div className="text-xs text-zinc-400 space-y-1">
              <p className="flex items-center gap-1.5 font-bold text-zinc-300">
                <span className="text-emerald-400">✓</span> 已嘗試為您自動下載工程圖。
              </p>
              <p className="pl-5 text-zinc-400">
                如果您的瀏覽器阻擋了彈出式下載，請直接對下方預覽圖<span className="text-amber-400 font-bold underline">按右鍵點選「另存圖片」</span>或在行動裝置上長按圖片直接儲存！
              </p>
            </div>

            <div className="flex-1 overflow-auto max-h-[55vh] border border-zinc-850 rounded-xl bg-zinc-950 p-3 flex items-center justify-center">
              <img 
                src={exportedImage} 
                alt="WebTrafficCAD High Resolution Export" 
                className="max-h-full max-w-full object-contain rounded shadow-lg border border-zinc-900" 
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-zinc-850">
              <a
                href={exportedImage}
                download={`TrafficCAD_Blueprint_${new Date().toISOString().slice(0, 10)}.png`}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl transition-all shadow-lg flex items-center gap-1.5 cursor-pointer"
              >
                💾 下載圖片
              </a>
              <button
                onClick={() => setExportedImage(null)}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-750 text-zinc-300 hover:text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                確認關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Elegant Toast notification */}
      {toast && (
        <div id="app-toast" className={`fixed ${uiStyle === 'classic' && appMode !== 'simulation' ? 'bottom-6' : 'top-16'} left-1/2 -translate-x-1/2 z-[250] max-w-sm w-full bg-[#14161c] border border-zinc-800 text-zinc-100 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-slide-up duration-350`}>
          <span className="text-base flex-shrink-0">
            {toast.type === 'success' ? '🎯' : toast.type === 'error' ? '⚠️' : 'ℹ️'}
          </span>
          <p className="text-xs font-semibold leading-relaxed flex-1">{toast.message}</p>
          <button 
            onClick={() => setToast(null)} 
            className="text-zinc-500 hover:text-zinc-300 text-xs font-bold px-1.5 py-0.5 rounded hover:bg-zinc-850 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );

  // ====================================================================
  // 新版介面（A 簡潔／B 直覺／C 美觀）：共用相同狀態與功能，只改變版面與外觀
  // ====================================================================
  const renderModernLayout = () => {
    const v = uiStyle as 'minimal' | 'guided' | 'polished';
    const isPolished = v === 'polished';
    const isGuided = v === 'guided';

    const iconBtn = (id: string, title: string, icon: React.ReactNode, onClick: () => void, disabled = false, label?: string) => (
      <button
        id={id}
        title={title}
        onClick={onClick}
        disabled={disabled}
        className={`flex items-center gap-1.5 h-8 ${label ? 'px-2.5' : 'w-8 justify-center'} rounded-lg text-xs cursor-pointer transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/10`}
        style={{ color: 'var(--ui-text)' }}
      >
        {icon}
        {label && <span className="whitespace-nowrap hidden xl:inline">{label}</span>}
      </button>
    );

    const menuBtn = (key: 'file' | 'export' | 'view', label: string, icon: React.ReactNode, id: string) => (
      <button
        id={id}
        data-menu-root
        onClick={() => setModernMenu(modernMenu === key ? null : key)}
        className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-xs cursor-pointer transition-colors hover:bg-white/10"
        style={modernMenu === key ? { background: 'var(--ui-accent-soft)', color: 'var(--ui-accent)' } : { color: 'var(--ui-text)' }}
      >
        {icon}
        <span className="whitespace-nowrap hidden lg:inline">{label}</span>
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
    );

    const popover = (key: 'file' | 'export' | 'view', content: React.ReactNode, width = 'w-80') => modernMenu === key && (
      <>
        <div
          data-menu-root
          id={`menu-${key}`}
          className={`absolute right-0 top-full mt-2 ${width} max-h-[75vh] overflow-y-auto p-3 z-50 shadow-2xl ${isPolished ? 'glass' : ''}`}
          style={isPolished ? { borderRadius: 16 } : { background: 'var(--ui-surface)', border: '1px solid var(--ui-border)', borderRadius: 12 }}
        >
          {content}
        </div>
      </>
    );

    const fileMenu = (
      <div className="space-y-1 text-xs" style={{ color: 'var(--ui-text)' }}>
        {[
          { id: 'save-project-btn', label: '儲存專案（JSON）', icon: <Save className="w-4 h-4" />, onClick: handleSaveProject },
          { id: 'load-project-btn', label: '開啟專案…', icon: <FolderOpen className="w-4 h-4" />, onClick: () => fileInputRef.current?.click() },
          { id: 'menu-template-btn', label: '載入十字路口範本', icon: <MapPin className="w-4 h-4" />, onClick: handleLoadDemo },
          { id: 'menu-clear-btn', label: appMode === 'cad' ? '清空畫布…' : '清除所有軌跡', icon: <Trash2 className="w-4 h-4 text-red-400" />, onClick: () => (appMode === 'cad' ? handleClearCanvas() : simStore.clearAll()) },
        ].map(item => (
          <button key={item.id} id={item.id} onClick={() => { item.onClick(); setModernMenu(null); }} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer hover:bg-white/10 text-left">
            {item.icon}<span>{item.label}</span>
          </button>
        ))}
        <p className="text-[10.5px] px-2.5 pt-2" style={{ color: 'var(--ui-muted)', borderTop: '1px solid var(--ui-border)' }}>
          {isDirty ? '有尚未存檔的變更；內容已自動暫存在此瀏覽器。' : '所有變更都已儲存。'}
        </p>
      </div>
    );

    const modeSwitch = (
      <div className={`flex items-center p-0.5 ${isPolished ? 'rounded-full' : 'rounded-lg'}`} style={{ background: isPolished ? 'rgba(255,255,255,0.06)' : 'var(--ui-surface2)', border: '1px solid var(--ui-border)' }}>
        {([['cad', 'CAD 繪圖'], ['simulation', '軌跡模擬']] as const).map(([m, label]) => {
          const active = appMode === m;
          return (
            <button
              key={m}
              id={`mode-${m}`}
              onClick={() => handleModeChange(m)}
              className={`px-3.5 py-1 text-xs font-bold whitespace-nowrap cursor-pointer transition-all ${isPolished ? 'rounded-full' : 'rounded-md'} ${active && isPolished ? 'accent-gradient' : ''}`}
              style={active ? (isPolished ? {} : { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)' }) : { color: 'var(--ui-muted)' }}
            >
              {label}
            </button>
          );
        })}
      </div>
    );

    const history = (
      <>
        {iconBtn('undo-btn', '復原（Ctrl+Z）', <RotateCcw className="w-4 h-4" />, appMode === 'cad' ? handleUndo : () => simStore.undo(), appMode === 'cad' ? historyStack.length === 0 : !sim.canUndo(), isGuided ? '復原' : undefined)}
        {iconBtn('redo-btn', '重做（Ctrl+Y）', <RotateCw className="w-4 h-4" />, appMode === 'cad' ? handleRedo : () => simStore.redo(), appMode === 'cad' ? redoStack.length === 0 : !sim.canRedo(), isGuided ? '重做' : undefined)}
      </>
    );

    const dirtyBadge = (
      <span className="text-[10.5px] hidden lg:flex items-center gap-1 whitespace-nowrap" style={{ color: 'var(--ui-muted)' }} title={isDirty ? '已自動暫存於瀏覽器，建議另存專案檔' : '已儲存'}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: isDirty ? '#f59e0b' : '#22c55e' }} />
        {isDirty ? '已自動暫存' : '已儲存'}
      </span>
    );

    const projectNameInput = (
      <input
        id="project-name-header"
        value={projectName}
        onChange={e => setProjectName(e.target.value)}
        className="hidden md:block bg-transparent text-xs font-medium outline-none px-1.5 py-1 rounded-md hover:bg-white/5 focus:bg-white/5 w-32 xl:w-40 truncate"
        style={{ color: 'var(--ui-text)' }}
        title="圖名（會用於匯出檔名與圖框）"
      />
    );

    const viewPanel = (
      <div className="space-y-4">
        <SettingsPanel v={viewSettings} />
        {v === 'minimal' && appMode === 'cad' && (
          <div style={{ borderTop: '1px solid var(--ui-border)' }} className="pt-3">
            <LayerPanel elements={elements} hidden={hiddenLayers} onToggle={toggleLayer} onShowAll={() => setHiddenLayers([])} />
          </div>
        )}
      </div>
    );

    const rightTabs = (
      <div className="flex gap-1 p-1 m-3 mb-0 rounded-lg" style={{ background: 'var(--ui-surface2)' }}>
        {([['props', '屬性'], ['layers', '圖層'], ['qty', '數量']] as const).map(([k, label]) => (
          <button key={k} id={`right-tab-${k}`} onClick={() => setRightTab(k)} className={`flex-1 py-1.5 text-xs cursor-pointer transition-all ${isPolished ? 'rounded-lg' : 'rounded-md'} ${rightTab === k && isPolished ? 'accent-gradient' : ''}`}
            style={rightTab === k ? (isPolished ? {} : { background: 'var(--ui-accent)', color: 'var(--ui-accent-text)', fontWeight: 700 }) : { color: 'var(--ui-muted)' }}>
            {label}
          </button>
        ))}
      </div>
    );

    const rightBody = appMode === 'cad'
      ? (rightTab === 'props'
          ? (hasSelection || hasToolConfig
              ? propsPanelEl
              : <div className="p-6 text-center text-xs" style={{ color: 'var(--ui-muted)' }}>
                  <div className="text-3xl mb-2">⌖</div>
                  點選圖面上的標線即可在這裡調整尺寸、座標與規格。
                  <div className="mt-3 text-[11px] leading-relaxed">小技巧：框選可多選；Delete 刪除；Shift 拖曳鎖定方向；Esc 結束繪製。</div>
                </div>)
          : rightTab === 'layers'
            ? <div className="p-3"><LayerPanel elements={elements} hidden={hiddenLayers} onToggle={toggleLayer} onShowAll={() => setHiddenLayers([])} /></div>
            : <div className="p-3"><QuantityPanel elements={visibleElements} onExport={handleExportQuantities} /></div>)
      : simRightPanelEl;

    const fileInput = <input type="file" ref={fileInputRef} accept=".json" onChange={handleLoadProject} style={{ display: 'none' }} />;
    const arrowBar = appMode === 'cad' && activeTool === 'road_arrow' && (
      <ArrowTypeBar value={roadArrowConfig.arrowType} onChange={(t) => setRoadArrowConfig({ ...roadArrowConfig, arrowType: t as any })} style={{ top: isPolished ? 76 : 12 }} />
    );

    // ---------------- C・美觀：滿版畫布＋浮動玻璃面板 ----------------
    if (isPolished) {
      return (
        <div id="webtrafficcad-app-root" className="ui-polished relative h-screen w-screen overflow-hidden font-sans" style={{ background: 'radial-gradient(1200px 600px at 20% -10%, #1e1b4b 0%, transparent 60%), radial-gradient(900px 500px at 110% 110%, #083344 0%, transparent 55%), #0b1020', color: 'var(--ui-text)' }}>
          {fileInput}
          <div className="absolute inset-0 flex">{canvasAreaEl}</div>
          {arrowBar}

          {/* 頂部浮動列 */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 glass rounded-full pl-4 pr-1.5 py-1.5 flex items-center gap-2 max-w-[calc(100vw-24px)]">
            <span className="w-2.5 h-2.5 rounded-full accent-gradient shrink-0" />
            <span className="text-[13px] font-bold tracking-wide whitespace-nowrap">WebTrafficCAD</span>
            <span className="w-px h-5" style={{ background: 'var(--ui-border)' }} />
            {projectNameInput}
            {dirtyBadge}
            <span className="w-px h-5" style={{ background: 'var(--ui-border)' }} />
            {modeSwitch}
            <span className="w-px h-5" style={{ background: 'var(--ui-border)' }} />
            {history}
            <div className="relative">{menuBtn('file', '檔案', <FolderOpen className="w-4 h-4" />, 'menu-file-btn')}{popover('file', fileMenu, 'w-64')}</div>
            <div className="relative">{menuBtn('view', '檢視', <Grid className="w-4 h-4" />, 'menu-view-btn')}{popover('view', viewPanel)}</div>
            <div className="relative">
              <button id="export-dropdown-toggle-btn" data-menu-root onClick={() => setModernMenu(modernMenu === 'export' ? null : 'export')} className="flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-bold whitespace-nowrap cursor-pointer accent-gradient shadow-lg">
                <Download className="w-4 h-4" /> 匯出
              </button>
              {popover('export', exportPanelEl)}
            </div>
            <StylePicker value={uiStyle} onChange={setUiStyle} compact buttonClassName="w-8 h-8 rounded-full flex items-center justify-center cursor-pointer hover:bg-white/10" />
          </div>

          {/* 模擬模式左側面板 */}
          {appMode === 'simulation' && <PolishedSimDock />}

          {/* 右側浮動屬性卡 */}
          {polishedPanelVisible ? (
            <div id="right-property-panel" className="absolute right-3 top-20 bottom-28 w-[336px] z-30 glass rounded-2xl flex flex-col overflow-hidden">
              <div className="flex items-center">
                <div className="flex-1">{appMode === 'cad' && rightTabs}</div>
                <button onClick={() => setIsRightPanelOpen(false)} className="mr-3 mt-3 p-1 rounded-md hover:bg-white/10 cursor-pointer" title="收合"><ChevronRight className="w-4 h-4" /></button>
              </div>
              <div className="flex-1 overflow-y-auto">{rightBody}</div>
            </div>
          ) : appMode === 'cad' && (
            <div className="absolute right-3 top-20 z-30 flex flex-col gap-2">
              <button id="open-layers-btn" onClick={() => { setIsRightPanelOpen(true); setRightTab('layers'); }} className="glass rounded-xl w-10 h-10 flex items-center justify-center cursor-pointer" title="圖層"><Layers className="w-4 h-4" /></button>
              <button id="open-qty-btn" onClick={() => { setIsRightPanelOpen(true); setRightTab('qty'); }} className="glass rounded-xl w-10 h-10 flex items-center justify-center cursor-pointer" title="數量"><Ruler className="w-4 h-4" /></button>
            </div>
          )}

          {/* 底部工具 Dock */}
          {appMode === 'cad' && <PolishedDock activeTool={activeTool} setActiveTool={(t) => { setActiveTool(t); if (t !== 'select') setIsRightPanelOpen(true); }} onLoadTemplate={handleLoadDemo} />}

          {sharedOverlaysEl}
        </div>
      );
    }

    // ---------------- A・簡潔 / B・直覺：上方列＋左工具＋右面板 ----------------
    return (
      <div id="webtrafficcad-app-root" className={`ui-${v} flex flex-col h-screen w-screen overflow-hidden font-sans`} style={{ background: 'var(--ui-bg)', color: 'var(--ui-text)' }}>
        {fileInput}
        <header className={`flex items-center gap-2 px-3 shrink-0 z-20 ${isGuided ? 'h-12' : 'h-11'}`} style={{ background: 'var(--ui-surface)', borderBottom: '1px solid var(--ui-border)' }}>
          <span className="text-[13px] font-bold tracking-wide whitespace-nowrap" style={{ color: 'var(--ui-accent)' }}>{isGuided ? 'WebTrafficCAD' : 'WTC'}</span>
          {projectNameInput}
          {dirtyBadge}
          <div className="flex-1" />
          {modeSwitch}
          <div className="flex-1" />
          {history}
          <span className="w-px h-5 mx-1" style={{ background: 'var(--ui-border)' }} />
          {isGuided ? (
            <>
              {iconBtn('save-project-btn', '儲存專案（JSON）', <Save className="w-4 h-4" />, handleSaveProject, false, '儲存')}
              {iconBtn('load-project-btn', '開啟專案（JSON）', <FolderOpen className="w-4 h-4" />, () => fileInputRef.current?.click(), false, '開啟')}
              {iconBtn('clear-btn', appMode === 'cad' ? '清空畫布' : '清除所有軌跡', <Trash2 className="w-4 h-4 text-red-400" />, () => (appMode === 'cad' ? handleClearCanvas() : simStore.clearAll()), appMode === 'cad' ? elements.length === 0 : (sim.doc.paths.length === 0 && !sim.draft), '清空')}
            </>
          ) : (
            <div className="relative">{menuBtn('file', '檔案', <FolderOpen className="w-4 h-4" />, 'menu-file-btn')}{popover('file', fileMenu, 'w-64')}</div>
          )}
          <div className="relative">{menuBtn('view', isGuided ? '鎖點與底圖' : '檢視', <Grid className="w-4 h-4" />, 'menu-view-btn')}{popover('view', viewPanel)}</div>
          <div className="relative">
            <button id="export-dropdown-toggle-btn" data-menu-root onClick={() => setModernMenu(modernMenu === 'export' ? null : 'export')} className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold whitespace-nowrap cursor-pointer" style={{ background: 'var(--ui-accent)', color: 'var(--ui-accent-text)' }}>
              <Download className="w-4 h-4" /> 匯出
            </button>
            {popover('export', exportPanelEl)}
          </div>
          <StylePicker value={uiStyle} onChange={setUiStyle} compact={!isGuided} buttonClassName="flex items-center gap-1.5 h-8 px-2 rounded-lg text-xs cursor-pointer hover:bg-white/10" />
        </header>

        <div className="flex flex-1 min-h-0 relative">
          {appMode === 'cad'
            ? (isGuided
                ? <GuidedToolSidebar activeTool={activeTool} setActiveTool={setActiveTool} onLoadTemplate={handleLoadDemo} />
                : <MinimalToolRail activeTool={activeTool} setActiveTool={setActiveTool} onLoadTemplate={handleLoadDemo} />)
            : simLeftPanelEl}

          <div className="flex-1 min-w-0 h-full relative flex">
            {canvasAreaEl}
            {arrowBar}
          </div>

          {(isGuided || minimalPanelVisible) && (
            <div id="right-property-panel" className={`${isGuided ? 'w-80' : 'w-72'} h-full shrink-0 flex flex-col`} style={{ background: 'var(--ui-surface)', borderLeft: '1px solid var(--ui-border)' }}>
              {appMode === 'cad' && (isGuided ? rightTabs : (
                <div className="flex items-center justify-between px-3 pt-2">
                  <span className="text-[11px] font-bold" style={{ color: 'var(--ui-muted)' }}>{rightTab === 'props' ? '屬性' : rightTab === 'layers' ? '圖層' : '數量'}</span>
                  <button onClick={() => { setSelectedElement(null); setSelectedElementIds([]); setRightTab('props'); if (hasToolConfig) setActiveTool('select'); }} className="p-1 rounded hover:bg-white/10 cursor-pointer" title="關閉"><X className="w-3.5 h-3.5" /></button>
                </div>
              ))}
              <div className="flex-1 overflow-y-auto">{rightBody}</div>
            </div>
          )}
        </div>

        {/* 簡潔風格：底部細狀態列（圖層、數量捷徑） */}
        {v === 'minimal' && appMode === 'cad' && (
          <footer className="h-7 shrink-0 flex items-center gap-4 px-3 text-[11px]" style={{ background: 'var(--ui-surface)', borderTop: '1px solid var(--ui-border)', color: 'var(--ui-muted)' }}>
            <span>{elements.length} 個物件{hiddenLayers.length > 0 ? `（${hiddenLayers.length} 個圖層隱藏）` : ''}</span>
            <button id="footer-layers-btn" onClick={() => setRightTab(rightTab === 'layers' ? 'props' : 'layers')} className="cursor-pointer hover:underline">圖層</button>
            <button id="footer-qty-btn" onClick={() => setRightTab(rightTab === 'qty' ? 'props' : 'qty')} className="cursor-pointer hover:underline">數量</button>
          </footer>
        )}

        {sharedOverlaysEl}
      </div>
    );
  };

  if (uiStyle !== 'classic') {
    return renderModernLayout();
  }

  return (
    <div id="webtrafficcad-app-root" className="ui-classic flex flex-col h-screen w-screen bg-[#0a0b0e] text-slate-300 overflow-hidden font-sans">
      {/* CAD App Elegant Top Header */}
      <header className="flex items-center justify-between px-4 xl:px-6 py-3 bg-[#14161c] border-b border-[#2d3039] shrink-0 select-none h-12 z-20">
        <div className="flex items-center gap-6 shrink-0">
          <div>
            <h1 className="text-sm font-black tracking-wider uppercase bg-gradient-to-r from-blue-500 to-indigo-300 bg-clip-text text-transparent">
              WebTrafficCAD
            </h1>
          </div>

          {/* App Mode Switcher (左右合體按鈕) */}
          {modeSwitchEl}
        </div>

        {/* Global Control Group: Undo, Redo, Exports, and Background Image Management */}
        {/* 視窗較窄時隱藏按鈕文字（保留圖示與提示），避免與左側模式切換重疊 */}
        <div className="flex items-center gap-3 shrink-0 pl-4">
          {historyBtnsEl}
          <div className="h-4 w-px bg-[#2d3039]" />
          {fileBtnsEl}
          <div className="h-4 w-px bg-[#2d3039]" />
          {classicExportEl}
          <div className="h-4 w-px bg-[#2d3039]" />
          {gridPopoverEl}
          {snapPopoverEl}
          <div className="h-4 w-px bg-[#2d3039]" />
          {bgManagerEl}

          <div className="h-4 w-px bg-[#2d3039]" />
          <StylePicker value={uiStyle} onChange={setUiStyle} />

        </div>
      </header>

      {/* Main CAD Interactive Workspace Grid */}
      <div className="flex flex-1 min-h-0 w-full relative">
        {/* Left Sidebar (CAD Toolbar / Simulation control) */}
        {appMode === 'cad' ? classicToolbarEl : simLeftPanelEl}

        {/* Central CAD Infinite Canvas */}
        {canvasAreaEl}

        {/* Collapsible Wrapper for Right Details Panel */}
        <div 
          id="props-collapsible-wrapper"
          className={`relative h-full flex shrink-0 transition-all duration-300 ease-in-out select-none bg-[#14161c] ${
            isPropsCollapsed ? 'w-0' : 'w-80 border-l border-[#2d3039]'
          }`}
        >
          {/* Smooth overlay vertical collapse button */}
          <button
            id="toggle-props-panel-btn"
            onClick={() => setIsPropsCollapsed(!isPropsCollapsed)}
            className="absolute top-1/2 -left-3.5 -translate-y-1/2 z-35 flex items-center justify-center w-3.5 h-12 bg-[#1f2229] hover:bg-slate-800 border border-[#2d3039] hover:text-white rounded-l-md cursor-pointer transition-all text-slate-400 font-bold"
            title={isPropsCollapsed ? '展開右側屬性控制台' : '隱藏右側屬性控制台'}
          >
            {isPropsCollapsed ? (
              <ChevronLeft className="w-3 h-3 text-slate-400 hover:text-white" />
            ) : (
              <ChevronRight className="w-3 h-3 text-slate-400 hover:text-white" />
            )}
          </button>

          <div className="w-80 h-full overflow-y-auto">
            {appMode === 'cad' ? propsPanelEl : simRightPanelEl}
          </div>
        </div>
      </div>
      {sharedOverlaysEl}
    </div>
  );
}
