import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { CadElement, CadTool, IslandElement, TextElement, Waypoint, VehicleConfig, CornerPoints, SimulationState, ControllerMode, Point, PathPoint } from './types';
import { 
  calculateWidening, 
  generateChannelizingIsland, 
  exportToDXF, 
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
import {
  smoothPoints,
  chaikinSmooth,
  cubicBezierSpline,
  filletPath,
  interpolatePath,
  findClosestPointIndex,
  distance as simDistance,
  calculateIntersectionCurve
} from './utils/pathInterpolator';
import {
  simulateVehicle,
  calculateCorners,
  calculateTrailerCorners,
  normalizeAngle
} from './utils/vehicleSimulator';
import Toolbar from './components/Toolbar';
import PropsPanel from './components/PropsPanel';
import CadCanvas from './components/CadCanvas';
import { Compass, Info, CheckCircle2, RotateCcw, RotateCw, Image as ImageIcon, Download, Upload, Trash2, Ruler, X, Grid, ChevronLeft, ChevronRight, Play, Pause, Sliders, Layers, Truck, Lock, Unlock, GitBranch, MapPin, Save, FolderOpen, ChevronDown, PenTool, Paintbrush } from 'lucide-react';

const normalizeColor = (c: string): string => {
  if (!c) return '#6366f1';
  if (c.startsWith('#')) return c;
  const mapping: Record<string, string> = {
    indigo: '#6366f1',
    emerald: '#10b981',
    amber: '#f59e0b',
    rose: '#f43f5e',
    sky: '#0ea5e9'
  };
  return mapping[c] || '#6366f1';
};

const getDarkerColor = (hex: string): string => {
  const normalized = normalizeColor(hex);
  let r = parseInt(normalized.slice(1, 3), 16);
  let g = parseInt(normalized.slice(3, 5), 16);
  let b = parseInt(normalized.slice(5, 7), 16);
  r = Math.round(r * 0.7);
  g = Math.round(g * 0.7);
  b = Math.round(b * 0.7);
  return `rgb(${r}, ${g}, ${b})`;
};

export default function App() {
  // App Mode State: 'cad' | 'simulation' (預設為 'cad')
  const [appMode, setAppMode] = useState<'cad' | 'simulation'>('cad');

  // --- 車流軌跡模擬狀態 (Bicycle Simulator States) ---
  const [simConfig, setSimConfig] = useState<VehicleConfig>({
    L: 2.7,        // 標準自小客車預設 2.7m 軸距
    W: 1.8,        // 寬度 1.8m
    Of: 0.9,       // 前懸 0.9m
    Or: 1.0,       // 後懸 1.0m
    speed: 15 / 3.6,    // 15 km/h default speed (converted to m/s)
    scale: 25,     // 25 px/m
    lookahead: 6.0, // 6m lookahead distance for Pure Pursuit
    maxSteerLimit: 40, // 預設最大前輪轉彎 40 度
    
    // Trailer parameters default
    enableTrailer: false,
    Lt: 7.5,       // Trailer wheelbase
    Wt: 2.5,       // Trailer width
    Oft: 1.0,      // Trailer front overhang
    Ort: 1.8       // Trailer rear overhang
  });

  const [simControllerMode, setSimControllerMode] = useState<ControllerMode>(
    ControllerMode.FRONT_AXLE_DRAG
  );
  
  const [simRawPoints, setSimRawPoints] = useState<Waypoint[]>([]);
  // 路口引導曲線模式與參數 (Intersection Mode & parameters)
  const [simIsIntersectionMode, setSimIsIntersectionMode] = useState<boolean>(false);
  const [simP0X, setSimP0X] = useState<number | null>(null);
  const [simP0Y, setSimP0Y] = useState<number | null>(null);
  const [simP0Angle, setSimP0Angle] = useState<number>(0); // degrees
  const [simP3X, setSimP3X] = useState<number | null>(null);
  const [simP3Y, setSimP3Y] = useState<number | null>(null);
  const [simP3Angle, setSimP3Angle] = useState<number>(-90); // degrees (-90 = pointing up)
  const [simP1RatioPercent, setSimP1RatioPercent] = useState<number>(70);
  const [simP2RatioPercent, setSimP2RatioPercent] = useState<number>(70);
  const [simIntersectionPickState, setSimIntersectionPickState] = useState<"none" | "p0" | "p3">("none");
  const [simShowIntersectionHelpers, setSimShowIntersectionHelpers] = useState<boolean>(true);
  const [simEnableOutswing, setSimEnableOutswing] = useState<boolean>(false);
  const [simI1RatioPercent, setSimI1RatioPercent] = useState<number>(100);
  const [simI1OffsetDistance, setSimI1OffsetDistance] = useState<number>(0.0);
  const [simI2RatioPercent, setSimI2RatioPercent] = useState<number>(100);
  const [simI2OffsetDistance, setSimI2OffsetDistance] = useState<number>(0.0);
  const [simStartExtensionM, setSimStartExtensionM] = useState<number>(0.0);
  const [simEndExtensionM, setSimEndExtensionM] = useState<number>(10.0);
  const [simIsDragging, setSimIsDragging] = useState<boolean>(false);

  // 比例尺標定工具開關
  const [simIsCalibrating, setSimIsCalibrating] = useState<boolean>(false);

  const [simDrawMode, setSimDrawMode] = useState<"select" | "drag" | "click" | "smartpath">("select");
  const [isSimDrawModeDropdownOpen, setIsSimDrawModeDropdownOpen] = useState<boolean>(false);
  const [simIsPlaying, setSimIsPlaying] = useState<boolean>(false);
  const [simPlaybackSpeed, setSimPlaybackSpeed] = useState<number>(1);
  const [simCurrentStepIndex, setSimCurrentStepIndex] = useState<number>(0);
  const [simLockedPaths, setSimLockedPaths] = useState<{
    id: string;
    rawPoints: Waypoint[];
    trajectory: SimulationState[];
    config: VehicleConfig;
    themeColor: "indigo" | "emerald" | "amber" | "rose" | "sky";
    drawMode: "smartpath" | "click" | "drag";
    intersectionParams?: {
      p0X: number;
      p0Y: number;
      p0Angle: number;
      p3X: number;
      p3Y: number;
      p3Angle: number;
      p1RatioPercent: number;
      p2RatioPercent: number;
      enableOutswing: boolean;
      i1RatioPercent: number;
      i1OffsetDistance: number;
      i2RatioPercent: number;
      i2OffsetDistance: number;
      startExtensionM: number;
      endExtensionM: number;
    };
  }[]>([]);
  const [editingPathId, setEditingPathId] = useState<string | null>(null);
  const [simThemeColor, setSimThemeColor] = useState<"indigo" | "emerald" | "amber" | "rose" | "sky">("indigo");
  const [simSelectedVehiclePresetId, setSimSelectedVehiclePresetId] = useState<string>("standard-sedan");

  const [simIsPenTrajectory, setSimIsPenTrajectory] = useState<boolean>(false);

  // 當切換繪圖模式/離開繪製功能且僅有一個點時，清除該節點
  const prevSimDrawMode = useRef(simDrawMode);
  const prevAppMode = useRef(appMode);
  const prevSimIsIntersectionMode = useRef(simIsIntersectionMode);

  useEffect(() => {
    const isModeChanged = prevSimDrawMode.current !== simDrawMode || 
                          prevAppMode.current !== appMode || 
                          prevSimIsIntersectionMode.current !== simIsIntersectionMode;
    if (isModeChanged) {
      if (simRawPoints.length === 1) {
        setSimRawPoints([]);
      }
      prevSimDrawMode.current = simDrawMode;
      prevAppMode.current = appMode;
      prevSimIsIntersectionMode.current = simIsIntersectionMode;
    }
  }, [simDrawMode, appMode, simIsIntersectionMode, simRawPoints.length]);

  // 軌跡是否是使用鋼筆(smartpath)繪製的狀態追蹤
  useEffect(() => {
    if (simRawPoints.length > 0 && simDrawMode === 'smartpath') {
      setSimIsPenTrajectory(true);
    } else if (simRawPoints.length === 0) {
      setSimIsPenTrajectory(false);
    }
  }, [simRawPoints, simDrawMode]);

  // 當編輯中軌跡的幾何點或參數有任何變更時，自動將播放進度重設為 0% 並暫停播放
  useEffect(() => {
    setSimCurrentStepIndex(0);
    simFractionalStepRef.current = 0;
    setSimIsPlaying(false);
  }, [
    simRawPoints,
    simP0X,
    simP0Y,
    simP0Angle,
    simP3X,
    simP3Y,
    simP3Angle,
    simP1RatioPercent,
    simP2RatioPercent,
    simEnableOutswing,
    simI1RatioPercent,
    simI1OffsetDistance,
    simI2RatioPercent,
    simI2OffsetDistance,
    simStartExtensionM,
    simEndExtensionM
  ]);

  // 顯示選項
  const [simShowSweptPath, setSimShowSweptPath] = useState<boolean>(true);
  const [simShowCornerTracks, setSimShowCornerTracks] = useState<boolean>(true);
  const [simShowAxleTracks, setSimShowAxleTracks] = useState<boolean>(true);
  const [simShowBodyWireframe, setSimShowBodyWireframe] = useState<boolean>(true);
  const [simSweptOpacity, setSimSweptOpacity] = useState<number>(0.1);
  const [simWheelTracksOpacity, setSimWheelTracksOpacity] = useState<number>(0.45);
  const [simAxleTracksOpacity, setSimAxleTracksOpacity] = useState<number>(1.0);

  // 繪製與拖曳狀態
  const [simDraggingWaypointIndex, setSimDraggingWaypointIndex] = useState<number | null>(null);
  const [simDraggingHandleType, setSimDraggingHandleType] = useState<"anchor" | "handleIn" | "handleOut" | null>(null);
  const [simIsDraggingFirstVec, setSimIsDraggingFirstVec] = useState<boolean>(false);
  const [simFirstVecStart, setSimFirstVecStart] = useState<Point | null>(null);
  const [simFirstVecEnd, setSimFirstVecEnd] = useState<Point | null>(null);
  const simClickStartHeadingRef = useRef<number | null>(null);

  // Animation Timer references
  const simAnimationFrameId = useRef<number | null>(null);
  const simFractionalStepRef = useRef<number>(0);
  const simLastTimeRef = useRef<number>(0);

  // 車型 Presets 定義
  const SIM_VEHICLE_PRESETS = [
    {
      id: "standard-sedan",
      name: "標準自小客車",
      L: 2.7,
      W: 1.8,
      Of: 0.9,
      Or: 1.0,
      enableTrailer: false,
      maxSteerLimit: 40,
    },
    {
      id: "taiwan-bus",
      name: "台灣標準大客車",
      L: 5.8,
      W: 2.5,
      Of: 2.2,
      Or: 3.3,
      enableTrailer: false,
      maxSteerLimit: 40,
    },
    {
      id: "taiwan-truck",
      name: "台灣標準大貨車",
      L: 5.6,
      W: 2.5,
      Of: 1.5,
      Or: 2.9,
      enableTrailer: false,
      maxSteerLimit: 40,
    },
    {
      id: "taiwan-trailer",
      name: "台灣標準聯結半拖車",
      L: 3.5,
      W: 2.5,
      Of: 1.0,
      Or: 0.8,
      enableTrailer: true,
      Lt: 7.5,
      Wt: 2.5,
      Oft: 1.4,
      Ort: 1.8,
      maxSteerLimit: 40,
    },
    {
      id: "custom",
      name: "自定義車體尺寸",
      L: 5.0,
      W: 2.5,
      Of: 1.0,
      Or: 0.8,
      enableTrailer: false,
      maxSteerLimit: 40,
    }
  ];

  // Presets 切換
  const handleSimVehiclePresetChange = (presetId: string) => {
    setSimSelectedVehiclePresetId(presetId);
    const p = SIM_VEHICLE_PRESETS.find((preset) => preset.id === presetId);
    if (p && presetId !== "custom") {
      setSimConfig((prev) => ({
        ...prev,
        L: p.L,
        W: p.W,
        Of: p.Of,
        Or: p.Or,
        enableTrailer: p.enableTrailer,
        Lt: p.Lt ?? prev.Lt,
        Wt: p.Wt ?? prev.Wt,
        Oft: p.Oft ?? prev.Oft,
        Ort: p.Ort ?? prev.Ort,
        maxSteerLimit: p.maxSteerLimit ?? 40
      }));
      setSimCurrentStepIndex(0);
      simFractionalStepRef.current = 0;
    }
  };

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

  // Automatically calculate and set raw points when intersection mode is active
  useEffect(() => {
    if (simIsIntersectionMode) {
      if (simP0X === null || simP0Y === null || simP3X === null || simP3Y === null || simIsDragging) {
        setSimRawPoints([]);
        return;
      }
      const p0 = { x: simP0X, y: simP0Y };
      const p3 = { x: simP3X, y: simP3Y };
      const res = calculateIntersectionCurve(
        p0,
        simP0Angle,
        p3,
        simP3Angle,
        simP1RatioPercent / 100,
        simP2RatioPercent / 100,
        simEnableOutswing,
        simConfig.scale,
        simI1RatioPercent,
        simI1OffsetDistance,
        simI2RatioPercent,
        simI2OffsetDistance,
        simStartExtensionM,
        simEndExtensionM
      );
      
      // Convert Point[] to Waypoint[]
      const waypoints: Waypoint[] = res.curve.map(pt => ({
        x: pt.x,
        y: pt.y,
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 0, y: 0 }
      }));
      setSimRawPoints(waypoints);
    }
  }, [
    simIsIntersectionMode,
    simP0X,
    simP0Y,
    simP0Angle,
    simP3X,
    simP3Y,
    simP3Angle,
    simP1RatioPercent,
    simP2RatioPercent,
    simEnableOutswing,
    simConfig.scale,
    simI1RatioPercent,
    simI1OffsetDistance,
    simI2RatioPercent,
    simI2OffsetDistance,
    simStartExtensionM,
    simEndExtensionM,
    simIsDragging
  ]);

  // --- 計算引導路徑 (Cubic Bezier / Chaikin) ---
  const simInterpolatedPath = useMemo<PathPoint[]>(() => {
    if (simRawPoints.length < 2) return [];

    const scale = simConfig.scale;
    const hasBezier = simRawPoints.some(wp => 
      (wp.handleIn && (wp.handleIn.x !== 0 || wp.handleIn.y !== 0)) ||
      (wp.handleOut && (wp.handleOut.x !== 0 || wp.handleOut.y !== 0))
    );

    if (simDrawMode === 'click' || simDrawMode === 'drag' || (simDrawMode === 'select' && !simIsPenTrajectory)) {
      let processed: Point[] = [];
      const firstPt = simRawPoints[0];
      const hasFirstHandle = firstPt && firstPt.handleOut && (firstPt.handleOut.x !== 0 || firstPt.handleOut.y !== 0);
      
      let controlPoints = [...simRawPoints];
      if (hasFirstHandle && simRawPoints.length >= 2) {
        const dx = firstPt.handleOut.x;
        const dy = firstPt.handleOut.y;
        const hLen = Math.hypot(dx, dy);
        const ux = dx / hLen;
        const uy = dy / hLen;
        const dist = Math.hypot(simRawPoints[1].x - firstPt.x, simRawPoints[1].y - firstPt.y);
        const Pv = {
          x: firstPt.x + ux * dist * 0.35,
          y: firstPt.y + uy * dist * 0.35
        };
        controlPoints = [firstPt, Pv, ...simRawPoints.slice(1)];
      }

      if (controlPoints.length === 2) {
        processed = [...controlPoints];
      } else {
        processed = chaikinSmooth(controlPoints, 3);
      }
      const sampleSpacingPx = 0.08 * scale;
      const path = interpolatePath(processed, sampleSpacingPx);

      const hStep = 8;
      for (let i = 0; i < path.length; i++) {
        const prevIdx = Math.max(0, i - hStep);
        const nextIdx = Math.min(path.length - 1, i + hStep);
        if (nextIdx > prevIdx) {
          path[i].heading = Math.atan2(path[nextIdx].y - path[prevIdx].y, path[nextIdx].x - path[prevIdx].x);
        }
      }

      const L = simConfig.L;
      const maxSteerDeg = simConfig.maxSteerLimit ?? 40;
      const phi_max = (maxSteerDeg * Math.PI) / 180;
      const R_min = phi_max > 0.001 ? L / Math.sin(phi_max) : 3.0;

      const step = 8;
      for (let i = 0; i < path.length; i++) {
        const prevIdx = Math.max(0, i - step);
        const nextIdx = Math.min(path.length - 1, i + step);
        if (nextIdx === prevIdx) {
          path[i].isCurvatureExceeded = false;
          path[i].steerAngleDeg = 0;
          continue;
        }

        const dHeading = Math.abs(normalizeAngle(path[nextIdx].heading - path[prevIdx].heading));
        const ds = (path[nextIdx].s - path[prevIdx].s) / scale;
        let R_curv = Infinity;
        if (dHeading > 1e-5 && ds > 1e-5) {
          R_curv = ds / dHeading;
        }

        path[i].isCurvatureExceeded = R_curv < R_min;
        let steerAngleDeg = 0;
        if (R_curv > 0.001 && R_curv !== Infinity) {
          steerAngleDeg = Math.atan(L / R_curv) * 180 / Math.PI;
        }
        path[i].steerAngleDeg = steerAngleDeg;
      }

      return path;
    }

    const L = simConfig.L;
    const maxSteerDeg = simConfig.maxSteerLimit ?? 40;
    const phi_max = (maxSteerDeg * Math.PI) / 180;
    const R_min = phi_max > 0.001 ? L / Math.sin(phi_max) : 3.0;

    const samples: PathPoint[] = [];

    for (let i = 0; i < simRawPoints.length - 1; i++) {
      const pStart = simRawPoints[i];
      const pEnd = simRawPoints[i + 1];

      const A = { x: pStart.x, y: pStart.y };
      const B = { x: pStart.x + (pStart.handleOut?.x ?? 0), y: pStart.y + (pStart.handleOut?.y ?? 0) };
      const C = { x: pEnd.x + (pEnd.handleIn?.x ?? 0), y: pEnd.y + (pEnd.handleIn?.y ?? 0) };
      const D = { x: pEnd.x, y: pEnd.y };

      const Am = { x: A.x / scale, y: A.y / scale };
      const Bm = { x: B.x / scale, y: B.y / scale };
      const Cm = { x: C.x / scale, y: C.y / scale };
      const Dm = { x: D.x / scale, y: D.y / scale };

      const numSegmentSteps = 150;
      for (let j = 0; j <= numSegmentSteps; j++) {
        if (i > 0 && j === 0) continue;

        const t = j / numSegmentSteps;
        const oneMinusT = 1 - t;

        const pPx = {
          x: (oneMinusT ** 3) * A.x + 3 * (oneMinusT ** 2) * t * B.x + 3 * oneMinusT * (t ** 2) * C.x + (t ** 3) * D.x,
          y: (oneMinusT ** 3) * A.y + 3 * (oneMinusT ** 2) * t * B.y + 3 * oneMinusT * (t ** 2) * C.y + (t ** 3) * D.y,
        };

        const dx = 3 * (oneMinusT ** 2) * (Bm.x - Am.x) + 6 * oneMinusT * t * (Cm.x - Bm.x) + 3 * (t ** 2) * (Dm.x - Cm.x);
        const dy = 3 * (oneMinusT ** 2) * (Bm.y - Am.y) + 6 * oneMinusT * t * (Cm.y - Bm.y) + 3 * (t ** 2) * (Dm.y - Cm.y);

        const ddx = 6 * oneMinusT * (Cm.x - 2 * Bm.x + Am.x) + 6 * t * (Dm.x - 2 * Cm.x + Bm.x);
        const ddy = 6 * oneMinusT * (Cm.y - 2 * Bm.y + Am.y) + 6 * t * (Dm.y - 2 * Cm.y + Bm.y);

        let heading = Math.atan2(dy, dx);
        if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
          heading = Math.atan2(Dm.y - Am.y, Dm.x - Am.x);
        }

        const denominator = (dx ** 2 + dy ** 2) ** 1.5;
        let k = 0;
        if (denominator > 0.0001) {
          k = Math.abs(dx * ddy - dy * ddx) / denominator;
        }

        const R_curv = k > 0.0001 ? 1 / k : Infinity;
        const isCurvatureExceeded = R_curv < R_min;
        let steerAngleDeg = 0;
        if (R_curv > 0.001 && R_curv !== Infinity) {
          steerAngleDeg = Math.atan(L / R_curv) * 180 / Math.PI;
        }

        samples.push({
          x: pPx.x,
          y: pPx.y,
          s: 0,
          heading: heading,
          isCurvatureExceeded: isCurvatureExceeded,
          steerAngleDeg: steerAngleDeg,
        });
      }
    }

    const sampleSpacingPx = 0.08 * scale;
    const finalPath = interpolatePath(samples, sampleSpacingPx);

    for (let k = 0; k < finalPath.length; k++) {
      const closestIdx = findClosestPointIndex(samples, finalPath[k]);
      finalPath[k].isCurvatureExceeded = samples[closestIdx]?.isCurvatureExceeded ?? false;
      finalPath[k].steerAngleDeg = samples[closestIdx]?.steerAngleDeg ?? 0;
    }

    // 筆刷繪製時將初始朝向設為起始點與第二個點的向量
    if (simDrawMode === 'drag' && simRawPoints.length >= 2 && finalPath.length > 0) {
      const dx = simRawPoints[1].x - simRawPoints[0].x;
      const dy = simRawPoints[1].y - simRawPoints[0].y;
      const initHeading = Math.atan2(dy, dx);
      const numInitPoints = Math.min(finalPath.length, 5);
      for (let i = 0; i < numInitPoints; i++) {
        finalPath[i].heading = initHeading;
      }
    }

    return finalPath;
  }, [simRawPoints, simDrawMode, simConfig.scale, simConfig.L, simConfig.maxSteerLimit]);

  // --- 計算車輛運動軌跡 ---
  const simTrajectory = useMemo<SimulationState[]>(() => {
    if (simInterpolatedPath.length < 2) return [];
    if (simIsDragging && simControllerMode === ControllerMode.ACTIVE_PURE_PURSUIT) {
      return []; // 拖曳時暫停 Pure Pursuit 運動模擬，防止卡頓
    }
    return simulateVehicle(simInterpolatedPath, simConfig, simControllerMode);
  }, [simInterpolatedPath, simConfig, simControllerMode, simIsDragging]);

  // --- 即時模擬指標計算 ---
  const activeState = simTrajectory[Math.min(simCurrentStepIndex, simTrajectory.length ? simTrajectory.length - 1 : 0)];
  const currentDeltaDeg = activeState ? (activeState.steering * 180) / Math.PI : 0;
  const currentThetaDeg = activeState ? (activeState.heading * 180) / Math.PI : 0;
  const currentTurnRadiusM = useMemo(() => {
    if (!activeState || Math.abs(activeState.steering) < 0.005) return Infinity;
    return simConfig.L / Math.tan(Math.abs(activeState.steering));
  }, [activeState, simConfig.L]);
  const totalPathLengthM = useMemo(() => {
    if (simInterpolatedPath.length < 2) return 0;
    return simInterpolatedPath[simInterpolatedPath.length - 1].s / simConfig.scale;
  }, [simInterpolatedPath, simConfig.scale]);

  // --- 動畫播放計時器 ---
  useEffect(() => {
    if (simTrajectory.length === 0) return;

    if (!simIsPlaying) {
      if (simAnimationFrameId.current) {
        cancelAnimationFrame(simAnimationFrameId.current);
      }
      return;
    }

    const playLoop = (timestamp: number) => {
      if (!simLastTimeRef.current) simLastTimeRef.current = timestamp;
      const elapsedMs = timestamp - simLastTimeRef.current;
      simLastTimeRef.current = timestamp;

      const dt = Math.min(0.04, elapsedMs / 1000); 

      const stepDist_px = simControllerMode === ControllerMode.FRONT_AXLE_DRAG 
        ? 0.08 * simConfig.scale
        : 1.5; 

      const displacement_px = simConfig.speed * simConfig.scale * dt * simPlaybackSpeed;
      const stepIncrement = displacement_px / stepDist_px;

      simFractionalStepRef.current += stepIncrement;
      
      if (simFractionalStepRef.current >= simTrajectory.length - 1) {
        simFractionalStepRef.current = 0;
      }

      const nextIdx = Math.floor(simFractionalStepRef.current);
      setSimCurrentStepIndex(nextIdx);

      simAnimationFrameId.current = requestAnimationFrame(playLoop);
    };

    simLastTimeRef.current = 0;
    simAnimationFrameId.current = requestAnimationFrame(playLoop);

    return () => {
      if (simAnimationFrameId.current) cancelAnimationFrame(simAnimationFrameId.current);
    };
  }, [simTrajectory, simIsPlaying, simConfig.speed, simConfig.scale, simControllerMode, simPlaybackSpeed]);

  const handleSimClear = () => {
    setSimRawPoints([]);
    simClickStartHeadingRef.current = null;
    simFractionalStepRef.current = 0;
    setSimCurrentStepIndex(0);
    setSimIsPlaying(false);
  };

  const handleSimClearAll = () => {
    setSimLockedPaths([]);
    setSimRawPoints([]);
    setEditingPathId(null);
    simClickStartHeadingRef.current = null;
    simFractionalStepRef.current = 0;
    setSimCurrentStepIndex(0);
    setSimIsPlaying(false);
  };

  const handleSimUndoLastNode = () => {
    if (simRawPoints.length > 0) {
      setSimRawPoints((prev) => {
        const next = prev.slice(0, prev.length - 1);
        if (next.length === 0) {
          setSimIsDraggingFirstVec(false);
          setSimFirstVecStart(null);
          setSimFirstVecEnd(null);
          simClickStartHeadingRef.current = null;
        }
        return next;
      });
      setSimCurrentStepIndex(0);
      simFractionalStepRef.current = 0;
      setSimIsPlaying(false);
    }
  };

  const handleSimLockCurrentPath = () => {
    if (simRawPoints.length > 0) {
      if (editingPathId) {
        // 如果目前是解鎖編輯舊的軌跡，將修改儲存回該軌跡，並保持其在陣列中的順序
        setSimLockedPaths((prev) =>
          prev.map((path) =>
            path.id === editingPathId
              ? {
                  ...path,
                  rawPoints: [...simRawPoints],
                  trajectory: [...simTrajectory],
                  config: { ...simConfig },
                  themeColor: simThemeColor,
                  intersectionParams: simIsIntersectionMode ? {
                    p0X: simP0X ?? 0,
                    p0Y: simP0Y ?? 0,
                    p0Angle: simP0Angle,
                    p3X: simP3X ?? 0,
                    p3Y: simP3Y ?? 0,
                    p3Angle: simP3Angle,
                    p1RatioPercent: simP1RatioPercent,
                    p2RatioPercent: simP2RatioPercent,
                    enableOutswing: simEnableOutswing,
                    i1RatioPercent: simI1RatioPercent,
                    i1OffsetDistance: simI1OffsetDistance,
                    i2RatioPercent: simI2RatioPercent,
                    i2OffsetDistance: simI2OffsetDistance,
                    startExtensionM: simStartExtensionM,
                    endExtensionM: simEndExtensionM,
                  } : undefined
                }
              : path
          )
        );
        setEditingPathId(null);
      } else {
        // 否則，新增一條全新的軌跡到陣列末尾
        const currentMode = simDrawMode === 'select' ? (simIsPenTrajectory ? 'smartpath' : 'click') : simDrawMode;
        setSimLockedPaths((prev) => [
          ...prev,
          {
            id: `path-${Date.now()}`,
            rawPoints: [...simRawPoints],
            trajectory: [...simTrajectory],
            config: { ...simConfig },
            themeColor: simThemeColor,
            drawMode: currentMode === 'select' ? 'smartpath' : currentMode,
            intersectionParams: simIsIntersectionMode ? {
              p0X: simP0X ?? 0,
              p0Y: simP0Y ?? 0,
              p0Angle: simP0Angle,
              p3X: simP3X ?? 0,
              p3Y: simP3Y ?? 0,
              p3Angle: simP3Angle,
              p1RatioPercent: simP1RatioPercent,
              p2RatioPercent: simP2RatioPercent,
              enableOutswing: simEnableOutswing,
              i1RatioPercent: simI1RatioPercent,
              i1OffsetDistance: simI1OffsetDistance,
              i2RatioPercent: simI2RatioPercent,
              i2OffsetDistance: simI2OffsetDistance,
              startExtensionM: simStartExtensionM,
              endExtensionM: simEndExtensionM,
            } : undefined
          },
        ]);
      }
      setSimRawPoints([]);
      setSimIsIntersectionMode(false);
      setSimCurrentStepIndex(0);
      simFractionalStepRef.current = 0;
      setSimIsPlaying(false);
      const colorsOption: ("indigo" | "emerald" | "amber" | "rose" | "sky")[] = ["indigo", "emerald", "amber", "rose", "sky"];
      const nextColor = colorsOption[(colorsOption.indexOf(simThemeColor) + 1) % colorsOption.length];
      setSimThemeColor(nextColor);
    }
  };

  const handleSimUnlockLastPath = () => {
    if (simLockedPaths.length > 0) {
      const last = simLockedPaths[simLockedPaths.length - 1];
      setSimLockedPaths((prev) => prev.slice(0, prev.length - 1));
      setEditingPathId(last.id);
      setSimRawPoints([...last.rawPoints]);
      setSimConfig({ ...last.config });
      setSimThemeColor(last.themeColor);
      setSimCurrentStepIndex(0);
      simFractionalStepRef.current = 0;
      setSimIsPlaying(true);
      setSimIsPenTrajectory(last.drawMode === 'smartpath');

      if (last.intersectionParams) {
        setSimP0X(last.intersectionParams.p0X);
        setSimP0Y(last.intersectionParams.p0Y);
        setSimP0Angle(last.intersectionParams.p0Angle);
        setSimP3X(last.intersectionParams.p3X);
        setSimP3Y(last.intersectionParams.p3Y);
        setSimP3Angle(last.intersectionParams.p3Angle);
        setSimP1RatioPercent(last.intersectionParams.p1RatioPercent);
        setSimP2RatioPercent(last.intersectionParams.p2RatioPercent);
        setSimEnableOutswing(last.intersectionParams.enableOutswing);
        setSimI1RatioPercent(last.intersectionParams.i1RatioPercent);
        setSimI1OffsetDistance(last.intersectionParams.i1OffsetDistance);
        setSimI2RatioPercent(last.intersectionParams.i2RatioPercent);
        setSimI2OffsetDistance(last.intersectionParams.i2OffsetDistance);
        setSimStartExtensionM(last.intersectionParams.startExtensionM);
        setSimEndExtensionM(last.intersectionParams.endExtensionM);
        setSimIsIntersectionMode(true);
        setSimDrawMode(last.drawMode || 'smartpath');
      } else {
        setSimIsIntersectionMode(false);
        setSimDrawMode('select');
      }
    }
  };

  const handleSelectLockedPath = (pathId: string) => {
    const targetPath = simLockedPaths.find(x => x.id === pathId);
    if (!targetPath) return;

    // 先保存當前正在編輯的軌跡（若有）
    if (simRawPoints.length > 0) {
      if (editingPathId) {
        // 原地更新舊的編輯軌跡
        setSimLockedPaths((prev) =>
          prev.map((path) =>
            path.id === editingPathId
              ? {
                  ...path,
                  rawPoints: [...simRawPoints],
                  trajectory: [...simTrajectory],
                  config: { ...simConfig },
                  themeColor: simThemeColor,
                  intersectionParams: simIsIntersectionMode ? {
                    p0X: simP0X ?? 0,
                    p0Y: simP0Y ?? 0,
                    p0Angle: simP0Angle,
                    p3X: simP3X ?? 0,
                    p3Y: simP3Y ?? 0,
                    p3Angle: simP3Angle,
                    p1RatioPercent: simP1RatioPercent,
                    p2RatioPercent: simP2RatioPercent,
                    enableOutswing: simEnableOutswing,
                    i1RatioPercent: simI1RatioPercent,
                    i1OffsetDistance: simI1OffsetDistance,
                    i2RatioPercent: simI2RatioPercent,
                    i2OffsetDistance: simI2OffsetDistance,
                    startExtensionM: simStartExtensionM,
                    endExtensionM: simEndExtensionM,
                  } : undefined
                }
              : path
          )
        );
      } else {
        // 全新軌跡則上鎖並新增到末端
        const currentMode = simDrawMode === 'select' ? (simIsPenTrajectory ? 'smartpath' : 'click') : simDrawMode;
        setSimLockedPaths((prev) => [
          ...prev,
          {
            id: `path-${Date.now()}`,
            rawPoints: [...simRawPoints],
            trajectory: [...simTrajectory],
            config: { ...simConfig },
            themeColor: simThemeColor,
            drawMode: currentMode === 'select' ? 'smartpath' : currentMode,
            intersectionParams: simIsIntersectionMode ? {
              p0X: simP0X ?? 0,
              p0Y: simP0Y ?? 0,
              p0Angle: simP0Angle,
              p3X: simP3X ?? 0,
              p3Y: simP3Y ?? 0,
              p3Angle: simP3Angle,
              p1RatioPercent: simP1RatioPercent,
              p2RatioPercent: simP2RatioPercent,
              enableOutswing: simEnableOutswing,
              i1RatioPercent: simI1RatioPercent,
              i1OffsetDistance: simI1OffsetDistance,
              i2RatioPercent: simI2RatioPercent,
              i2OffsetDistance: simI2OffsetDistance,
              startExtensionM: simStartExtensionM,
              endExtensionM: simEndExtensionM,
            } : undefined
          },
        ]);
      }
    }

    // 載入 targetPath 作為當前編輯
    setEditingPathId(pathId);
    setSimRawPoints([...targetPath.rawPoints]);
    setSimConfig({ ...targetPath.config });
    setSimThemeColor(targetPath.themeColor);
    setSimCurrentStepIndex(0);
    simFractionalStepRef.current = 0;
    setSimIsPlaying(false);
    setSimIsPenTrajectory(targetPath.drawMode === 'smartpath');
    
    if (targetPath.intersectionParams) {
      setSimP0X(targetPath.intersectionParams.p0X);
      setSimP0Y(targetPath.intersectionParams.p0Y);
      setSimP0Angle(targetPath.intersectionParams.p0Angle);
      setSimP3X(targetPath.intersectionParams.p3X);
      setSimP3Y(targetPath.intersectionParams.p3Y);
      setSimP3Angle(targetPath.intersectionParams.p3Angle);
      setSimP1RatioPercent(targetPath.intersectionParams.p1RatioPercent);
      setSimP2RatioPercent(targetPath.intersectionParams.p2RatioPercent);
      setSimEnableOutswing(targetPath.intersectionParams.enableOutswing);
      setSimI1RatioPercent(targetPath.intersectionParams.i1RatioPercent);
      setSimI1OffsetDistance(targetPath.intersectionParams.i1OffsetDistance);
      setSimI2RatioPercent(targetPath.intersectionParams.i2RatioPercent);
      setSimI2OffsetDistance(targetPath.intersectionParams.i2OffsetDistance);
      setSimStartExtensionM(targetPath.intersectionParams.startExtensionM);
      setSimEndExtensionM(targetPath.intersectionParams.endExtensionM);
      setSimIsIntersectionMode(true);
      setSimDrawMode(targetPath.drawMode || 'smartpath');
    } else {
      setSimIsIntersectionMode(false);
      setSimDrawMode('select');
    }
  };


  // Global Engineering settings
  const [R2, setR2] = useState<number>(10.0); // Default 10 meters radius
  const [designVehicle, setDesignVehicle] = useState<'passenger' | 'semi_trailer' | 'articulated'>('semi_trailer');
  const [bgImage, setBgImage] = useState<any>(null);
  const [exportedImage, setExportedImage] = useState<string | null>(null);
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

  // SIM 面板彈出控制狀態
  const [activeColorPickerPathId, setActiveColorPickerPathId] = useState<string | null>(null);

  // 更新已鎖定軌跡的顏色
  const handleUpdatePathColor = (pathId: string, color: string) => {
    if (pathId === editingPathId) {
      // 正在編輯的軌跡：更新當前主題色
      setSimThemeColor(color);
    }
    setSimLockedPaths((prev) =>
      prev.map((path) =>
        path.id === pathId ? { ...path, themeColor: color } : path
      )
    );
  };

  // Register Global Hotkeys (Ctrl+Z, Ctrl+Y, V to select, and Delete/Backspace to delete selected elements)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      const isCmdOrCtrl = e.ctrlKey || e.metaKey;

      if (appMode === 'simulation') {
        if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          handleSimUndoLastNode();
        } else if (e.key.toLowerCase() === 'v') {
          e.preventDefault();
          if (simRawPoints.length >= 2) {
            handleSimLockCurrentPath();
          }
          setSimDrawMode('select');
          setSimIsIntersectionMode(false);
        } else if (e.key === 'Enter') {
          if (simRawPoints.length >= 2) {
            e.preventDefault();
            handleSimLockCurrentPath();
          }
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          handleSimClear();
        }
        return;
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
      } else if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
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
    appMode, simRawPoints, setSimDrawMode, setSimIsIntersectionMode,
    handleSimUndoLastNode, handleSimLockCurrentPath, handleSimClear
  ]);

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

  // 點擊外部時關閉繪製模式下拉選單
  useEffect(() => {
    if (!isSimDrawModeDropdownOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#sim-draw-mode-dropdown-container')) {
        setIsSimDrawModeDropdownOpen(false);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [isSimDrawModeDropdownOpen]);

  // 點擊外部時關閉調色盤
  useEffect(() => {
    if (!activeColorPickerPathId) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`#color-picker-container-${activeColorPickerPathId === 'new-path' ? 'new-path' : activeColorPickerPathId}`)) {
        setActiveColorPickerPathId(null);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [activeColorPickerPathId]);

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

  const handleUpdateElements = (nextElements: CadElement[]) => {
    setElements(nextElements);
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

  const handleClearCanvas = () => {
    // Silent clear with automatic history state backup (prevents blocking in iframe sandboxes)
    saveHistory(elements);
    setElements([]);
    setSelectedElement(null);
    setSelectedElementIds([]);
  };

  // Save history before discrete active handles drag begins
  const handleSaveHistoryBeforeDrag = () => {
    saveHistory(elements);
  };

  // Road intersection template helper (載入交叉路口 Demo)
  const handleLoadDemo = () => {
    saveHistory(elements);
    // Setup guidelines + annotated demo
    const demoElements: CadElement[] = [
      {
        id: 'demo-line-1',
        type: 'yellow_double',
        points: [{ x: -35.0, y: 0.0 }, { x: -8.0, y: 0.0 }],
        cpLeft: [{ x: -35.0, y: 0.0 }, { x: -8.0, y: 0.0 }],
        cpRight: [{ x: -35.0, y: 0.0 }, { x: -8.0, y: 0.0 }]
      },
      {
        id: 'demo-line-2',
        type: 'yellow_double',
        points: [{ x: 0.0, y: 10.0 }, { x: 0.0, y: 35.0 }],
        cpLeft: [{ x: 0.0, y: 10.0 }, { x: 0.0, y: 35.0 }],
        cpRight: [{ x: 0.0, y: 10.0 }, { x: 0.0, y: 35.0 }]
      },
      {
        id: 'demo-road-edge-A',
        type: 'white_solid',
        points: [{ x: -35.0, y: -8.0 }, { x: 8.0, y: -8.0 }],
        cpLeft: [{ x: -35.0, y: -8.0 }, { x: 8.0, y: -8.5 }],
        cpRight: [{ x: -35.0, y: -8.0 }, { x: 8.0, y: -8.0 }]
      },
      {
        id: 'demo-road-edge-B',
        type: 'white_solid',
        points: [{ x: 8.0, y: -8.0 }, { x: 8.0, y: 35.0 }],
        cpLeft: [{ x: 8.0, y: -8.0 }, { x: 8.0, y: 35.0 }],
        cpRight: [{ x: 8.0, y: -8.0 }, { x: 8.0, y: 35.0 }]
      },
      {
        id: 'demo-sketch-1',
        type: 'sketch_circle',
        center: { x: 32.0, y: 16.0 },
        radius: 24.0
      },
      {
        id: 'demo-sketch-2',
        type: 'sketch_circle',
        center: { x: 16.0, y: -16.0 },
        radius: 8.0
      },
      {
        id: 'demo-text-1',
        type: 'text',
        p: { x: -20.0, y: 3.5 },
        text: '橫向道路 (省道15線) - 雙向2車道',
        fontSize: 1.2
      },
      {
        id: 'demo-text-2',
        type: 'text',
        p: { x: -16.0, y: -13.0 },
        text: '💡 使用「圓形草稿輔助線」與「自由貝茲標線」進行高精度法理車道標線臨摹',
        fontSize: 0.95
      }
    ];

    setElements(demoElements);
    setSelectedElement(null);
    setActiveTool('select');
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

  // 儲存整個專案狀態為 JSON
  const handleSaveProject = () => {
    try {
      const projectData = {
        version: '1.0.0',
        appMode,
        cad: {
          elements,
          R2,
          designVehicle,
        },
        bgImage,
        simulation: {
          simConfig,
          simControllerMode,
          simRawPoints,
          simIsIntersectionMode,
          simP0X,
          simP0Y,
          simP0Angle,
          simP3X,
          simP3Y,
          simP3Angle,
          simP1RatioPercent,
          simP2RatioPercent,
          simEnableOutswing,
          simI1RatioPercent,
          simI1OffsetDistance,
          simI2RatioPercent,
          simI2OffsetDistance,
          simStartExtensionM,
          simEndExtensionM,
          simLockedPaths,
        },
        settings: {
          snapToGrid,
          snapToEndpoint,
          snapToMidpoint,
          snapToNearest,
          showGrid,
          minorGridInterval,
          majorGridInterval,
        }
      };

      const jsonString = JSON.stringify(projectData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `WebTrafficCAD_Project_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showToast('專案已成功儲存！', 'success');
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
        
        if (!json || !json.cad || !Array.isArray(json.cad.elements)) {
          showToast('無效的專案檔案格式！', 'error');
          return;
        }

        // 復原狀態
        if (json.appMode) setAppMode(json.appMode);
        
        // CAD 狀態
        if (json.cad.elements) {
          setElements(json.cad.elements);
          setHistoryStack([]);
          setRedoStack([]);
        }
        if (typeof json.cad.R2 === 'number') setR2(json.cad.R2);
        if (json.cad.designVehicle) setDesignVehicle(json.cad.designVehicle);

        // 背景底圖
        if (json.bgImage !== undefined) {
          setBgImage(json.bgImage);
        }

        // 模擬軌跡狀態
        if (json.simulation) {
          const sim = json.simulation;
          if (sim.simConfig) setSimConfig(sim.simConfig);
          if (sim.simControllerMode) setSimControllerMode(sim.simControllerMode);
          if (sim.simRawPoints) setSimRawPoints(sim.simRawPoints);
          if (typeof sim.simIsIntersectionMode === 'boolean') setSimIsIntersectionMode(sim.simIsIntersectionMode);
          if (sim.simP0X !== undefined) setSimP0X(sim.simP0X);
          if (sim.simP0Y !== undefined) setSimP0Y(sim.simP0Y);
          if (typeof sim.simP0Angle === 'number') setSimP0Angle(sim.simP0Angle);
          if (sim.simP3X !== undefined) setSimP3X(sim.simP3X);
          if (sim.simP3Y !== undefined) setSimP3Y(sim.simP3Y);
          if (typeof sim.simP3Angle === 'number') setSimP3Angle(sim.simP3Angle);
          if (typeof sim.simP1RatioPercent === 'number') setSimP1RatioPercent(sim.simP1RatioPercent);
          if (typeof sim.simP2RatioPercent === 'number') setSimP2RatioPercent(sim.simP2RatioPercent);
          if (typeof sim.simEnableOutswing === 'boolean') setSimEnableOutswing(sim.simEnableOutswing);
          if (typeof sim.simI1RatioPercent === 'number') setSimI1RatioPercent(sim.simI1RatioPercent);
          if (typeof sim.simI1OffsetDistance === 'number') setSimI1OffsetDistance(sim.simI1OffsetDistance);
          if (typeof sim.simI2RatioPercent === 'number') setSimI2RatioPercent(sim.simI2RatioPercent);
          if (typeof sim.simI2OffsetDistance === 'number') setSimI2OffsetDistance(sim.simI2OffsetDistance);
          if (typeof sim.simStartExtensionM === 'number') setSimStartExtensionM(sim.simStartExtensionM);
          if (typeof sim.simEndExtensionM === 'number') setSimEndExtensionM(sim.simEndExtensionM);
          if (Array.isArray(sim.simLockedPaths)) setSimLockedPaths(sim.simLockedPaths);
        }

        // 其他設定
        if (json.settings) {
          const s = json.settings;
          if (typeof s.snapToGrid === 'boolean') setSnapToGrid(s.snapToGrid);
          if (typeof s.snapToEndpoint === 'boolean') setSnapToEndpoint(s.snapToEndpoint);
          if (typeof s.snapToMidpoint === 'boolean') setSnapToMidpoint(s.snapToMidpoint);
          if (typeof s.snapToNearest === 'boolean') setSnapToNearest(s.snapToNearest);
          if (typeof s.showGrid === 'boolean') setShowGrid(s.showGrid);
          if (typeof s.minorGridInterval === 'number') setMinorGridInterval(s.minorGridInterval);
          if (typeof s.majorGridInterval === 'number') setMajorGridInterval(s.majorGridInterval);
        }

        // 重設選擇狀態
        setSelectedElement(null);
        setSelectedElementIds([]);
        setSelectedAnchorIndices([]);
        setEditingPathId(null);
        setSimCurrentStepIndex(0);
        simFractionalStepRef.current = 0;
        setSimIsPlaying(false);

        showToast('專案已成功匯入！', 'success');
      } catch (err) {
        console.error(err);
        showToast('解析專案檔案失敗，請確保是合法的 JSON 專案檔！', 'error');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // Export CAD Geometry as vector text AutoCAD DXF file trigger
  const handleExportDXF = () => {

    if (elements.length === 0) {
      showToast('當前畫布為空，無幾何資料可以匯出為 DXF！', 'error');
      return;
    }

    try {
      const dxfContent = exportToDXF(elements);
      const blob = new Blob([dxfContent], { type: 'application/dxf;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `WebTrafficCAD_Design_${new Date().toISOString().slice(0, 10)}.dxf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      showToast('匯出 DXF 發生異常，請確認幾何點位符合格式！', 'error');
    }
  };

  // Export high resolution PNG following the 10% bounding box padding calculations
  const handleExportPNG = () => {
    try {
      if (elements.length === 0 && !bgImage) {
        showToast('當前畫布為空，無底圖與幾何資料可以匯出為圖片！', 'error');
        return;
      }

      // 1. Calculate physical coordinate bounding box extremes
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

      const updateBounds = (p: { x: number; y: number }) => {
        if (p && typeof p.x === 'number' && typeof p.y === 'number') {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.y > maxY) maxY = p.y;
        }
      };

      // Include background image bounds
      if (bgImage && bgImage.widthMeters && bgImage.heightMeters) {
        updateBounds({ x: bgImage.x - bgImage.widthMeters / 2, y: bgImage.y - bgImage.heightMeters / 2 });
        updateBounds({ x: bgImage.x + bgImage.widthMeters / 2, y: bgImage.y + bgImage.heightMeters / 2 });
      }

      elements.forEach(el => {
        if (el.type === 'island') {
          const island = el as any;
          if (island.points && island.points.length > 0) {
            const hasBezier = island.cpLeft && island.cpRight && island.cpLeft.length === island.points.length;
            const bPoints = hasBezier 
              ? sampleClosedBezierLoop(island.points, island.cpLeft, island.cpRight, 20)
              : island.points;
            bPoints.forEach(updateBounds);
          }
        } else if (el.type === 'crosswalk') {
          const cw = el as any;
          if (cw.pA1) updateBounds(cw.pA1);
          if (cw.pA2) updateBounds(cw.pA2);
          if (cw.pB1) updateBounds(cw.pB1);
          if (cw.pB2) updateBounds(cw.pB2);
        } else if (el.type === 'three_center_curve') {
          const curve = el as any;
          if (curve.points && curve.points.length > 0) {
            curve.points.forEach(updateBounds);
          }
        } else if (el.type === 'text') {
          const txt = el as any;
          if (txt.p) {
            updateBounds(txt.p);
            updateBounds({ x: txt.p.x - 3, y: txt.p.y - 1 });
            updateBounds({ x: txt.p.x + 3, y: txt.p.y + 1 });
          }
        } else if (el.type === 'sketch_circle') {
          const circ = el as any;
          if (circ.center && circ.radius !== undefined) {
            updateBounds({ x: circ.center.x - circ.radius, y: circ.center.y });
            updateBounds({ x: circ.center.x + circ.radius, y: circ.center.y });
            updateBounds({ x: circ.center.x, y: circ.center.y - circ.radius });
            updateBounds({ x: circ.center.x, y: circ.center.y + circ.radius });
          }
        } else {
          const path = el as any;
          if (path.points && path.points.length > 0) {
            if (path.points.length === 1) {
              updateBounds(path.points[0]);
            } else {
              for (let j = 0; j < path.points.length - 1; j++) {
                const pStart = path.points[j];
                const cpStart = (path.cpRight && path.cpRight[j]) || pStart;
                const cpEnd = (path.cpLeft && path.cpLeft[j + 1]) || path.points[j + 1];
                const pEnd = path.points[j + 1];
                const samples = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 15);
                samples.forEach(updateBounds);
              }
            }
          } else if (path.p1 && path.p2) {
            updateBounds(path.p1);
            updateBounds(path.p2);
          }
        }
      });

      // 2. Add 10% safety padding margin as requested
      const wRaw = (maxX !== -Infinity && minX !== Infinity) ? (maxX - minX) : 0;
      const hRaw = (maxY !== -Infinity && minY !== Infinity) ? (maxY - minY) : 0;
      
      const activeWRaw = wRaw > 0 ? wRaw : 20;
      const activeHRaw = hRaw > 0 ? hRaw : 20;

      const wOffset = activeWRaw * 0.10;
      const hOffset = activeHRaw * 0.10;

      const finalMinX = (minX === Infinity) ? -20 : minX - wOffset;
      const finalMaxX = (maxX === -Infinity) ? 20 : maxX + wOffset;
      const finalMinY = (minY === Infinity) ? -20 : minY - hOffset;
      const finalMaxY = (maxY === -Infinity) ? 20 : maxY + hOffset;

      let finalW = finalMaxX - finalMinX;
      let finalH = finalMaxY - finalMinY;

      if (isNaN(finalW) || finalW <= 0.001) finalW = 40;
      if (isNaN(finalH) || finalH <= 0.001) finalH = 40;

      // 3. Create high resolution offscreen canvas
      const imgWidth = 2048;
      const imgHeight = Math.max(512, Math.round(imgWidth * (finalH / finalW)));

      const offscreen = document.createElement('canvas');
      offscreen.width = imgWidth;
      offscreen.height = imgHeight;
      const ctx = offscreen.getContext('2d');
      if (!ctx) {
        showToast('無法取得 2D Canvas Context！', 'error');
        return;
      }

      // Fill dark Blueprint blueprint theme background
      ctx.fillStyle = '#0f1115';
      ctx.fillRect(0, 0, imgWidth, imgHeight);

      // Zoom mapping ratios
      const zoom = imgWidth / finalW;
      const worldToScreen = (wx: number, wy: number) => {
        const sx = (wx - finalMinX) * zoom;
        const sy = imgHeight - (wy - finalMinY) * zoom;
        return { x: sx, y: sy };
      };

      const drawElementsAndSave = () => {
        try {
          // Draw reference grid ONLY if there's no background image or if it's calibrated
          const shouldShowGrid = !bgImage || bgImage.isCalibrated;
          if (shouldShowGrid) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.lineWidth = 1;
            for (let x = Math.floor(finalMinX); x <= Math.ceil(finalMaxX); x += 2) {
              ctx.beginPath();
              const s1 = worldToScreen(x, finalMinY);
              const s2 = worldToScreen(x, finalMaxY);
              ctx.moveTo(s1.x, s1.y);
              ctx.lineTo(s2.x, s2.y);
              ctx.stroke();
            }
            for (let y = Math.floor(finalMinY); y <= Math.ceil(finalMaxY); y += 2) {
              ctx.beginPath();
              const s1 = worldToScreen(finalMinX, y);
              const s2 = worldToScreen(finalMaxX, y);
              ctx.moveTo(s1.x, s1.y);
              ctx.lineTo(s2.x, s2.y);
              ctx.stroke();
            }
          }

          // Render elements with constant offsets
          elements.forEach(el => {
            if (el.type === 'island') {
              const island = el as IslandElement;
              if (island.points && island.points.length > 0) {
                const hasBezier = island.cpLeft && island.cpRight && island.cpLeft.length === island.points.length;
                const boundaryPoints = hasBezier 
                  ? sampleClosedBezierLoop(island.points, island.cpLeft, island.cpRight, 20)
                  : island.points;

                ctx.beginPath();
                boundaryPoints.forEach((pt, idx) => {
                  const s = worldToScreen(pt.x, pt.y);
                  if (idx === 0) ctx.moveTo(s.x, s.y);
                  else ctx.lineTo(s.x, s.y);
                });
                ctx.closePath();
                ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
                ctx.fill();
                ctx.strokeStyle = island.color || '#ffffff';
                ctx.lineWidth = Math.max(1.5, zoom * 0.1);
                ctx.stroke();

                if (island.hasHatching && boundaryPoints.length >= 3) {
                  const hatching = generateHatchingLines(boundaryPoints, 0.45, 45);
                  ctx.strokeStyle = island.color || 'rgba(255, 255, 255, 0.75)';
                  ctx.lineWidth = Math.max(1.5, zoom * 0.12);
                  ctx.beginPath();
                  hatching.forEach(hl => {
                    const s1 = worldToScreen(hl.p1.x, hl.p1.y);
                    const s2 = worldToScreen(hl.p2.x, hl.p2.y);
                    ctx.moveTo(s1.x, s1.y);
                    ctx.lineTo(s2.x, s2.y);
                  });
                  ctx.stroke();
                }
              }
            } else if (el.type === 'crosswalk') {
              const cw = el as any;
              const stripeWidth = cw.stripeWidth ?? 0.4;
              const stripeGap = cw.stripeGap ?? 0.4;
              const stripes = generateCrosswalkStripes(cw.pA1, cw.pA2, cw.pB1, cw.pB2, stripeWidth, stripeGap);
              ctx.save();
              ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
              stripes.forEach((stripe) => {
                ctx.beginPath();
                const s1 = worldToScreen(stripe.p1.x, stripe.p1.y);
                const s2 = worldToScreen(stripe.p2.x, stripe.p2.y);
                const s3 = worldToScreen(stripe.p3.x, stripe.p3.y);
                const s4 = worldToScreen(stripe.p4.x, stripe.p4.y);
                ctx.moveTo(s1.x, s1.y);
                ctx.lineTo(s2.x, s2.y);
                ctx.lineTo(s3.x, s3.y);
                ctx.lineTo(s4.x, s4.y);
                ctx.closePath();
                ctx.fill();
              });
              ctx.restore();
            } else if (el.type === 'parking_space') {
              const pk = el as any;
              const L = pk.length || 5.0;
              const W = pk.width || 2.0;
              const angle = pk.angle !== undefined ? pk.angle : Math.atan2(pk.p2.y - pk.p1.y, pk.p2.x - pk.p1.x);

              const s1 = worldToScreen(pk.p1.x, pk.p1.y);

              ctx.save();
              ctx.translate(s1.x, s1.y);
              ctx.rotate(-angle);

              ctx.lineCap = 'round';
              ctx.lineJoin = 'round';
              ctx.strokeStyle = '#ffffff';
              ctx.lineWidth = Math.max(1.5, zoom * 0.1);
              ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';

              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(L * zoom, 0);
              ctx.lineTo(L * zoom, -W * zoom);
              ctx.lineTo(0, -W * zoom);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();

              if (zoom > 7) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
                const fontSizePx = Math.max(8, zoom * 0.25);
                ctx.font = `${fontSizePx}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(`${pk.slotType === 'car' ? '汽車' : '機車'} ${W}x${L}m`, (L / 2) * zoom, -(W / 2) * zoom);
              }
              ctx.restore();
            } else if (el.type === 'parking_zone') {
              const zone = el as any;
              const ref = getLineBezierRepresentation(zone);
              if (ref) {
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
                ctx.lineWidth = Math.max(1.0, zoom * 0.05);
                ctx.setLineDash([4, 6]);
                ctx.beginPath();
                const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
                segPts.forEach((pt, j) => {
                  const s = worldToScreen(pt.x, pt.y);
                  if (j === 0) ctx.moveTo(s.x, s.y);
                  else ctx.lineTo(s.x, s.y);
                });
                ctx.stroke();
                ctx.restore();
              }

              const slots = generateParkingZoneSlots(zone);
              slots.forEach((slot) => {
                ctx.save();
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = Math.max(1.5, zoom * 0.1);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';

                const s1 = worldToScreen(slot.corners[0].x, slot.corners[0].y);
                const s2 = worldToScreen(slot.corners[1].x, slot.corners[1].y);
                const s3 = worldToScreen(slot.corners[2].x, slot.corners[2].y);
                const s4 = worldToScreen(slot.corners[3].x, slot.corners[3].y);

                ctx.beginPath();
                ctx.moveTo(s1.x, s1.y);
                ctx.lineTo(s2.x, s2.y);
                ctx.lineTo(s3.x, s3.y);
                ctx.lineTo(s4.x, s4.y);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                if (zoom > 7) {
                  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
                  const fontSizePx = Math.max(8, zoom * 0.25);
                  ctx.font = `${fontSizePx}px sans-serif`;
                  ctx.textAlign = 'center';
                  ctx.textBaseline = 'middle';
                  const cx = (s1.x + s2.x + s3.x + s4.x) / 4;
                  const cy = (s1.y + s2.y + s3.y + s4.y) / 4;
                  ctx.fillText(`${slot.slotType === 'car' ? '汽車' : '機車'} ${slot.width}x${slot.length}m`, cx, cy);
                }
                ctx.restore();
              });
            } else if (el.type === 'three_center_curve') {
              const curve = el as any;
              if (curve.points && curve.points.length > 0) {
                ctx.save();
                ctx.strokeStyle = '#3b82f6';
                ctx.lineWidth = Math.max(2, zoom * 0.15);
                ctx.lineCap = 'square';
                ctx.lineJoin = 'miter';
                ctx.beginPath();
                for (let i = 0; i < curve.points.length; i++) {
                  const sPt = worldToScreen(curve.points[i].x, curve.points[i].y);
                  if (i === 0) ctx.moveTo(sPt.x, sPt.y);
                  else ctx.lineTo(sPt.x, sPt.y);
                }
                ctx.stroke();
                ctx.restore();
              }
            } else if (el.type === 'text') {
              const txt = el as TextElement;
              const s = worldToScreen(txt.p.x, txt.p.y);
              ctx.fillStyle = '#e2e8f0';
              const fontSizePx = Math.max(12, txt.fontSize * zoom);
              ctx.font = `${fontSizePx}px sans-serif`;
              ctx.textBaseline = 'middle';
              ctx.textAlign = 'center';
              ctx.fillText(txt.text, s.x, s.y);
            } else if (el.type === 'sketch_circle') {
              const circ = el as any;
              const s = worldToScreen(circ.center.x, circ.center.y);
              ctx.strokeStyle = 'rgba(14, 165, 233, 0.35)'; // translucent blue
              ctx.lineWidth = Math.max(1.0, zoom * 0.05);
              ctx.setLineDash([Math.max(5, zoom * 0.1), Math.max(5, zoom * 0.1)]);
              ctx.beginPath();
              ctx.arc(s.x, s.y, circ.radius * zoom, 0, 2 * Math.PI);
              ctx.stroke();
              ctx.setLineDash([]);
            } else {
              const line = el as any;
              const ref = getLineBezierRepresentation(line);
              if (ref && ref.points && ref.points.length > 0) {
                ctx.lineCap = 'butt';
                ctx.setLineDash([]);
                
                if (el.type === 'guideline') {
                  ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
                  ctx.setLineDash([5, 8]);
                  ctx.lineWidth = Math.max(1.5, zoom * 0.08);
                  ctx.beginPath();
                  const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
                  segPts.forEach((pt, j) => {
                    const s = worldToScreen(pt.x, pt.y);
                    if (j === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                  });
                  ctx.stroke();
                  ctx.setLineDash([]);
                } else if (el.type === 'yellow_double') {
                  ctx.strokeStyle = '#f59e0b';
                  ctx.lineWidth = Math.max(1.5, zoom * 0.1);
                  
                  const leftOffset = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0.1, 25);
                  const rightOffset = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, -0.1, 25);
                  
                  ctx.beginPath();
                  leftOffset.forEach((pt, j) => {
                    const s = worldToScreen(pt.x, pt.y);
                    if (j === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                  });
                  ctx.stroke();
                  
                  ctx.beginPath();
                  rightOffset.forEach((pt, j) => {
                    const s = worldToScreen(pt.x, pt.y);
                    if (j === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                  });
                  ctx.stroke();
                } else if (el.type === 'white_dashed') {
                  ctx.strokeStyle = '#ffffff';
                  ctx.lineWidth = el.isLeftTurnGuide ? Math.max(1.5, zoom * 0.3) : Math.max(1.5, zoom * 0.12);
                  ctx.setLineDash(el.isLeftTurnGuide ? [zoom * 1.0, zoom * 2.0] : [zoom * 4.0, zoom * 6.0]);
                  ctx.beginPath();
                  const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
                  segPts.forEach((pt, j) => {
                    const s = worldToScreen(pt.x, pt.y);
                    if (j === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                  });
                  ctx.stroke();
                  ctx.setLineDash([]);
                } else if (el.type === 'yellow_dashed') {
                  ctx.strokeStyle = '#eab308'; // Yellow-500 yellow_dashed
                  ctx.lineWidth = el.isLeftTurnGuide ? Math.max(1.5, zoom * 0.3) : Math.max(1.5, zoom * 0.12);
                  ctx.setLineDash(el.isLeftTurnGuide ? [zoom * 1.0, zoom * 2.0] : [zoom * 4.0, zoom * 6.0]);
                  ctx.beginPath();
                  const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
                  segPts.forEach((pt, j) => {
                    const s = worldToScreen(pt.x, pt.y);
                    if (j === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                  });
                  ctx.stroke();
                  ctx.setLineDash([]);
                } else if (el.type === 'white_solid') {
                  ctx.strokeStyle = '#ffffff';
                  ctx.lineWidth = Math.max(1.5, zoom * 0.15);
                  ctx.beginPath();
                  const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
                  segPts.forEach((pt, j) => {
                    const s = worldToScreen(pt.x, pt.y);
                    if (j === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                  });
                  ctx.stroke();
                } else if (el.type === 'smart_path') {
                  ctx.strokeStyle = '#06b6d4';
                  ctx.lineWidth = Math.max(1.5, zoom * 0.15);
                  ctx.beginPath();
                  const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
                  segPts.forEach((pt, j) => {
                    const s = worldToScreen(pt.x, pt.y);
                    if (j === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                  });
                  ctx.stroke();
                } else if (el.type === 'crossing_dashed') {
                  ctx.strokeStyle = '#ffffff';
                  ctx.lineWidth = Math.max(3.0, zoom * 0.3);
                  ctx.setLineDash([zoom * 1.0, zoom * 2.0]);
                  ctx.beginPath();
                  const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
                  segPts.forEach((pt, j) => {
                    const s = worldToScreen(pt.x, pt.y);
                    if (j === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                  });
                  ctx.stroke();
                  ctx.setLineDash([]);
                } else if (el.type === 'stop_line') {
                  ctx.strokeStyle = '#ffffff';
                  ctx.lineWidth = Math.max(3.5, zoom * 0.35);
                  ctx.beginPath();
                  const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
                  segPts.forEach((pt, j) => {
                    const s = worldToScreen(pt.x, pt.y);
                    if (j === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                  });
                  ctx.stroke();
                } else if (el.type === 'BuildingLine') {
                  ctx.strokeStyle = '#00ffff';
                  ctx.lineWidth = Math.max(1.5, zoom * 0.12);
                  ctx.beginPath();
                  const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 25);
                  segPts.forEach((pt, j) => {
                    const s = worldToScreen(pt.x, pt.y);
                    if (j === 0) ctx.moveTo(s.x, s.y);
                    else ctx.lineTo(s.x, s.y);
                  });
                  ctx.stroke();
                } else if (el.type === 'Sidewalk') {
                  const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 30);
                  if (segPts.length >= 2) {
                    ctx.save();
                    ctx.fillStyle = '#A9A9A9';
                    ctx.strokeStyle = '#1e293b';
                    ctx.lineWidth = Math.max(1.5, zoom * 0.1);
                    ctx.beginPath();
                    segPts.forEach((pt, idx) => {
                      const s = worldToScreen(pt.x, pt.y);
                      if (idx === 0) ctx.moveTo(s.x, s.y);
                      else ctx.lineTo(s.x, s.y);
                    });
                    ctx.closePath();
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                  }
                } else if (el.type === 'yield_line') {
                  const segPts = getPathOffsetCurves(ref.points, ref.cpLeft, ref.cpRight, 0, 30);
                  if (segPts.length >= 2) {
                    const cumulativeDist: number[] = [0];
                    let totalLen = 0;
                    for (let k = 1; k < segPts.length; k++) {
                      totalLen += distance(segPts[k - 1], segPts[k]);
                      cumulativeDist.push(totalLen);
                    }

                    const spacing = 0.65;
                    const W = 0.40;
                    const H = 0.55;

                    ctx.save();
                    ctx.fillStyle = '#ffffff';
                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
                    ctx.lineWidth = 1;

                    for (let d = spacing / 2; d < totalLen; d += spacing) {
                      let idx = 0;
                      while (idx < cumulativeDist.length - 2 && cumulativeDist[idx + 1] < d) {
                        idx++;
                      }
                      const segLen = cumulativeDist[idx + 1] - cumulativeDist[idx];
                      const t = segLen > 0.0001 ? (d - cumulativeDist[idx]) / segLen : 0;
                      
                      const C = lerp(segPts[idx], segPts[idx + 1], t);
                      const rawTangent = { x: segPts[idx + 1].x - segPts[idx].x, y: segPts[idx + 1].y - segPts[idx].y };
                      const tangent = normalize(rawTangent);
                      const normal = { x: -tangent.y, y: tangent.x };

                      const B1 = { x: C.x - tangent.x * (W / 2), y: C.y - tangent.y * (W / 2) };
                      const B2 = { x: C.x + tangent.x * (W / 2), y: C.y + tangent.y * (W / 2) };
                      const V = { x: C.x + normal.x * H, y: C.y + normal.y * H };

                      const b1S = worldToScreen(B1.x, B1.y);
                      const b2S = worldToScreen(B2.x, B2.y);
                      const vS = worldToScreen(V.x, V.y);

                      ctx.beginPath();
                      ctx.moveTo(b1S.x, b1S.y);
                      ctx.lineTo(b2S.x, b2S.y);
                      ctx.lineTo(vS.x, vS.y);
                      ctx.closePath();
                      ctx.fill();
                      ctx.stroke();
                    }
                    ctx.restore();
                  }
                }
              }
            }
          });

          // 4. Download png file trigger and set exported image state modal
          const dataUrl = offscreen.toDataURL('image/png');
          setExportedImage(dataUrl);

          // Try automatic download trigger as well
          try {
            const a = document.createElement('a');
            a.href = dataUrl;
            a.download = `WebTrafficCAD_Blueprint_${new Date().toISOString().slice(0, 10)}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
          } catch (downloadErr) {
            console.warn("Auto automatic file download blocked or failed, relying on fallback dialog.", downloadErr);
          }
        } catch (innerErr) {
          showToast('渲染工程圖或轉換為圖片時發生錯誤：' + (innerErr as Error).message, 'error');
        }
      };

      if (bgImage && bgImage.src) {
        const bgImg = new Image();
        if (!bgImage.src.startsWith('data:')) {
          bgImg.crossOrigin = "anonymous"; // Safe mode for canvas save
        }
        bgImg.onload = () => {
          // Draw image onto canvas based on its world coordinates
          const tl = worldToScreen(bgImage.x - bgImage.widthMeters / 2, bgImage.y + bgImage.heightMeters / 2); // Top left
          const br = worldToScreen(bgImage.x + bgImage.widthMeters / 2, bgImage.y - bgImage.heightMeters / 2); // Bottom right
          const sW = br.x - tl.x;
          const sH = br.y - tl.y;
          
          ctx.save();
          ctx.globalAlpha = bgImage.opacity !== undefined ? bgImage.opacity : 0.5;
          ctx.drawImage(bgImg, tl.x, tl.y, sW, sH);
          ctx.restore();
          
          drawElementsAndSave();
        };
        bgImg.onerror = (err) => {
          console.warn("Background image failed to load for high-res PNG export, using fallback", err);
          drawElementsAndSave(); // fallback
        };
        bgImg.src = bgImage.src;
      } else {
        drawElementsAndSave();
      }
    } catch (outerErr) {
      showToast('準備匯出功能時發生錯誤：' + (outerErr as Error).message, 'error');
    }
  };

  return (
    <div id="webtrafficcad-app-root" className="flex flex-col h-screen w-screen bg-[#0a0b0e] text-slate-300 overflow-hidden font-sans">
      
      {/* CAD App Elegant Top Header */}
      <header className="flex items-center justify-between px-6 py-3 bg-[#14161c] border-b border-[#2d3039] shrink-0 select-none h-12 z-20">
        <div className="flex items-center gap-6">
          <div>
            <h1 className="text-sm font-black tracking-wider uppercase bg-gradient-to-r from-blue-500 to-indigo-300 bg-clip-text text-transparent">
              WebTrafficCAD
            </h1>
          </div>

          {/* App Mode Switcher (左右合體按鈕) */}
          <div className="flex items-center bg-[#0a0b0e] border border-[#2d3039] rounded-lg p-0.5 select-none shrink-0">
            <button
              onClick={() => setAppMode('cad')}
              className={`px-4 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                appMode === 'cad'
                  ? 'bg-blue-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              CAD 繪圖
            </button>
            <button
              onClick={() => {
                setAppMode('simulation');
                setSimDrawMode('select');
                setActiveTool('select'); // 預設進去為選擇或無操作狀態
                setSelectedElement(null);
                setSelectedElementIds([]);
              }}
              className={`px-4 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                appMode === 'simulation'
                  ? 'bg-blue-600 text-white shadow-sm font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              車流軌跡模擬
            </button>
          </div>
        </div>

        {/* Global Control Group: Undo, Redo, Exports, and Background Image Management */}
        <div className="flex items-center gap-3">
          {/* Clear Canvas Button */}
          <button
            onClick={() => {
              if (appMode === 'cad') {
                handleClearCanvas();
              } else {
                handleSimClearAll();
              }
            }}
            disabled={appMode === 'cad' ? elements.length === 0 : (simLockedPaths.length === 0 && simRawPoints.length === 0)}
            className="flex items-center justify-center w-8 h-8 rounded bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-[#1f2229] disabled:cursor-not-allowed transition-all text-slate-350 cursor-pointer"
            title={appMode === 'cad' ? "清空 CAD 標線畫布" : "一次清除所有軌跡"}
          >
            <Trash2 className="w-4 h-4 text-red-400" />
          </button>

          {/* Undo Button (Symbol Only) */}
          <button
            onClick={appMode === 'cad' ? handleUndo : handleSimUndoLastNode}
            disabled={appMode === 'cad' ? historyStack.length === 0 : simRawPoints.length === 0}
            className="flex items-center justify-center w-8 h-8 rounded bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-[#1f2229] disabled:cursor-not-allowed transition-all text-slate-300 cursor-pointer"
            title="撤銷 (Ctrl+Z)"
          >
            <RotateCcw className="w-4 h-4 text-slate-400" />
          </button>

          {/* Redo Button (Symbol Only) */}
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="flex items-center justify-center w-8 h-8 rounded bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-[#1f2229] disabled:cursor-not-allowed transition-all text-slate-300 cursor-pointer"
            title="重做 (Ctrl+Y)"
          >
            <RotateCw className="w-4 h-4 text-slate-400" />
          </button>

          <div className="h-4 w-px bg-[#2d3039]" />

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

          <div className="h-4 w-px bg-[#2d3039]" />

          {/* Export Dropdown */}
          <div id="export-dropdown-container" className="relative shrink-0">
            <button
              id="export-dropdown-toggle-btn"
              onClick={() => setIsExportDropdownOpen(!isExportDropdownOpen)}
              className="flex items-center gap-1.5 h-8 px-3 text-xs rounded bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 text-blue-400 font-medium cursor-pointer transition-all shrink-0"
              title="匯出工程圖 (PNG) 或 AutoCAD DXF 向量檔"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>匯出</span>
              <ChevronDown className="w-3 h-3 text-blue-400/70" />
            </button>
            {isExportDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-48 rounded bg-[#1f2229] border border-[#2d3039] shadow-xl py-1 z-30">
                <button
                  onClick={() => {
                    handleExportPNG();
                    setIsExportDropdownOpen(false);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-slate-350 hover:bg-slate-800 hover:text-white transition-all cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-blue-400" />
                  <span>匯出工程圖 (PNG)</span>
                </button>
                <button
                  onClick={() => {
                    handleExportDXF();
                    setIsExportDropdownOpen(false);
                  }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-slate-350 hover:bg-slate-800 hover:text-white transition-all cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  <span>匯出 AutoCAD DXF 向量檔</span>
                </button>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-[#2d3039]" />

          {/* Grid Settings Popover Button */}
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
              <span>網格背景設定</span>
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

          {/* Snap Settings Popover Button */}
          <div className="relative">
            <button
              id="snap-settings-toggle-btn"
              onClick={() => {
                setIsSnapSettingsOpen(!isSnapSettingsOpen);
                setIsGridSettingsOpen(false);
              }}
              className={`flex items-center gap-1.5 h-8 px-3 text-xs rounded transition-all cursor-pointer font-medium ${
                isSnapSettingsOpen || (snapToGrid || snapToEndpoint || snapToMidpoint || snapToNearest)
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/40 shadow-[0_0_8px_rgba(0,255,255,0.15)] bg-[#1e222b]'
                  : 'bg-[#1f2229] border border-[#2d3039] hover:bg-slate-800 text-slate-300'
              }`}
              title="鎖點設定 (Snap Settings)"
            >
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              <span>SNAP 鎖點設定</span>
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
                </div>
              </>
            )}
          </div>

          <div className="h-4 w-px bg-[#2d3039]" />

          {/* Integrated Design Background Image Manager */}
          {!bgImage ? (
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
              <span>上傳底圖</span>
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
          )}

        </div>
      </header>

      {/* Main CAD Interactive Workspace Grid */}
      <div className="flex flex-1 min-h-0 w-full relative">
        {/* Left Sidebar (CAD Toolbar / Simulation control) */}
        {appMode === 'cad' ? (
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
        ) : (
          <div 
            id="left-sim-panel" 
            className="flex flex-col bg-[#14161c] border-r border-[#2d3039] w-[110px] h-full p-2 justify-between select-none overflow-y-auto shrink-0 space-y-4"
          >
            <div className="space-y-4">
              {/* SIM Brand Mini Header */}
              <div className="flex flex-col items-center justify-center py-2 border-b border-[#2d3039]/40 mb-1 text-center">
                <div className="w-[42px] h-[42px] rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center font-black text-white text-base shadow-lg shadow-indigo-500/20 mb-1.5 border border-indigo-400/20">
                  SIM
                </div>
                <span className="text-xs font-black text-indigo-400 tracking-widest uppercase">軌跡模擬</span>
              </div>
 
              {/* 選擇按鈕 */}
              <div className="space-y-1">
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      setSimDrawMode('select');
                      setSimIsIntersectionMode(false);
                    }}
                    className={`w-full py-2.5 rounded-lg flex flex-col items-center justify-center gap-1.5 transition-all border cursor-pointer text-[11px] font-black ${
                      simDrawMode === 'select' && !simIsIntersectionMode
                        ? 'bg-indigo-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_8px_rgba(0,255,255,0.25)]'
                        : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229] hover:text-slate-200'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" fill="currentColor" />
                      <path d="M13 13l6 6" />
                    </svg>
                    <span>選擇與編輯</span>
                  </button>
                </div>
              </div>
 
              {/* 軌跡路徑模式 */}
              <div className="space-y-1">
                <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider text-center border-b border-[#2d3039]/30 pb-0.5">
                  軌跡路徑
                </div>
                <div className="flex flex-col gap-1.5 items-center">
                  {/* 1. 鋼筆繪製 (SmartPath) */}
                  <button
                    type="button"
                    disabled={(simRawPoints.length > 0 && (simDrawMode !== 'smartpath' || simIsIntersectionMode)) || (editingPathId !== null && simDrawMode !== 'smartpath')}
                    onClick={() => {
                      setSimDrawMode('smartpath');
                      setSimIsIntersectionMode(false);
                    }}
                    className={`w-full py-2.5 rounded-lg flex flex-col items-center justify-center gap-1.5 transition-all border text-[11px] font-black ${
                      (simRawPoints.length > 0 && (simDrawMode !== 'smartpath' || simIsIntersectionMode)) || (editingPathId !== null && simDrawMode !== 'smartpath')
                        ? 'opacity-30 cursor-not-allowed text-slate-500 bg-[#0f1115]/20 border-transparent'
                        : !simIsIntersectionMode && simDrawMode === 'smartpath'
                        ? 'bg-indigo-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_8px_rgba(0,255,255,0.25)] cursor-pointer'
                        : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229] hover:text-slate-200 cursor-pointer'
                    }`}
                    title="使用鋼筆繪製貝茲曲線軌跡"
                  >
                    <PenTool className="w-[18px] h-[18px]" />
                    <span>鋼筆繪製</span>
                  </button>

                  {/* 2. 點選繪製 (Click) */}
                  <button
                    type="button"
                    disabled={(simRawPoints.length > 0 && (simDrawMode !== 'click' || simIsIntersectionMode)) || (editingPathId !== null && simDrawMode !== 'click')}
                    onClick={() => {
                      setSimDrawMode('click');
                      setSimIsIntersectionMode(false);
                    }}
                    className={`w-full py-2.5 rounded-lg flex flex-col items-center justify-center gap-1.5 transition-all border text-[11px] font-black ${
                      (simRawPoints.length > 0 && (simDrawMode !== 'click' || simIsIntersectionMode)) || (editingPathId !== null && simDrawMode !== 'click')
                        ? 'opacity-30 cursor-not-allowed text-slate-500 bg-[#0f1115]/20 border-transparent'
                        : !simIsIntersectionMode && simDrawMode === 'click'
                        ? 'bg-indigo-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_8px_rgba(0,255,255,0.25)] cursor-pointer'
                        : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229] hover:text-slate-200 cursor-pointer'
                    }`}
                    title="自由點擊繪製折線軌跡"
                  >
                    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="18" r="2.5" fill="currentColor" stroke="none" />
                      <circle cx="18" cy="6" r="2.5" fill="currentColor" stroke="none" />
                      <line x1="8" y1="16" x2="16" y2="8" strokeDasharray="3 3" />
                    </svg>
                    <span>點選繪製</span>
                  </button>

                  {/* 3. 筆刷繪製 (Drag) */}
                  <button
                    type="button"
                    disabled={(simRawPoints.length > 0 && (simDrawMode !== 'drag' || simIsIntersectionMode)) || (editingPathId !== null && simDrawMode !== 'drag')}
                    onClick={() => {
                      setSimDrawMode('drag');
                      setSimIsIntersectionMode(false);
                    }}
                    className={`w-full py-2.5 rounded-lg flex flex-col items-center justify-center gap-1.5 transition-all border text-[11px] font-black ${
                      (simRawPoints.length > 0 && (simDrawMode !== 'drag' || simIsIntersectionMode)) || (editingPathId !== null && simDrawMode !== 'drag')
                        ? 'opacity-30 cursor-not-allowed text-slate-500 bg-[#0f1115]/20 border-transparent'
                        : !simIsIntersectionMode && simDrawMode === 'drag'
                        ? 'bg-indigo-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_8px_rgba(0,255,255,0.25)] cursor-pointer'
                        : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229] hover:text-slate-200 cursor-pointer'
                    }`}
                    title="拖曳筆刷自由手繪軌跡"
                  >
                    <Paintbrush className="w-[18px] h-[18px]" />
                    <span>筆刷繪製</span>
                  </button>

                  {/* 4. 路口轉彎軌跡 (Intersection) */}
                  <button
                    type="button"
                    disabled={(simRawPoints.length > 0 && !simIsIntersectionMode) || (editingPathId !== null && !simIsIntersectionMode)}
                    onClick={() => {
                      setSimIsIntersectionMode(true);
                      setSimP0X(null);
                      setSimP0Y(null);
                      setSimP3X(null);
                      setSimP3Y(null);
                      setSimIntersectionPickState("p0");
                    }}
                    className={`w-full py-2.5 rounded-lg flex flex-col items-center justify-center gap-1.5 transition-all border text-[11px] font-black ${
                      (simRawPoints.length > 0 && !simIsIntersectionMode) || (editingPathId !== null && !simIsIntersectionMode)
                        ? 'opacity-30 cursor-not-allowed text-slate-500 bg-[#0f1115]/20 border-transparent'
                        : simIsIntersectionMode
                        ? 'bg-indigo-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_8px_rgba(0,255,255,0.25)] cursor-pointer'
                        : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229] hover:text-slate-200 cursor-pointer'
                    }`}
                    title="在路口依照切線比率與偏移距離生成引導軌跡"
                  >
                    <svg viewBox="0 0 24 24" className="w-[18px] h-[18px]" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M2 9Q9 9 9 2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M15 2Q15 9 22 9" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M22 15Q15 15 15 22" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M9 22Q9 15 2 15" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <span>路口轉彎軌跡</span>
                  </button>
                </div>
              </div>
            </div>
 
            {/* 圖層顯示偏好區塊放在左側面板最下方 */}
            <div className="space-y-1.5 pt-2 border-t border-[#2d3039]/40 mt-auto select-none w-full">
              <div className="text-[10px] font-black text-slate-500 uppercase tracking-wider text-center pb-0.5">
                圖層顯示偏好
              </div>
              <div className="flex flex-col gap-1.5 w-full">
                {/* 1. 車流包絡線軌跡設定 */}
                <button
                  type="button"
                  onClick={() => setSimShowSweptPath(!simShowSweptPath)}
                  className={`w-full h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all border cursor-pointer ${
                    simShowSweptPath
                      ? 'bg-indigo-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_6px_rgba(0,255,255,0.25)]'
                      : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229]'
                  }`}
                  title="車流包絡線"
                >
                  <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M10 4v16M14 4v16" strokeDasharray="2 2" />
                    <rect x="8" y="6" width="8" height="12" opacity="0.3" fill="currentColor" />
                    <line x1="8" y1="6" x2="8" y2="18" />
                    <line x1="16" y1="6" x2="16" y2="18" />
                  </svg>
                  <span className="text-[9px] leading-none font-medium">包絡線</span>
                </button>

                {/* 2. 前後軸中心軌跡 */}
                <button
                  type="button"
                  onClick={() => setSimShowAxleTracks(!simShowAxleTracks)}
                  className={`w-full h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all border cursor-pointer ${
                    simShowAxleTracks
                      ? 'bg-indigo-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_6px_rgba(0,255,255,0.2)]'
                      : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229]'
                  }`}
                  title="前後軸中心軌跡"
                >
                  <svg viewBox="0 0 24 24" className="w-5.5 h-5.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <line x1="12" y1="4" x2="12" y2="20" />
                    <circle cx="12" cy="7" r="2" fill="currentColor" />
                    <circle cx="12" cy="17" r="2" fill="currentColor" />
                  </svg>
                  <span className="text-[9px] leading-none font-medium">軸中心</span>
                </button>

                {/* 3. 連續骨架投影 */}
                <button
                  type="button"
                  onClick={() => setSimShowBodyWireframe(!simShowBodyWireframe)}
                  className={`w-full h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all border cursor-pointer ${
                    simShowBodyWireframe
                      ? 'bg-indigo-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_6px_rgba(0,255,255,0.25)]'
                      : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229]'
                  }`}
                  title="連續骨架投影"
                >
                  <svg viewBox="0 0 24 24" className="w-[22px] h-[22px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="6" y="4" width="12" height="16" rx="1" />
                    <line x1="12" y1="4" x2="12" y2="20" strokeDasharray="2 2" />
                    <line x1="6" y1="10" x2="18" y2="10" />
                    <line x1="6" y1="14" x2="18" y2="14" />
                  </svg>
                  <span className="text-[9px] leading-none font-medium">車架</span>
                </button>

                {/* 4. 路口輔助線 或 佔位格 */}
                {simIsIntersectionMode ? (
                  <button
                    type="button"
                    onClick={() => setSimShowIntersectionHelpers(!simShowIntersectionHelpers)}
                    className={`w-full h-14 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all border cursor-pointer ${
                      simShowIntersectionHelpers
                        ? 'bg-indigo-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_6px_rgba(0,255,255,0.25)]'
                        : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229]'
                    }`}
                    title="路口輔助線"
                  >
                    <svg viewBox="0 0 24 24" className="w-5.5 h-5.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M4 12h16M12 4v16" strokeDasharray="2 2" />
                      <path d="M8 8l8 8M16 8l-8 8" />
                    </svg>
                    <span className="text-[9px] leading-none font-medium">輔助線</span>
                  </button>
                ) : (
                  <div className="w-full h-14 rounded-lg border border-dashed border-[#2d3039]/20 bg-[#0f1115]/10" />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Central CAD Infinite Canvas */}
        <div className="flex-1 h-full min-w-0 relative flex flex-col">
          <CadCanvas 
            elements={elements}
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
          onSelectLockedPath={handleSelectLockedPath}
          onDeselectAll={() => {
            setSelectedElement(null);
            if (appMode === 'simulation') {
              // Save current editing state back to locked path before clearing,
              // to prevent orphaned simRawPoints creating duplicate paths later.
              if (editingPathId && simRawPoints.length > 0) {
                setSimLockedPaths(prev => prev.map(path =>
                  path.id === editingPathId
                    ? { ...path, rawPoints: [...simRawPoints], trajectory: [...simTrajectory], config: { ...simConfig } }
                    : path
                ));
              }
              setEditingPathId(null);
              setSimRawPoints([]);
            }
          }}

           // Simulation Props
           appMode={appMode}
           simConfig={simConfig}
           setSimConfig={setSimConfig}
           simControllerMode={simControllerMode}
           simRawPoints={simRawPoints}
           setSimRawPoints={setSimRawPoints}
             simDrawMode={simDrawMode}
             setSimDrawMode={setSimDrawMode}
             simIsPlaying={simIsPlaying}
             setSimIsPlaying={setSimIsPlaying}
             simCurrentStepIndex={simCurrentStepIndex}
             setSimCurrentStepIndex={setSimCurrentStepIndex}
             simTrajectory={simTrajectory}
           simInterpolatedPath={simInterpolatedPath}
           simLockedPaths={simLockedPaths}
           setSimLockedPaths={setSimLockedPaths}
           simThemeColor={simThemeColor}
           simShowSweptPath={simShowSweptPath}
           simShowCornerTracks={simShowCornerTracks}
           simShowAxleTracks={simShowAxleTracks}
           simShowBodyWireframe={simShowBodyWireframe}
           editingPathId={editingPathId}
           setSimIsDragging={setSimIsDragging}
          simSweptOpacity={simSweptOpacity}
          simWheelTracksOpacity={simWheelTracksOpacity}
          simAxleTracksOpacity={simAxleTracksOpacity}
          simDraggingWaypointIndex={simDraggingWaypointIndex}
          setSimDraggingWaypointIndex={setSimDraggingWaypointIndex}
          simDraggingHandleType={simDraggingHandleType}
          setSimDraggingHandleType={setSimDraggingHandleType}
          simIsDraggingFirstVec={simIsDraggingFirstVec}
          setSimIsDraggingFirstVec={setSimIsDraggingFirstVec}
          simFirstVecStart={simFirstVecStart}
          setSimFirstVecStart={setSimFirstVecStart}
          simFirstVecEnd={simFirstVecEnd}
          setSimFirstVecEnd={setSimFirstVecEnd}
          simClickStartHeadingRef={simClickStartHeadingRef}
          simFractionalStepRef={simFractionalStepRef}

          // Intersection Props
          simIsIntersectionMode={simIsIntersectionMode}
          simP0X={simP0X}
          setSimP0X={setSimP0X}
          simP0Y={simP0Y}
          setSimP0Y={setSimP0Y}
          simP0Angle={simP0Angle}
          setSimP0Angle={setSimP0Angle}
          simP3X={simP3X}
          setSimP3X={setSimP3X}
          simP3Y={simP3Y}
          setSimP3Y={setSimP3Y}
          simP3Angle={simP3Angle}
          setSimP3Angle={setSimP3Angle}
          simP1RatioPercent={simP1RatioPercent}
          simP2RatioPercent={simP2RatioPercent}
          simIntersectionPickState={simIntersectionPickState}
          setSimIntersectionPickState={setSimIntersectionPickState}
          simShowIntersectionHelpers={simShowIntersectionHelpers}
          simEnableOutswing={simEnableOutswing}
          simI1RatioPercent={simI1RatioPercent}
          simI1OffsetDistance={simI1OffsetDistance}
          simI2RatioPercent={simI2RatioPercent}
          simI2OffsetDistance={simI2OffsetDistance}
          simStartExtensionM={simStartExtensionM}
            simEndExtensionM={simEndExtensionM}
            simIsCalibrating={simIsCalibrating}
            setSimIsCalibrating={setSimIsCalibrating}
          />
           {/* Telemetry HUD - 4 個 80x80px 圓角卡片，左側中心排列 */}
          {appMode === 'simulation' && simTrajectory.length > 0 && (() => {
            const isSteerExceeded = Math.abs(currentDeltaDeg) > (simConfig.maxSteerLimit ?? 40);
            const cardBase = "w-[80px] h-[80px] rounded-xl flex flex-col items-center justify-center text-center p-1.5 border backdrop-blur-sm transition-all duration-300";
            const cardNormal = "bg-[#14161c]/80 border-[#2d3039]";
            const cardAlert = "bg-red-950/40 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.45)] animate-pulse";
            const cardCls = isSteerExceeded ? `${cardBase} ${cardAlert}` : `${cardBase} ${cardNormal}`;
            const labelCls = "text-[8px] font-bold text-slate-400 leading-tight text-center mb-0.5";
            const valueCls = "text-sm font-black text-slate-100 font-mono leading-none";
            return (
              <div className="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-20 pointer-events-none">
                {/* 卡片1：總行駛長度 */}
                <div className={cardCls}>
                  <span className={labelCls}>總行駛<br/>長度 (m)</span>
                  <span className={valueCls}>{totalPathLengthM.toFixed(1)}</span>
                </div>
                {/* 卡片2：即時前輪轉角 */}
                <div className={cardCls}>
                  <span className={labelCls}>即時前輪<br/>轉角 (deg)</span>
                  <span className={`text-sm font-black font-mono leading-none ${isSteerExceeded ? 'text-red-500' : 'text-slate-100'}`}>
                    {currentDeltaDeg.toFixed(1)}°
                  </span>
                </div>
                {/* 卡片3：即時轉彎半徑 */}
                <div className={cardCls}>
                  <span className={labelCls}>即時轉彎<br/>半徑 (m)</span>
                  <span className={valueCls}>
                    {currentTurnRadiusM === Infinity ? '∞' : currentTurnRadiusM.toFixed(1)}
                  </span>
                </div>
                {/* 卡片4：即時車身朝向角 */}
                <div className={cardCls}>
                  <span className={labelCls}>即時車身<br/>朝向角 (deg)</span>
                  <span className={valueCls}>
                    {((currentThetaDeg % 360 + 360) % 360).toFixed(0)}°
                  </span>
                </div>
              </div>
            );
          })()}

          {/* 底部懸浮播放控制列 */}
          {appMode === 'simulation' && simTrajectory.length > 0 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-2 rounded-2xl bg-[#14161c]/90 border border-[#2d3039] backdrop-blur-md shadow-2xl">
              {/* 播放/暫停按鈕 */}
              <button
                onClick={() => setSimIsPlaying(!simIsPlaying)}
                className={`flex items-center justify-center w-8 h-8 rounded-full transition-all cursor-pointer border focus:outline-none ${
                  simIsPlaying
                    ? 'bg-indigo-600 border-indigo-500 hover:bg-indigo-500 text-white'
                    : 'bg-[#1f2229] border-[#2d3039] hover:bg-slate-700 text-indigo-400'
                }`}
                title={simIsPlaying ? '暫停模擬' : '播放模擬'}
              >
                {simIsPlaying ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
              </button>

              {/* 進度滑桿 */}
              <div className="flex items-center gap-2 w-48">
                <span className="text-[9px] font-mono text-slate-500 w-6 text-right shrink-0">
                  {simTrajectory.length > 0 ? Math.round((simCurrentStepIndex / Math.max(1, simTrajectory.length - 1)) * 100) : 0}%
                </span>
                <input
                  type="range"
                  min="0"
                  max={Math.max(0, simTrajectory.length - 1)}
                  value={simCurrentStepIndex}
                  onChange={(e) => {
                    const idx = parseInt(e.target.value);
                    setSimCurrentStepIndex(idx);
                    simFractionalStepRef.current = idx;
                    setSimIsPlaying(false);
                  }}
                  className="flex-1 h-1 accent-indigo-500 cursor-pointer focus:outline-none focus:ring-0 select-none"
                />
              </div>

              {/* 播放倍速選擇 */}
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-slate-500 shrink-0">倍速</span>
                <select
                  value={simPlaybackSpeed}
                  onChange={(e) => setSimPlaybackSpeed(parseFloat(e.target.value))}
                  className="bg-[#0a0b0e] border border-[#2d3039] text-[10px] text-white rounded px-1 py-0.5 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="0.5">0.5x</option>
                  <option value="1">1.0x</option>
                  <option value="2">2.0x</option>
                  <option value="4">4.0x</option>
                </select>
              </div>
            </div>
          )}
        </div>

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
            {appMode === 'cad' ? (
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
                onAddElement={handleAddElement}
                appMode={appMode}
                simShowSweptPath={simShowSweptPath}
                setSimShowSweptPath={setSimShowSweptPath}
                simShowCornerTracks={simShowCornerTracks}
                setSimShowCornerTracks={setSimShowCornerTracks}
                simShowAxleTracks={simShowAxleTracks}
                setSimShowAxleTracks={setSimShowAxleTracks}
                simSweptOpacity={simSweptOpacity}
                setSimSweptOpacity={setSimSweptOpacity}
                simWheelTracksOpacity={simWheelTracksOpacity}
                setSimWheelTracksOpacity={setSimWheelTracksOpacity}
                simAxleTracksOpacity={simAxleTracksOpacity}
                setSimAxleTracksOpacity={setSimAxleTracksOpacity}
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
            ) : (
              <div 
                id="right-sim-panel" 
                className="flex flex-col h-full bg-[#14161c] text-slate-350 p-4 space-y-4 select-none overflow-y-auto"
              >
                <div className="flex items-center justify-between border-b border-[#2d3039] pb-2 mb-1">
                  <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Sliders className="w-4 h-4 text-indigo-400" />
                    <span>車流模擬控制台</span>
                  </span>
                </div>



                {/* Road Tracing sub-panels */}
                {simIsIntersectionMode ? (
                  <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-3">
                    <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 border-b border-[#2d3039]/40 pb-1">
                      <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                      <span>路口導引參數</span>
                    </h4>

                    {/* Step Pickers */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (simIntersectionPickState !== 'p0') {
                            setSimP0X(null);
                            setSimP0Y(null);
                            setSimIntersectionPickState('p0');
                          } else {
                            setSimIntersectionPickState('none');
                          }
                        }}
                        className={`py-1.5 px-2 rounded border text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          simIntersectionPickState === 'p0'
                            ? 'bg-indigo-600 border-indigo-400 text-white shadow-[0_0_10px_rgba(99,102,241,0.5)]'
                            : 'bg-[#0a0b0e] border-[#2d3039] text-indigo-400 hover:text-indigo-300'
                        }`}
                      >
                        {simIntersectionPickState === 'p0' ? (
                          <>
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                            </span>
                            <MapPin className="w-3.5 h-3.5" />
                            <span>正在點選 P0</span>
                          </>
                        ) : (
                          <>
                            <MapPin className="w-3.5 h-3.5" />
                            <span>定位起點 P0</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (simIntersectionPickState !== 'p3') {
                            setSimP3X(null);
                            setSimP3Y(null);
                            setSimIntersectionPickState('p3');
                          } else {
                            setSimIntersectionPickState('none');
                          }
                        }}
                        className={`py-1.5 px-2 rounded border text-[10px] font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          simIntersectionPickState === 'p3'
                            ? 'bg-pink-600 border-pink-400 text-white shadow-[0_0_10px_rgba(236,72,153,0.5)]'
                            : 'bg-[#0a0b0e] border-[#2d3039] text-pink-400 hover:text-pink-300'
                        }`}
                      >
                        {simIntersectionPickState === 'p3' ? (
                          <>
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                            </span>
                            <MapPin className="w-3.5 h-3.5" />
                            <span>正在點選 P3</span>
                          </>
                        ) : (
                          <>
                            <MapPin className="w-3.5 h-3.5" />
                            <span>定位終點 P3</span>
                          </>
                        )}
                      </button>
                    </div>

                    {/* Road heading angles */}
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <span className="text-slate-400 block mb-0.5">P0 起點角度 ({simP0Angle}°)</span>
                        <input
                          type="range"
                          min="-180"
                          max="180"
                          value={simP0Angle}
                          onChange={(e) => setSimP0Angle(parseInt(e.target.value))}
                          className="w-full accent-indigo-500 cursor-pointer h-1"
                        />
                      </div>
                      <div>
                        <span className="text-slate-400 block mb-0.5">P3 終點角度 ({simP3Angle}°)</span>
                        <input
                          type="range"
                          min="-180"
                          max="180"
                          value={simP3Angle}
                          onChange={(e) => setSimP3Angle(parseInt(e.target.value))}
                          className="w-full accent-pink-500 cursor-pointer h-1"
                        />
                      </div>
                    </div>

                    {/* Ratio parameters */}
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div>
                        <div className="flex justify-between text-slate-400">
                          <span>起點切線比例 P1</span>
                          <span className="font-mono text-indigo-400">{simP1RatioPercent}%</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="200"
                          value={simP1RatioPercent}
                          onChange={(e) => setSimP1RatioPercent(parseInt(e.target.value))}
                          className="w-full accent-indigo-500 cursor-pointer h-1"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-slate-400">
                          <span>終點切線比例 P2</span>
                          <span className="font-mono text-pink-400">{simP2RatioPercent}%</span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="200"
                          value={simP2RatioPercent}
                          onChange={(e) => setSimP2RatioPercent(parseInt(e.target.value))}
                          className="w-full accent-pink-500 cursor-pointer h-1"
                        />
                      </div>
                    </div>

                    {/* Extension parameters */}
                    <div className="space-y-2 text-[10px] pt-1.5 border-t border-[#2d3039]/40">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <span className="text-slate-400 block mb-0.5">起點直路延伸 ({simStartExtensionM}m)</span>
                          <input
                            type="range"
                            min="0"
                            max="30"
                            step="0.5"
                            value={simStartExtensionM}
                            onChange={(e) => setSimStartExtensionM(parseFloat(e.target.value))}
                            className="w-full accent-indigo-500 cursor-pointer h-1"
                          />
                        </div>
                        <div>
                          <span className="text-slate-400 block mb-0.5">終點直路延伸 ({simEndExtensionM}m)</span>
                          <input
                            type="range"
                            min="0"
                            max="30"
                            step="0.5"
                            value={simEndExtensionM}
                            onChange={(e) => setSimEndExtensionM(parseFloat(e.target.value))}
                            className="w-full accent-pink-500 cursor-pointer h-1"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Outswing configurations */}
                    <div className="pt-2 border-t border-[#2d3039]/40 space-y-2 text-[10px]">
                      <label className="flex items-center gap-2 cursor-pointer font-bold text-slate-350">
                        <input
                          type="checkbox"
                          checked={simEnableOutswing}
                          onChange={(e) => setSimEnableOutswing(e.target.checked)}
                          className="accent-indigo-500 rounded cursor-pointer"
                        />
                        <span>啟用車頭偏移 (Offset)</span>
                      </label>

                      {simEnableOutswing && (
                        <div className="grid grid-cols-2 gap-2 pl-3 border-l border-indigo-500/20 bg-indigo-950/5 p-2 rounded-r-lg">
                          <div className="space-y-2">
                            <div>
                              <div className="flex justify-between text-slate-400">
                                <span>I1 偏移點位置 ({simI1RatioPercent}%)</span>
                              </div>
                              <input
                                type="range"
                                min="50"
                                max="150"
                                value={simI1RatioPercent}
                                onChange={(e) => setSimI1RatioPercent(parseInt(e.target.value))}
                                className="w-full accent-indigo-500 cursor-pointer h-1"
                              />
                            </div>
                            <div>
                              <div className="flex justify-between text-slate-400">
                                <span>I1 偏移距離 ({simI1OffsetDistance}m)</span>
                              </div>
                              <input
                                type="range"
                                min="-5.0"
                                max="5.0"
                                step="0.1"
                                value={simI1OffsetDistance}
                                onChange={(e) => setSimI1OffsetDistance(parseFloat(e.target.value))}
                                className="w-full accent-indigo-500 cursor-pointer h-1"
                              />
                            </div>
                          </div>
                          
                          <div className="space-y-2">
                            <div>
                              <div className="flex justify-between text-slate-400">
                                <span>I2 偏移點位置 ({simI2RatioPercent}%)</span>
                              </div>
                              <input
                                type="range"
                                min="50"
                                max="150"
                                value={simI2RatioPercent}
                                onChange={(e) => setSimI2RatioPercent(parseInt(e.target.value))}
                                className="w-full accent-pink-500 cursor-pointer h-1"
                              />
                            </div>
                            <div>
                              <div className="flex justify-between text-slate-400">
                                <span>I2 偏移距離 ({simI2OffsetDistance}m)</span>
                              </div>
                              <input
                                type="range"
                                min="-5.0"
                                max="5.0"
                                step="0.1"
                                value={simI2OffsetDistance}
                                onChange={(e) => setSimI2OffsetDistance(parseFloat(e.target.value))}
                                className="w-full accent-pink-500 cursor-pointer h-1"
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* 1. Vehicle Presets Specs */}
                <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-3">
                  <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5 text-indigo-400" />
                    <span>設計車輛規格預設</span>
                  </h4>
                  <select
                    value={simSelectedVehiclePresetId}
                    onChange={(e) => handleSimVehiclePresetChange(e.target.value)}
                    className="w-full bg-[#0a0b0e] border border-[#2d3039] px-2.5 py-1.5 rounded-lg text-xs text-white focus:outline-none focus:border-indigo-500 cursor-pointer"
                  >
                    {SIM_VEHICLE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id} className="bg-[#14161c]">
                        {preset.name}
                      </option>
                    ))}
                  </select>

                  {/* Params Controls */}
                  <div className="space-y-2.5 pt-1">
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>軸距 L</span>
                        <span className="font-mono text-indigo-400 font-bold">{simConfig.L.toFixed(2)} m</span>
                      </div>
                      <input
                        type="range"
                        min="1.5"
                        max="8.0"
                        step="0.05"
                        value={simConfig.L}
                        disabled={simSelectedVehiclePresetId !== 'custom'}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setSimConfig(prev => ({ ...prev, L: val }));
                          setSimCurrentStepIndex(0);
                          simFractionalStepRef.current = 0;
                        }}
                        className="w-full accent-indigo-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>車寬 W</span>
                        <span className="font-mono text-indigo-400 font-bold">{simConfig.W.toFixed(2)} m</span>
                      </div>
                      <input
                        type="range"
                        min="1.2"
                        max="3.0"
                        step="0.05"
                        value={simConfig.W}
                        disabled={simSelectedVehiclePresetId !== 'custom'}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setSimConfig(prev => ({ ...prev, W: val }));
                        }}
                        className="w-full accent-indigo-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>前懸 Of</span>
                          <span className="font-mono text-indigo-400">{simConfig.Of.toFixed(1)}m</span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="3.5"
                          step="0.1"
                          value={simConfig.Of}
                          disabled={simSelectedVehiclePresetId !== 'custom'}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setSimConfig(prev => ({ ...prev, Of: val }));
                          }}
                          className="w-full accent-indigo-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                        />
                      </div>
                      <div>
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span>後懸 Or</span>
                          <span className="font-mono text-indigo-400">{simConfig.Or.toFixed(1)}m</span>
                        </div>
                        <input
                          type="range"
                          min="0.3"
                          max="4.0"
                          step="0.1"
                          value={simConfig.Or}
                          disabled={simSelectedVehiclePresetId !== 'custom'}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setSimConfig(prev => ({ ...prev, Or: val }));
                          }}
                          className="w-full accent-indigo-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                        />
                      </div>
                    </div>

                    {/* Maximum Steer Angle Limit */}
                    <div>
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>最大前輪轉角</span>
                        <span className="font-mono text-indigo-400 font-bold">{simConfig.maxSteerLimit ?? 40}°</span>
                      </div>
                      <input
                        type="range"
                        min="20"
                        max="55"
                        step="1"
                        value={simConfig.maxSteerLimit ?? 40}
                        disabled={simSelectedVehiclePresetId !== 'custom'}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setSimConfig(prev => ({ ...prev, maxSteerLimit: val }));
                          setSimCurrentStepIndex(0);
                          simFractionalStepRef.current = 0;
                        }}
                        className="w-full accent-indigo-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                      />
                    </div>

                    {/* Trailer Settings Checkbox */}
                    <div className="pt-1.5 border-t border-[#2d3039]/40">
                      <label className="flex items-center gap-2 text-xs font-bold text-slate-350 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={simConfig.enableTrailer || false}
                          disabled={simSelectedVehiclePresetId !== 'custom'}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setSimConfig(prev => ({ ...prev, enableTrailer: checked }));
                            setSimCurrentStepIndex(0);
                            simFractionalStepRef.current = 0;
                          }}
                          className="w-3.5 h-3.5 accent-indigo-500 rounded cursor-pointer"
                        />
                        <span>啟用半拖車</span>
                      </label>
                    </div>

                    {simConfig.enableTrailer && (
                      <div className="space-y-2.5 pt-2 pl-3 border-l border-indigo-500/20 bg-indigo-950/5 p-2 rounded-r-lg">
                        <div>
                          <div className="flex justify-between text-[10px] text-slate-400">
                            <span>拖車軸距 Lt</span>
                            <span className="font-mono text-indigo-400 font-bold">{(simConfig.Lt ?? 7.5).toFixed(1)} m</span>
                          </div>
                          <input
                            type="range"
                            min="3.0"
                            max="11.0"
                            step="0.1"
                            value={simConfig.Lt ?? 7.5}
                            disabled={simSelectedVehiclePresetId !== 'custom'}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setSimConfig(prev => ({ ...prev, Lt: val }));
                              setSimCurrentStepIndex(0);
                              simFractionalStepRef.current = 0;
                            }}
                            className="w-full accent-indigo-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <div className="flex justify-between text-[9px] text-slate-400">
                              <span>前懸 Oft</span>
                              <span className="font-mono text-indigo-400">{(simConfig.Oft ?? 1.0).toFixed(1)}m</span>
                            </div>
                            <input
                              type="range"
                              min="0.2"
                              max="2.5"
                              step="0.1"
                              value={simConfig.Oft ?? 1.0}
                              disabled={simSelectedVehiclePresetId !== 'custom'}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setSimConfig(prev => ({ ...prev, Oft: val }));
                              }}
                              className="w-full accent-indigo-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                            />
                          </div>
                          <div>
                            <div className="flex justify-between text-[9px] text-slate-400">
                              <span>後懸 Ort</span>
                              <span className="font-mono text-indigo-400">{(simConfig.Ort ?? 1.8).toFixed(1)}m</span>
                            </div>
                            <input
                              type="range"
                              min="0.2"
                              max="4.0"
                              step="0.1"
                              value={simConfig.Ort ?? 1.8}
                              disabled={simSelectedVehiclePresetId !== 'custom'}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                setSimConfig(prev => ({ ...prev, Ort: val }));
                              }}
                              className="w-full accent-indigo-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                            />
                          </div>
                        </div>
                        <div>
                          <div className="flex justify-between text-[9px] text-slate-400">
                            <span>拖車寬度 Wt</span>
                            <span className="font-mono text-indigo-400">{(simConfig.Wt ?? 2.5).toFixed(1)}m</span>
                          </div>
                          <input
                            type="range"
                            min="1.5"
                            max="3.0"
                            step="0.1"
                            value={simConfig.Wt ?? 2.5}
                            disabled={simSelectedVehiclePresetId !== 'custom'}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setSimConfig(prev => ({ ...prev, Wt: val }));
                            }}
                            className="w-full accent-indigo-500 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Speed Config */}
                <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-2 text-xs">
                  <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                    <span>行駛速度</span>
                    <span className="font-mono text-indigo-400">{(simConfig.speed * 3.6).toFixed(1)} km/h</span>
                  </div>
                  <input
                    type="range"
                    min="2"
                    max="45"
                    step="0.5"
                    value={parseFloat((simConfig.speed * 3.6).toFixed(1))}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      const speedMps = parseFloat((val / 3.6).toFixed(3));
                      setSimConfig(prev => ({ ...prev, speed: speedMps }));
                    }}
                    className="w-full accent-indigo-500 cursor-pointer h-1"
                  />
                </div>

                {/* 5. Trajectory Layers List */}
                <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-2">
                  <h4 className="text-xs font-bold text-slate-200 flex items-center gap-1.5 border-b border-[#2d3039]/40 pb-1 mb-1 justify-between">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-indigo-400" />
                      <span>軌跡圖層 ({simLockedPaths.length + (editingPathId === null && simRawPoints.length > 0 ? 1 : 0)})</span>
                    </div>
                  </h4>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {/* 當前全新編輯中軌跡（僅在未載入舊軌跡且有畫點時顯示） */}
                    {editingPathId === null && simRawPoints.length > 0 && (
                      <div 
                        className="sim-trajectory-card flex items-center justify-between p-2 rounded-lg text-[10px] transition-all"
                        style={{
                          '--card-border-color': '#ef4444',
                          '--card-bg-color': `${normalizeColor(simThemeColor)}0d`,
                          '--card-text-color': normalizeColor(simThemeColor)
                        } as React.CSSProperties}
                      >
                        <div className="flex flex-col gap-0.5 truncate">
                          <span className="font-bold truncate flex items-center gap-1.5">
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
                            新軌跡 (編輯中)
                          </span>
                          <span className="text-[8px] text-slate-400 font-mono">
                            {simRawPoints.length} 節點 | {simConfig.enableTrailer ? "帶掛車" : "單體車"}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {/* 新軌跡的調色盤 */}
                          <div className="relative flex items-center" id="color-picker-container-new-path">
                            <button
                              type="button"
                              onClick={() => {
                                const inputEl = document.getElementById('color-input-new-path');
                                if (inputEl) inputEl.click();
                              }}
                              className="sim-color-picker-btn w-4 h-4 rounded-full border transition-all cursor-pointer hover:scale-110 flex-shrink-0"
                              style={{
                                borderColor: '#3f3f46',
                                boxShadow: 'none'
                              }}
                              title="變更軌跡顏色"
                            />
                            <input
                              id="color-input-new-path"
                              type="color"
                              value={normalizeColor(simThemeColor)}
                              onChange={(e) => handleUpdatePathColor('new-path', e.target.value)}
                              className="absolute inset-0 opacity-0 w-0 h-0 pointer-events-none"
                            />
                          </div>

                          <button
                            onClick={handleSimLockCurrentPath}
                            className="p-1 hover:bg-white/10 rounded transition-all cursor-pointer"
                            title="鎖定當前新軌跡"
                          >
                            <Unlock className="w-3.5 h-3.5 text-red-400" />
                          </button>
                          <button
                            onClick={() => {
                              setSimRawPoints([]);
                              setSimCurrentStepIndex(0);
                              simFractionalStepRef.current = 0;
                            }}
                            className="p-1 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded transition-all cursor-pointer"
                            title="清除當前新軌跡"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}

                    {/* 已鎖定與載入編輯中的軌跡 */}
                    {simLockedPaths.map((lp, idx) => {
                      const isEditingThis = lp.id === editingPathId;
                      const presetName = SIM_VEHICLE_PRESETS.find(p => p.L === lp.config.L && p.W === lp.config.W)?.name.split(' ')[0] || "車輛";
                      
                      const pointsCount = isEditingThis ? simRawPoints.length : lp.rawPoints.length;
                      const isTrailer = isEditingThis ? simConfig.enableTrailer : lp.config.enableTrailer;
                      const activeThemeColor = isEditingThis ? simThemeColor : lp.themeColor;

                      const themeColors: Record<string, string> = {
                        indigo: 'border-indigo-500/20 text-indigo-400 bg-indigo-500/5 hover:bg-indigo-500/10',
                        emerald: 'border-emerald-500/20 text-emerald-400 bg-emerald-500/5 hover:bg-emerald-500/10',
                        amber: 'border-amber-500/20 text-amber-400 bg-amber-500/5 hover:bg-amber-500/10',
                        rose: 'border-rose-500/20 text-rose-400 bg-rose-500/5 hover:bg-rose-500/10',
                        sky: 'border-sky-500/20 text-sky-400 bg-sky-500/5 hover:bg-sky-500/10'
                      };

                      const borderClass = isEditingThis ? 'border-red-500' : (themeColors[activeThemeColor] ? themeColors[activeThemeColor].split(' ')[0] : 'border-indigo-500/20');
                      const bgTextClass = themeColors[activeThemeColor] ? themeColors[activeThemeColor].split(' ').slice(1).join(' ') : 'text-indigo-400 bg-indigo-500/5';

                      const normColor = normalizeColor(activeThemeColor);

                      return (
                        <div 
                          key={lp.id} 
                          className="sim-trajectory-card flex items-center justify-between p-2 rounded-lg text-[10px] transition-all"
                          style={{
                            '--card-border-color': isEditingThis ? '#ef4444' : `${normColor}40`,
                            '--card-bg-color': `${normColor}0d`,
                            '--card-text-color': normColor
                          } as React.CSSProperties}
                        >
                          <div className="flex flex-col gap-0.5 truncate">
                            <span className="font-bold truncate flex items-center gap-1.5">
                              {isEditingThis && <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>}
                              軌跡 #{idx + 1} - {presetName}
                            </span>
                            <span className="text-[8px] text-slate-500 font-mono">
                              {pointsCount} 節點 | {isTrailer ? "帶掛車" : "單體車"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {/* 調色盤圓圈 */}
                            <div className="relative flex items-center" id={`color-picker-container-${lp.id}`}>
                              <button
                                type="button"
                                onClick={() => {
                                  const inputEl = document.getElementById(`color-input-${lp.id}`);
                                  if (inputEl) inputEl.click();
                                }}
                                className="sim-color-picker-btn w-4 h-4 rounded-full border transition-all cursor-pointer hover:scale-110 flex-shrink-0"
                                style={{
                                  borderColor: '#3f3f46',
                                  boxShadow: 'none'
                                }}
                                title="變更軌跡顏色"
                              />
                              <input
                                id={`color-input-${lp.id}`}
                                type="color"
                                value={normalizeColor(lp.themeColor)}
                                onChange={(e) => handleUpdatePathColor(lp.id, e.target.value)}
                                className="absolute inset-0 opacity-0 w-0 h-0 pointer-events-none"
                              />
                            </div>

                            {isEditingThis ? (
                              <button
                                onClick={handleSimLockCurrentPath}
                                className="p-1 hover:bg-white/10 rounded transition-all cursor-pointer"
                                title="鎖定編輯並回存此軌跡"
                              >
                                <Unlock className="w-3.5 h-3.5 text-red-400" />
                              </button>
                            ) : (
                              <button
                                onClick={() => handleSelectLockedPath(lp.id)}
                                className="p-1 hover:bg-white/10 text-slate-400 hover:text-white rounded transition-all cursor-pointer"
                                title="解鎖此軌跡進行編輯"
                              >
                                <Lock className="w-3.5 h-3.5" />
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setSimLockedPaths(prev => prev.filter(x => x.id !== lp.id));
                                if (isEditingThis) {
                                  setEditingPathId(null);
                                  setSimRawPoints([]);
                                  setSimCurrentStepIndex(0);
                                  simFractionalStepRef.current = 0;
                                }
                              }}
                              className="p-1 hover:bg-red-500/20 text-slate-400 hover:text-red-400 rounded transition-all cursor-pointer"
                              title="刪除此軌跡"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                    {editingPathId === null && simRawPoints.length === 0 && simLockedPaths.length === 0 && (
                      <div className="text-center py-6 text-slate-500 text-[10px] italic">
                        尚未繪製任何車流軌跡段
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

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
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[250] max-w-sm w-full bg-[#14161c] border border-zinc-800 text-zinc-100 px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 animate-slide-up duration-350">
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
    </div>
  );
}
