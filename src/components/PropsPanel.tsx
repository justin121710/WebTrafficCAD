import { useState } from 'react';
import { CadElement, ThreeCenterCurveElement, IslandElement, TextElement, Point2D } from '../types';
import { calculateWidening, distance, sampleCubicBezier, getMaxSteeringAngleForPath, generateParkingZoneSlots } from '../geometry';
import { 
  Compass, 
  HelpCircle, 
  Download, 
  Settings, 
  Type, 
  Check, 
  Grid, 
  Layers, 
  Triangle 
} from 'lucide-react';

function renderPropsIcon(type: string) {
  const baseClass = "w-4 h-4 inline-block shrink-0";
  switch (type) {
    case 'select':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" fill="currentColor" />
          <path d="M13 13l6 6" />
        </svg>
      );
    case 'sketch_circle':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="8" strokeDasharray="3,3" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'guideline':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="2" y1="12" x2="22" y2="12" strokeDasharray="4,2,1,2" />
          <line x1="5" y1="4" x2="19" y2="20" stroke="currentColor" strokeDasharray="2,2" opacity="0.6" />
        </svg>
      );
    case 'yellow_double':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" strokeWidth="2.5">
          <line x1="8" y1="3" x2="8" y2="21" stroke="#FFCC00" />
          <line x1="16" y1="3" x2="16" y2="21" stroke="#FFCC00" />
        </svg>
      );
    case 'white_double':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="8" y1="3" x2="8" y2="21" />
          <line x1="16" y1="3" x2="16" y2="21" />
        </svg>
      );
    case 'white_solid':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="3">
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
      );
    case 'white_dashed':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="5,4" />
        </svg>
      );
    case 'yellow_dashed':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="#eab308" strokeWidth="2">
          <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="5,4" />
        </svg>
      );
    case 'crossing_dashed':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="3">
          <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="3,3" />
        </svg>
      );
    case 'stop_line':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="4">
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
      );
    case 'yield_line':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18L12 21 3 6z" fill="currentColor" fillOpacity="0.1" />
        </svg>
      );
    case 'BuildingLine':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 21h18M5 21V8l7-4 7 4v13" />
          <line x1="9" y1="12" x2="15" y2="12" />
          <line x1="9" y1="16" x2="15" y2="16" />
        </svg>
      );
    case 'reversible_lane':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="3" x2="8" y2="21" strokeDasharray="5,4" />
          <line x1="16" y1="3" x2="16" y2="21" strokeDasharray="5,4" />
        </svg>
      );
    case 'Sidewalk':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="4" y="4" width="16" height="16" rx="1.5" />
          <line x1="4" y1="9" x2="20" y2="9" />
          <line x1="4" y1="15" x2="20" y2="15" />
          <line x1="9" y1="4" x2="9" y2="9" />
          <line x1="15" y1="4" x2="15" y2="9" />
          <line x1="6" y1="9" x2="6" y2="15" />
          <line x1="12" y1="9" x2="12" y2="15" />
          <line x1="18" y1="9" x2="18" y2="15" />
          <line x1="10" y1="15" x2="10" y2="20" />
          <line x1="16" y1="15" x2="16" y2="20" />
        </svg>
      );
    case 'channelization':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="4" y="4" width="16" height="16" rx="1.5" />
          <line x1="4" y1="12" x2="12" y2="4" />
          <line x1="4" y1="20" x2="20" y2="4" />
          <line x1="12" y1="20" x2="20" y2="12" />
        </svg>
      );
    case 'crosswalk':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="5" width="18" height="14" rx="2" strokeDasharray="2,2" />
          <rect x="6" y="7" width="2" height="10" fill="currentColor" />
          <rect x="11" y="7" width="2" height="10" fill="currentColor" />
          <rect x="16" y="7" width="2" height="10" fill="currentColor" />
        </svg>
      );
    case 'bicycle_lane':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="5.5" cy="14" r="2.5" />
          <circle cx="18.5" cy="14" r="2.5" />
          <path d="M12 14v-4l3-3M8 10h8" />
        </svg>
      );
    case 'parking_space':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="8" y="3.2" width="8" height="17.6" rx="1.5" />
          <path d="M10.5 15V8h2.5a2 2 0 0 1 0 4H10.5" strokeWidth="1.8" />
        </svg>
      );
    case 'parking_zone':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M10.5 7.5V2h3a1.5 1.5 0 0 1 0 3h-3" strokeWidth="1.8" />
          <rect x="5" y="9" width="5" height="11" rx="1" fill="currentColor" fillOpacity="0.1" />
          <rect x="14" y="9" width="5" height="11" rx="1" fill="currentColor" fillOpacity="0.1" />
          <line x1="2" y1="14.5" x2="22" y2="14.5" strokeDasharray="2,2" />
          <circle cx="2" cy="14.5" r="1.5" fill="currentColor" />
          <circle cx="22" cy="14.5" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'smart_path':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="6" y="4" width="12" height="16" rx="3" />
          <path d="M8 9h8" />
          <rect x="8" y="10" width="8" height="6" rx="1" fill="currentColor" fillOpacity="0.1" />
          <rect x="4" y="6" width="2" height="3" rx="0.5" fill="currentColor" />
          <rect x="18" y="6" width="2" height="3" rx="0.5" fill="currentColor" />
          <rect x="4" y="15" width="2" height="3" rx="0.5" fill="currentColor" />
          <rect x="18" y="15" width="2" height="3" rx="0.5" fill="currentColor" />
        </svg>
      );
    case 'three_center_curve':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 20C4 11.163 11.163 4 20 4" />
          <line x1="4" y1="20" x2="4" y2="16" />
          <line x1="20" y1="4" x2="16" y2="4" />
        </svg>
      );
    case 'island':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="4" y="4" width="16" height="16" rx="1.5" />
          <line x1="4" y1="12" x2="12" y2="4" />
          <line x1="4" y1="20" x2="20" y2="4" />
          <line x1="12" y1="20" x2="20" y2="12" />
        </svg>
      );
    case 'text':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 7V4h16v3M9 20h6M12 4v16" />
        </svg>
      );
    case 'road_arrow':
      return (
        <svg viewBox="0 0 24 24" className={baseClass} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M12 5l-5 5M12 5l5 5" />
        </svg>
      );
    default:
      return null;
  }
}

interface PropsPanelProps {
  selectedElement: CadElement | null;
  R2: number;
  setR2: (r: number) => void;
  designVehicle: 'passenger' | 'semi_trailer' | 'articulated';
  setDesignVehicle: (v: 'passenger' | 'semi_trailer' | 'articulated') => void;
  
  // Handlers for modifying elements
  onUpdateElement: (el: CadElement) => void;
  onDeleteElement: (id: string) => void;
  onGenerateIslandFromCurve: (curve: any) => void;
  
  // Undo helper
  onSaveHistory?: () => void;

  // Multi-anchor selection props
  selectedAnchorIndices?: number[];
  onTranslateSelectedAnchors?: (dx: number, dy: number) => void;
  onClearSelectedAnchors?: () => void;

  // New configs for default parking items
  activeTool?: string;
  parkingStampConfig?: { slotType: 'car' | 'motorcycle', width: number, length: number, angle: number };
  setParkingStampConfig?: (cfg: any) => void;
  parkingZoneConfig?: { slotType: 'car' | 'motorcycle', width: number, length: number, angle: number, gap: number, side: 'left' | 'right' };
  setParkingZoneConfig?: (cfg: any) => void;
  roadArrowConfig?: { arrowType: 'straight' | 'left' | 'right' | 'straight_left' | 'straight_right', length: number, angle: number };
  setRoadArrowConfig?: (cfg: any) => void;
}

export default function PropsPanel({
  selectedElement,
  R2,
  setR2,
  designVehicle,
  setDesignVehicle,
  onUpdateElement,
  onDeleteElement,
  onGenerateIslandFromCurve,
  onSaveHistory,
  selectedAnchorIndices = [],
  onTranslateSelectedAnchors,
  onClearSelectedAnchors,
  activeTool,
  parkingStampConfig,
  setParkingStampConfig,
  parkingZoneConfig,
  setParkingZoneConfig,
  roadArrowConfig,
  setRoadArrowConfig
}: PropsPanelProps) {
  const [nudgeStep, setNudgeStep] = useState<number>(0.1);
  
  // Calculate general widening for current global R2 setting
  const suggestedWidth = calculateWidening(R2, designVehicle);

  // Accurate length estimator checking both straight segments and multi-segment Bezier path subdivisions
  const getLineElementLength = (line: any): number => {
    if (line.points && line.points.length > 0) {
      let len = 0;
      for (let i = 0; i < line.points.length - 1; i++) {
        const pStart = line.points[i];
        const cpStart = line.cpRight[i] || pStart;
        const cpEnd = line.cpLeft[i + 1] || line.points[i + 1];
        const pEnd = line.points[i + 1];
        const samples = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 15);
        for (let j = 0; j < samples.length - 1; j++) {
          len += distance(samples[j], samples[j + 1]);
        }
      }
      return len;
    } else if (line.p1 && line.p2) {
      return distance(line.p1, line.p2);
    }
    return 0;
  };

  const renderSelectedElementProps = () => {
    if (!selectedElement) {
      if (activeTool === 'parking_space' && parkingStampConfig && setParkingStampConfig) {
        const slotType = parkingStampConfig.slotType;
        const length = parkingStampConfig.length;
        const width = parkingStampConfig.width;
        const angleDeg = Math.round((parkingStampConfig.angle * 180) / Math.PI);
        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039]">
              <h4 className="text-xs font-semibold text-blue-400 mb-2">停車格印章參數設定</h4>
              <p className="text-[10px] text-slate-500">（滑鼠單擊即可印下）將依此設定的尺寸與角度放置車格。</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 block">車格類型</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setParkingStampConfig({
                      ...parkingStampConfig,
                      slotType: 'car',
                      width: 2.5,
                      length: 5.5
                    });
                  }}
                  className={`px-2 py-2 text-[10px] rounded border text-center cursor-pointer transition-colors ${
                    slotType === 'car'
                      ? 'bg-blue-950/40 border-blue-500/65 text-blue-400 font-bold'
                      : 'bg-[#1f2229] border-[#2d3039] text-slate-400'
                  }`}
                >
                  汽車預設 (2.5m x 5.5m)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setParkingStampConfig({
                      ...parkingStampConfig,
                      slotType: 'motorcycle',
                      width: 0.8,
                      length: 2.0
                    });
                  }}
                  className={`px-2 py-2 text-[10px] rounded border text-center cursor-pointer transition-colors ${
                    slotType === 'motorcycle'
                      ? 'bg-purple-950/40 border-purple-500/65 text-purple-400 font-bold'
                      : 'bg-[#1f2229] border-[#2d3039] text-slate-400'
                  }`}
                >
                  機車預設 (0.8m x 2m)
                </button>
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">長度 (m)</span>
                <span className="text-slate-200 font-mono font-bold">{length.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="1.0"
                  max="8.0"
                  step="0.1"
                  value={length}
                  onChange={(e) => {
                    setParkingStampConfig({
                      ...parkingStampConfig,
                      length: parseFloat(e.target.value)
                    });
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="1.0"
                  max="8.0"
                  step="0.1"
                  value={parseFloat(length.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 1.0) val = 1.0;
                      if (val > 8.0) val = 8.0;
                      setParkingStampConfig({
                        ...parkingStampConfig,
                        length: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">寬度 (m)</span>
                <span className="text-slate-200 font-mono font-bold">{width.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.4"
                  max="4.0"
                  step="0.1"
                  value={width}
                  onChange={(e) => {
                    setParkingStampConfig({
                      ...parkingStampConfig,
                      width: parseFloat(e.target.value)
                    });
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="0.4"
                  max="4.0"
                  step="0.1"
                  value={parseFloat(width.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 0.4) val = 0.4;
                      if (val > 4.0) val = 4.0;
                      setParkingStampConfig({
                        ...parkingStampConfig,
                        width: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">角度 (度)</span>
                <span className="text-slate-200 font-mono font-bold">{angleDeg}°</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="5"
                  value={angleDeg}
                  onChange={(e) => {
                    const rad = (parseFloat(e.target.value) * Math.PI) / 180;
                    setParkingStampConfig({
                      ...parkingStampConfig,
                      angle: rad
                    });
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="1"
                  value={angleDeg}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < -180) val = -180;
                      if (val > 180) val = 180;
                      setParkingStampConfig({
                        ...parkingStampConfig,
                        angle: (val * Math.PI) / 180
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>
          </div>
        );
      }

      if (activeTool === 'parking_zone' && parkingZoneConfig && setParkingZoneConfig) {
        const slotType = parkingZoneConfig.slotType;
        const length = parkingZoneConfig.length;
        const width = parkingZoneConfig.width;
        const angle = parkingZoneConfig.angle;
        const gap = parkingZoneConfig.gap;
        const side = parkingZoneConfig.side;
        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039]">
              <h4 className="text-xs font-semibold text-cyan-400 mb-2">停車區路徑屬性設定</h4>
              <p className="text-[10px] text-slate-500">以鋼筆工具在畫布上拉出引導路徑後，將在此路徑長度內自動填滿車格。</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 block">車格類型</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setParkingZoneConfig({
                      ...parkingZoneConfig,
                      slotType: 'car',
                      width: 2.5,
                      length: 5.5
                    });
                  }}
                  className={`px-2 py-2 text-[10px] rounded border text-center cursor-pointer transition-colors ${
                    slotType === 'car'
                      ? 'bg-blue-950/40 border-blue-500/65 text-blue-400 font-bold'
                      : 'bg-[#1f2229] border-[#2d3039] text-slate-400'
                  }`}
                >
                  汽車預設 (2.5m x 5.5m)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setParkingZoneConfig({
                      ...parkingZoneConfig,
                      slotType: 'motorcycle',
                      width: 0.8,
                      length: 2.0
                    });
                  }}
                  className={`px-2 py-2 text-[10px] rounded border text-center cursor-pointer transition-colors ${
                    slotType === 'motorcycle'
                      ? 'bg-purple-950/40 border-purple-500/65 text-purple-400 font-bold'
                      : 'bg-[#1f2229] border-[#2d3039] text-slate-400'
                  }`}
                >
                  機車預設 (0.8m x 2m)
                </button>
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">長度 (m)</span>
                <span className="text-slate-200 font-mono font-bold">{length.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="1.0"
                  max="8.0"
                  step="0.1"
                  value={length}
                  onChange={(e) => {
                    setParkingZoneConfig({
                      ...parkingZoneConfig,
                      length: parseFloat(e.target.value)
                    });
                  }}
                  className="flex-1 accent-cyan-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="1.0"
                  max="8.0"
                  step="0.1"
                  value={parseFloat(length.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 1.0) val = 1.0;
                      if (val > 8.0) val = 8.0;
                      setParkingZoneConfig({
                        ...parkingZoneConfig,
                        length: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">寬度 (m)</span>
                <span className="text-slate-200 font-mono font-bold">{width.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.4"
                  max="4.0"
                  step="0.1"
                  value={width}
                  onChange={(e) => {
                    setParkingZoneConfig({
                      ...parkingZoneConfig,
                      width: parseFloat(e.target.value)
                    });
                  }}
                  className="flex-1 accent-cyan-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="0.4"
                  max="4.0"
                  step="0.1"
                  value={parseFloat(width.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 0.4) val = 0.4;
                      if (val > 4.0) val = 4.0;
                      setParkingZoneConfig({
                        ...parkingZoneConfig,
                        width: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">相對切線偏角 (度)</span>
                <span className="text-slate-200 font-mono font-bold">{angle}°</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="5"
                  value={angle}
                  onChange={(e) => {
                    setParkingZoneConfig({
                      ...parkingZoneConfig,
                      angle: parseInt(e.target.value)
                    });
                  }}
                  className="flex-1 accent-cyan-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="1"
                  value={angle}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < -180) val = -180;
                      if (val > 180) val = 180;
                      setParkingZoneConfig({
                        ...parkingZoneConfig,
                        angle: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">車格間距 (m)</span>
                <span className="text-slate-200 font-mono font-bold">{gap.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.0"
                  max="3.0"
                  step="0.1"
                  value={gap}
                  onChange={(e) => {
                    setParkingZoneConfig({
                      ...parkingZoneConfig,
                      gap: parseFloat(e.target.value)
                    });
                  }}
                  className="flex-1 accent-cyan-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="0.0"
                  max="3.0"
                  step="0.1"
                  value={parseFloat(gap.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 0.0) val = 0.0;
                      if (val > 3.0) val = 3.0;
                      setParkingZoneConfig({
                        ...parkingZoneConfig,
                        gap: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5 p-3 bg-[#1f2229]/40 border border-[#2d3039] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">配置於路徑左側 (預設為右側)</span>
                <button
                  type="button"
                  onClick={() => {
                    setParkingZoneConfig({
                      ...parkingZoneConfig,
                      side: side === 'right' ? 'left' : 'right'
                    });
                  }}
                  className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                    side === 'left' ? 'bg-cyan-600' : 'bg-[#1f2229] border border-[#2d3039]'
                  }`}
                >
                  <div className={`bg-white w-4 h-4 rounded-full transition-transform ${
                    side === 'left' ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>
          </div>
        );
      }
      
      if (activeTool === 'road_arrow' && roadArrowConfig && setRoadArrowConfig) {
        const arrowType = roadArrowConfig.arrowType;
        const length = roadArrowConfig.length;
        const angleDeg = Math.round((roadArrowConfig.angle * 180) / Math.PI);
        const arrowLabels: Record<string, string> = {
          straight: '直行',
          left: '左轉',
          right: '右轉',
          straight_left: '直行左轉',
          straight_right: '直行右轉'
        };

        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039]">
              <h4 className="text-xs font-semibold text-blue-400 mb-2">指向線標記印章設定</h4>
              <p className="text-[10px] text-slate-500">（滑鼠單擊即可印下，拖曳旋轉）將依此設定的尺寸與角度放置指向箭頭。</p>
            </div>

            <div className="space-y-1.5 text-xs">
              <label className="text-slate-400 block font-medium">箭頭類型</label>
              <select
                value={arrowType}
                onChange={(e) => {
                  setRoadArrowConfig({
                    ...roadArrowConfig,
                    arrowType: e.target.value as any
                  });
                }}
                className="w-full bg-[#1f2229] border border-[#2d3039] px-2 py-1.5 rounded text-white focus:outline-none focus:border-blue-500 text-xs"
              >
                {Object.entries(arrowLabels).map(([val, label]) => (
                  <option key={val} value={val} className="bg-[#14161c]">{label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">長度 (m)</span>
                <span className="text-slate-200 font-mono font-bold">{length.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="1.0"
                  max="10.0"
                  step="0.1"
                  value={length}
                  onChange={(e) => {
                    setRoadArrowConfig({
                      ...roadArrowConfig,
                      length: parseFloat(e.target.value)
                    });
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="1.0"
                  max="10.0"
                  step="0.1"
                  value={parseFloat(length.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 1.0) val = 1.0;
                      if (val > 10.0) val = 10.0;
                      setRoadArrowConfig({
                        ...roadArrowConfig,
                        length: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">角度 (度)</span>
                <span className="text-slate-200 font-mono font-bold">{angleDeg}°</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="5"
                  value={angleDeg}
                  onChange={(e) => {
                    const rad = (parseFloat(e.target.value) * Math.PI) / 180;
                    setRoadArrowConfig({
                      ...roadArrowConfig,
                      angle: rad
                    });
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="1"
                  value={angleDeg}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < -180) val = -180;
                      if (val > 180) val = 180;
                      setRoadArrowConfig({
                        ...roadArrowConfig,
                        angle: (val * Math.PI) / 180
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="text-slate-500 text-xs text-center py-8 border border-dashed border-[#2d3039] rounded-lg bg-[#0f1115]/40">
          在畫布上選擇任何物件以調整其參數
        </div>
      );
    }

    const selectedAnchorsUI = (selectedAnchorIndices && selectedAnchorIndices.length > 0) ? (
      <div className="p-3 mb-4 bg-emerald-950/20 border border-emerald-500/40 rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-emerald-400">已選取特徵點</span>
          <button 
            type="button"
            onClick={() => onClearSelectedAnchors && onClearSelectedAnchors()}
            className="text-[10px] text-slate-400 hover:text-white underline cursor-pointer"
          >
            清除選取
          </button>
        </div>
        
        <div className="space-y-2">
          <span className="text-[11px] text-slate-400 block font-medium">特徵點平移微調 (公尺/m)</span>
          
          <div className="grid grid-cols-3 gap-1.5 max-w-[150px] mx-auto py-1">
            <div></div>
            <button
              id="nudge-up"
              type="button"
              title="往北平移"
              onClick={() => onTranslateSelectedAnchors && onTranslateSelectedAnchors(0, nudgeStep)}
              className="p-1 px-2 text-center bg-[#1f2229] border border-[#2d3039] rounded text-slate-300 hover:text-white hover:bg-[#2d3039] cursor-pointer text-xs font-bold"
            >
              <span className="flex items-center justify-center gap-1">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m18 15-6-6-6 6"/></svg>
                北
              </span>
            </button>
            <div></div>
            <button
              id="nudge-left"
              type="button"
              title="往西平移"
              onClick={() => onTranslateSelectedAnchors && onTranslateSelectedAnchors(-nudgeStep, 0)}
              className="p-1 px-2 text-center bg-[#1f2229] border border-[#2d3039] rounded text-slate-300 hover:text-white hover:bg-[#2d3039] cursor-pointer text-xs font-bold"
            >
              <span className="flex items-center justify-center gap-1">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                西
              </span>
            </button>
            <div className="flex items-center justify-center">
              <select
                id="nudge-step-select"
                value={String(nudgeStep)}
                onChange={(e) => setNudgeStep(parseFloat(e.target.value))}
                className="bg-transparent text-[10px] text-emerald-400 font-bold focus:outline-none cursor-pointer"
              >
                <option value="0.1" className="bg-[#14161c] text-slate-200">0.1</option>
                <option value="0.5" className="bg-[#14161c] text-slate-200">0.5</option>
                <option value="1.0" className="bg-[#14161c] text-slate-200">1.0</option>
              </select>
            </div>
            <button
              id="nudge-right"
              type="button"
              title="往東平移"
              onClick={() => onTranslateSelectedAnchors && onTranslateSelectedAnchors(nudgeStep, 0)}
              className="p-1 px-2 text-center bg-[#1f2229] border border-[#2d3039] rounded text-slate-300 hover:text-white hover:bg-[#2d3039] cursor-pointer text-xs font-bold"
            >
              <span className="flex items-center justify-center gap-1">
                東
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </span>
            </button>
            <div></div>
            <button
              id="nudge-down"
              type="button"
              title="往南平移"
              onClick={() => onTranslateSelectedAnchors && onTranslateSelectedAnchors(0, -nudgeStep)}
              className="p-1 px-2 text-center bg-[#1f2229] border border-[#2d3039] rounded text-slate-300 hover:text-white hover:bg-[#2d3039] cursor-pointer text-xs font-bold"
            >
              <span className="flex items-center justify-center gap-1">
                南
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"/></svg>
              </span>
            </button>
            <div></div>
          </div>
          
          <div className="flex gap-2 pt-1 font-mono text-[10px]">
            <div className="flex-1">
              <span className="text-slate-500 block">dX (公尺)</span>
              <input 
                id="translate-custom-dx"
                type="number" 
                step="0.05" 
                placeholder="0.0"
                className="w-full bg-[#15171c] border border-[#2d3039] rounded px-1.5 py-0.5 text-xs text-slate-200 font-mono focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseFloat((e.target as HTMLInputElement).value);
                    if (!isNaN(val) && val !== 0 && onTranslateSelectedAnchors) {
                      onTranslateSelectedAnchors(val, 0);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }
                }}
              />
            </div>
            <div className="flex-1">
              <span className="text-slate-500 block">dY (公尺)</span>
              <input 
                id="translate-custom-dy"
                type="number" 
                step="0.05" 
                placeholder="0.0"
                className="w-full bg-[#15171c] border border-[#2d3039] rounded px-1.5 py-0.5 text-xs text-slate-200 font-mono focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = parseFloat((e.target as HTMLInputElement).value);
                    if (!isNaN(val) && val !== 0 && onTranslateSelectedAnchors) {
                      onTranslateSelectedAnchors(0, val);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }
                }}
              />
            </div>
          </div>
          <p className="text-[9px] text-slate-500 text-center italic">在數值欄位輸入後按下 Enter 可立即套用</p>
        </div>
      </div>
    ) : null;

    const getInnerProps = () => {
      switch (selectedElement.type) {
      case 'guideline':
      case 'yellow_double':
      case 'white_double':
      case 'white_dashed':
      case 'yellow_dashed':
      case 'white_solid':
      case 'reversible_lane':
      case 'yield_line':
      case 'BuildingLine': {
        const line = selectedElement as any;
        const lineLen = getLineElementLength(line);
        
        const typeLabels: Record<string, string> = {
          guideline: '輔助切線',
          yellow_double: '分向限制黃雙線',
          white_dashed: '車道白虛線',
          yellow_dashed: '車道黃虛線',
          white_solid: '白色邊線',
          white_double: '白色雙實線',
          reversible_lane: '調撥車道線 (雙白虛線)',
          yield_line: '讓路標線組 (台灣法規式)',
          BuildingLine: '建築線 / 地界紅線'
        };

        const isBezier = !!line.points;

        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039]">
              <h4 className="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>標線幾何資訊 ({isBezier ? '漸變貝茲曲線' : '直行折線'})</span>
              </h4>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400">
                <span>類型:</span> <span className="text-slate-200">{typeLabels[selectedElement.type]}</span>
                <span>設計實體長:</span> <span className="text-blue-400 font-bold">{lineLen.toFixed(2)} m</span>
                {isBezier ? (
                  <>
                    <span>錨點節點數:</span> <span className="text-slate-300">{line.points.length} 點</span>
                    <span>起點:</span> <span className="text-slate-300">({line.points[0].x.toFixed(1)}, {line.points[0].y.toFixed(1)})</span>
                    <span>終點:</span> <span className="text-slate-300">({line.points[line.points.length-1].x.toFixed(1)}, {line.points[line.points.length-1].y.toFixed(1)})</span>
                  </>
                ) : (
                  <>
                    <span>起點 X:</span> <span className="text-slate-300">{line.p1.x.toFixed(2)} m</span>
                    <span>起點 Y:</span> <span className="text-slate-300">{line.p1.y.toFixed(2)} m</span>
                    <span>終點 X:</span> <span className="text-slate-300">{line.p2.x.toFixed(2)} m</span>
                    <span>終點 Y:</span> <span className="text-slate-300">{line.p2.y.toFixed(2)} m</span>
                  </>
                )}
              </div>
            </div>

            {(selectedElement.type === 'white_dashed' || selectedElement.type === 'yellow_dashed') && (
              <div className="space-y-1.5 p-3 bg-[#1f2229]/40 border border-[#2d3039] rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400 font-medium">路口左彎導引線 (30cm寬, 1m固/2m隙)</span>
                  <button
                    id="toggle-left-turn-guide"
                    onClick={() => {
                      onSaveHistory?.();
                      onUpdateElement({
                        ...selectedElement,
                        isLeftTurnGuide: !selectedElement.isLeftTurnGuide
                      });
                    }}
                    className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                      selectedElement.isLeftTurnGuide ? 'bg-blue-600' : 'bg-[#1f2229] border border-[#2d3039]'
                    }`}
                  >
                    <div className={`bg-white w-4 h-4 rounded-full transition-transform ${
                      selectedElement.isLeftTurnGuide ? 'translate-x-5' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs text-slate-400 block">轉換標線類型</label>
              <div className="grid grid-cols-2 gap-1.5">
                {['guideline', 'yellow_double', 'white_double', 'white_dashed', 'yellow_dashed', 'white_solid', 'reversible_lane', 'BuildingLine', 'yield_line'].map((t) => (
                  <button
                    key={t}
                    id={`type-convert-${t}`}
                    onClick={() => {
                      onSaveHistory?.();
                      onUpdateElement({
                        ...selectedElement,
                        type: t as any
                      });
                    }}
                    className={`px-2 py-1.5 text-[10px] rounded border text-center transition-colors cursor-pointer ${
                      selectedElement.type === t 
                        ? 'bg-[#2d3039] border-blue-500/50 text-blue-400 font-medium' 
                        : 'bg-[#1f2229] border-[#2d3039] text-slate-400 hover:text-slate-200 hover:bg-[#2d3039]'
                    }`}
                  >
                    {typeLabels[t] ? typeLabels[t].split(' ')[0] : t}
                  </button>
                ))}
              </div>
            </div>

            <button
              id="delete-line-btn"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(selectedElement.id);
              }}
              className="w-full py-2 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 hover:text-red-300 text-xs rounded transition-colors"
            >
              刪除此標線段
            </button>
          </div>
        );
      }

      case 'bicycle_lane': {
        const bl = selectedElement as any;
        const lineLen = getLineElementLength(bl);
        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039]">
              <h4 className="text-xs font-semibold text-pink-400 mb-2 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>腳踏車專用道 (粉紅色)</span>
              </h4>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400">
                <span>類型:</span> <span className="text-slate-200">腳踏車專用道</span>
                <span>長度 L:</span> <span className="text-blue-400 font-bold">{lineLen.toFixed(2)} m</span>
                <span>寬度 W:</span> <span className="text-slate-250 font-medium">{(bl.width || 1.5).toFixed(1)} m</span>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">變更車道寬度</span>
                <span className="text-pink-400 font-mono font-bold">{(bl.width || 1.5).toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="edit-bicycle-lane-width"
                  type="range"
                  min="0.5"
                  max="5.0"
                  step="0.1"
                  value={bl.width || 1.5}
                  onChange={(e) => {
                    onUpdateElement({
                      ...bl,
                      width: parseFloat(e.target.value)
                    });
                  }}
                  className="flex-1 accent-pink-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="0.5"
                  max="5.0"
                  step="0.1"
                  value={parseFloat((bl.width || 1.5).toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 0.5) val = 0.5;
                      if (val > 5.0) val = 5.0;
                      onUpdateElement({
                        ...bl,
                        width: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <button
              id="delete-bicycle-lane-btn"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(bl.id);
              }}
              className="w-full py-2 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 hover:text-red-300 text-xs rounded transition-colors"
            >
              刪除此腳踏車道
            </button>
          </div>
        );
      }

      case 'parking_space': {
        const pk = selectedElement as any;
        const width = pk.width || 2.0;
        const length = pk.length || 5.0;
        const slotType = pk.slotType || 'car';
        const currentAngle = pk.angle !== undefined ? pk.angle : (pk.p2 && pk.p1 ? Math.atan2(pk.p2.y - pk.p1.y, pk.p2.x - pk.p1.x) : 0);
        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039]">
              <h4 className="text-xs font-semibold text-blue-400 mb-2 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>機汽車停車位設定</span>
              </h4>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400">
                <span>類型:</span> <span className="text-slate-200">{slotType === 'car' ? '汽車停車格' : '機車停車格'}</span>
                <span>長度:</span> <span className="text-slate-300">{length.toFixed(1)} m</span>
                <span>寬度:</span> <span className="text-slate-300">{width.toFixed(1)} m</span>
                <span>線段寬度:</span> <span className="text-slate-300">10 cm</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 block">快速車格設定</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  id="preset-car"
                  onClick={() => {
                    onSaveHistory?.();
                    onUpdateElement({
                      ...pk,
                      slotType: 'car',
                      width: 2.5,
                      length: 5.5
                    });
                  }}
                  className={`px-2 py-2 text-[10px] rounded border text-center transition-colors cursor-pointer ${
                    slotType === 'car'
                      ? 'bg-blue-950/40 border-blue-500/65 text-blue-400 font-bold'
                      : 'bg-[#1f2229] border-[#2d3039] text-slate-400'
                  }`}
                >
                  汽車預設 (2.5m x 5.5m)
                </button>
                <button
                  id="preset-moto"
                  onClick={() => {
                    onSaveHistory?.();
                    onUpdateElement({
                      ...pk,
                      slotType: 'moto',
                      width: 0.8,
                      length: 2.0
                    });
                  }}
                  className={`px-2 py-2 text-[10px] rounded border text-center transition-colors cursor-pointer ${
                    slotType === 'moto'
                      ? 'bg-purple-950/40 border-purple-500/65 text-purple-400 font-bold'
                      : 'bg-[#1f2229] border-[#2d3039] text-slate-400'
                  }`}
                >
                  機車預設 (0.8m x 2m)
                </button>
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">長度汽車5m/機車2m (m)</span>
                <span className="text-slate-200 font-mono font-bold">{length.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="edit-parking-length"
                  type="range"
                  min="1.0"
                  max="8.0"
                  step="0.1"
                  value={length}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    onUpdateElement({
                      ...pk,
                      length: val
                    });
                    if (setParkingStampConfig && parkingStampConfig) {
                      setParkingStampConfig({
                        ...parkingStampConfig,
                        length: val
                      });
                    }
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="1.0"
                  max="8.0"
                  step="0.1"
                  value={parseFloat(length.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 1.0) val = 1.0;
                      if (val > 8.0) val = 8.0;
                      onUpdateElement({
                        ...pk,
                        length: val
                      });
                      if (setParkingStampConfig && parkingStampConfig) {
                        setParkingStampConfig({
                          ...parkingStampConfig,
                          length: val
                        });
                      }
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">寬度汽車2m/機車0.8m (m)</span>
                <span className="text-slate-200 font-mono font-bold">{width.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="edit-parking-width"
                  type="range"
                  min="0.4"
                  max="4.0"
                  step="0.1"
                  value={width}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    onUpdateElement({
                      ...pk,
                      width: val
                    });
                    if (setParkingStampConfig && parkingStampConfig) {
                      setParkingStampConfig({
                        ...parkingStampConfig,
                        width: val
                      });
                    }
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="0.4"
                  max="4.0"
                  step="0.1"
                  value={parseFloat(width.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 0.4) val = 0.4;
                      if (val > 4.0) val = 4.0;
                      onUpdateElement({
                        ...pk,
                        width: val
                      });
                      if (setParkingStampConfig && parkingStampConfig) {
                        setParkingStampConfig({
                          ...parkingStampConfig,
                          width: val
                        });
                      }
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">車位角度 (度)</span>
                <span className="text-slate-200 font-mono font-bold">
                  {Math.round((currentAngle * 180) / Math.PI)}°
                </span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="edit-parking-angle"
                  type="range"
                  min="-180"
                  max="180"
                  step="1"
                  value={Math.round((currentAngle * 180) / Math.PI)}
                  onChange={(e) => {
                    const rad = (parseFloat(e.target.value) * Math.PI) / 180;
                    onUpdateElement({
                      ...pk,
                      angle: rad
                    });
                    if (setParkingStampConfig && parkingStampConfig) {
                      setParkingStampConfig({
                        ...parkingStampConfig,
                        angle: rad
                      });
                    }
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="1"
                  value={Math.round((currentAngle * 180) / Math.PI)}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < -180) val = -180;
                      if (val > 180) val = 180;
                      const rad = (val * Math.PI) / 180;
                      onUpdateElement({
                        ...pk,
                        angle: rad
                      });
                      if (setParkingStampConfig && parkingStampConfig) {
                        setParkingStampConfig({
                          ...parkingStampConfig,
                          angle: rad
                        });
                      }
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5 p-3 bg-[#1f2229]/40 border border-[#2d3039] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">顯示車格尺寸標籤</span>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateElement({
                      ...pk,
                      showSizeLabel: pk.showSizeLabel === false ? true : false
                    });
                  }}
                  className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                    pk.showSizeLabel !== false ? 'bg-blue-600' : 'bg-[#1f2229] border border-[#2d3039]'
                  }`}
                >
                  <div className={`bg-white w-4 h-4 rounded-full transition-transform ${
                    pk.showSizeLabel !== false ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>

            <button
              id="delete-parking-space-btn"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(pk.id);
              }}
              className="w-full py-2 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 hover:text-red-300 text-xs rounded transition-colors"
            >
              刪除此停車格
            </button>
          </div>
        );
      }

      case 'parking_zone': {
        const zone = selectedElement as any;
        const width = zone.width || 2.0;
        const length = zone.length || 5.0;
        const slotType = zone.slotType || 'car';
        const angle = zone.angle !== undefined ? zone.angle : 90;
        const gap = zone.gap !== undefined ? zone.gap : 0.2;
        const side = zone.side || 'right';
        
        const lineLen = getLineElementLength(zone);
        let slotCount = 0;
        try {
          slotCount = generateParkingZoneSlots(zone).length;
        } catch (err) {
          console.warn("Failed to generate slots for counting", err);
        }

        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039]">
              <h4 className="text-xs font-semibold text-cyan-400 mb-2 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>停車區路徑設定</span>
              </h4>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400">
                <span>類型:</span> <span className="text-slate-200">{slotType === 'car' ? '汽車停車區' : '機車停車區'}</span>
                <span>路徑長度:</span> <span className="text-blue-400 font-bold">{lineLen.toFixed(2)} m</span>
                <span>車格數量:</span> <span className="text-cyan-400 font-bold">{slotCount} 格</span>
                <span>車格寬度:</span> <span className="text-slate-300">{width.toFixed(1)} m</span>
                <span>車格長度:</span> <span className="text-slate-300">{length.toFixed(1)} m</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-slate-400 block">快速車格設定</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onSaveHistory?.();
                    onUpdateElement({
                      ...zone,
                      slotType: 'car',
                      width: 2.5,
                      length: 5.5
                    });
                  }}
                  className={`px-2 py-2 text-[10px] rounded border text-center cursor-pointer transition-colors ${
                    slotType === 'car'
                      ? 'bg-blue-950/40 border-blue-500/65 text-blue-400 font-bold'
                      : 'bg-[#1f2229] border-[#2d3039] text-slate-400'
                  }`}
                >
                  汽車預設 (2.5m x 5.5m)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onSaveHistory?.();
                    onUpdateElement({
                      ...zone,
                      slotType: 'motorcycle',
                      width: 0.8,
                      length: 2.0
                    });
                  }}
                  className={`px-2 py-2 text-[10px] rounded border text-center cursor-pointer transition-colors ${
                    slotType === 'motorcycle'
                      ? 'bg-purple-950/40 border-purple-500/65 text-purple-400 font-bold'
                      : 'bg-[#1f2229] border-[#2d3039] text-slate-400'
                  }`}
                >
                  機車預設 (0.8m x 2m)
                </button>
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">長度 (m)</span>
                <span className="text-slate-200 font-mono font-bold">{length.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="1.0"
                  max="8.0"
                  step="0.1"
                  value={length}
                  onChange={(e) => {
                    onUpdateElement({
                      ...zone,
                      length: parseFloat(e.target.value)
                    });
                  }}
                  className="w-full accent-cyan-500 cursor-pointer flex-1"
                />
                <input
                  type="number"
                  min="1.0"
                  max="8.0"
                  step="0.1"
                  value={parseFloat(length.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 1.0) val = 1.0;
                      if (val > 8.0) val = 8.0;
                      onUpdateElement({
                        ...zone,
                        length: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">寬度 (m)</span>
                <span className="text-slate-200 font-mono font-bold">{width.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.4"
                  max="4.0"
                  step="0.1"
                  value={width}
                  onChange={(e) => {
                    onUpdateElement({
                      ...zone,
                      width: parseFloat(e.target.value)
                    });
                  }}
                  className="w-full accent-cyan-500 cursor-pointer flex-1"
                />
                <input
                  type="number"
                  min="0.4"
                  max="4.0"
                  step="0.1"
                  value={parseFloat(width.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 0.4) val = 0.4;
                      if (val > 4.0) val = 4.0;
                      onUpdateElement({
                        ...zone,
                        width: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">相對切線偏角 (度)</span>
                <span className="text-slate-200 font-mono font-bold">{angle}°</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="-180"
                  max="180"
                  step="5"
                  value={angle}
                  onChange={(e) => {
                    onUpdateElement({
                      ...zone,
                      angle: parseInt(e.target.value)
                    });
                  }}
                  className="w-full accent-cyan-500 cursor-pointer flex-1"
                />
                <input
                  type="number"
                  min="-180"
                  max="180"
                  step="1"
                  value={angle}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < -180) val = -180;
                      if (val > 180) val = 180;
                      onUpdateElement({
                        ...zone,
                        angle: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">車格間距 (m)</span>
                <span className="text-slate-200 font-mono font-bold">{gap.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0.0"
                  max="3.0"
                  step="0.1"
                  value={gap}
                  onChange={(e) => {
                    onUpdateElement({
                      ...zone,
                      gap: parseFloat(e.target.value)
                    });
                  }}
                  className="w-full accent-cyan-500 cursor-pointer flex-1"
                />
                <input
                  type="number"
                  min="0.0"
                  max="3.0"
                  step="0.1"
                  value={parseFloat(gap.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 0.0) val = 0.0;
                      if (val > 3.0) val = 3.0;
                      onUpdateElement({
                        ...zone,
                        gap: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="space-y-1.5 p-3 bg-[#1f2229]/40 border border-[#2d3039] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">配置於路徑左側</span>
                <button
                  type="button"
                  onClick={() => {
                    onSaveHistory?.();
                    onUpdateElement({
                      ...zone,
                      side: side === 'right' ? 'left' : 'right'
                    });
                  }}
                  className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                    side === 'left' ? 'bg-cyan-600' : 'bg-[#1f2229] border border-[#2d3039]'
                  }`}
                >
                  <div className={`bg-white w-4 h-4 rounded-full transition-transform ${
                    side === 'left' ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>

            <div className="space-y-1.5 p-3 bg-[#1f2229]/40 border border-[#2d3039] rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">顯示車格尺寸標籤</span>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateElement({
                      ...zone,
                      showSizeLabel: zone.showSizeLabel === false ? true : false
                    });
                  }}
                  className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                    zone.showSizeLabel !== false ? 'bg-cyan-600' : 'bg-[#1f2229] border border-[#2d3039]'
                  }`}
                >
                  <div className={`bg-white w-4 h-4 rounded-full transition-transform ${
                    zone.showSizeLabel !== false ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>

            <button
              type="button"
              id="delete-parking-zone-btn"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(zone.id);
              }}
              className="w-full py-2 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 hover:text-red-300 text-xs rounded transition-colors"
            >
              刪除此停車區
            </button>
          </div>
        );
      }

      case 'sketch_circle': {
        const circ = selectedElement as any;
        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-2">
              <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>圓形草稿輔助線</span>
              </h4>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400">
                <span>類型:</span> <span className="text-slate-200">Sketch 圓形輔助</span>
                <span>圓心 X:</span> <span className="text-slate-300">{circ.center.x.toFixed(2)} m</span>
                <span>圓心 Y:</span> <span className="text-slate-300">{circ.center.y.toFixed(2)} m</span>
                <span>圓直徑 D:</span> <span className="text-slate-350">{(circ.radius * 2).toFixed(2)} m</span>
                <span>面積 A:</span> <span className="text-slate-350">{(Math.PI * circ.radius * circ.radius).toFixed(1)} m²</span>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">變更圓半徑大小</span>
                <span className="text-blue-400 font-mono font-bold">{circ.radius.toFixed(1)} m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="edit-circle-radius"
                  type="range"
                  min="0.5"
                  max="40.0"
                  step="0.5"
                  value={circ.radius}
                  onChange={(e) => {
                    onUpdateElement({
                      ...circ,
                      radius: parseFloat(e.target.value)
                    });
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="0.5"
                  max="40.0"
                  step="0.5"
                  value={parseFloat(circ.radius.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 0.5) val = 0.5;
                      if (val > 40.0) val = 40.0;
                      onUpdateElement({
                        ...circ,
                        radius: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <button
              id="delete-circle-btn"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(circ.id);
              }}
              className="w-full py-2 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 hover:text-red-300 text-xs rounded transition-colors"
            >
              刪除此草稿圓
            </button>
          </div>
        );
      }

      case 'three_center_curve': {
        const curve = selectedElement as ThreeCenterCurveElement;
        const curveSuggestedWidth = calculateWidening(curve.R2, designVehicle);
        
        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-2">
              <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>三心曲線參數</span>
              </h4>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400">
                <span>主半徑 R2:</span> <span className="text-blue-400 font-bold">{curve.R2.toFixed(1)} m</span>
                <span>漸變 R1 (3R2):</span> <span>{curve.R1.toFixed(1)} m</span>
                <span>漸變 R3 (3R2):</span> <span>{curve.R3.toFixed(1)} m</span>
                <span>圓弧取樣點:</span> <span>{curve.points.length} 點</span>
              </div>
            </div>

            <div className="p-4 bg-blue-500/5 rounded-xl border border-blue-500/10 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-blue-400 font-bold uppercase tracking-wider">路幅加寬規範</span>
                <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/30 px-1.5 py-0.5 rounded font-mono">
                  寬度擴充
                </span>
              </div>
              <p className="text-[10px] text-slate-400 leading-normal">
                依據主彎道 <strong className="text-slate-200">{curve.R2}m</strong> 及當前選擇的
                <strong className="text-slate-200">「{designVehicle === 'passenger' ? '普通車' : '聯結車'}」</strong>
                ，導流車道安全淨寬 w 應為：
              </p>
              <div className="text-center py-2 bg-blue-950/20 rounded border border-blue-900/30">
                <span className="text-xs text-slate-400">建議導流路幅寬</span>
                <div className="text-xl font-mono font-bold text-blue-400">{curveSuggestedWidth.toFixed(2)} 實體米</div>
              </div>

              <button
                id="btn-offset-island"
                onClick={() => {
                  onSaveHistory?.();
                  onGenerateIslandFromCurve(curve);
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs rounded shadow-lg shadow-blue-500/20 transition-all uppercase tracking-wider cursor-pointer font-bold"
              >
                <Triangle className="w-3.5 h-3.5" />
                <span>一鍵生成導流島</span>
              </button>
            </div>

            <button
              id="delete-curve-btn"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(selectedElement.id);
              }}
              className="w-full py-1.5 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 text-xs rounded transition-colors"
            >
              刪除三心曲線
            </button>
          </div>
        );
      }

      case 'island': {
        const island = selectedElement as IslandElement;
        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-2">
              <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>導流島幾何資訊</span>
              </h4>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400">
                <span>外側道路寬 $w$:</span> <span className="text-blue-400 font-bold">{island.laneWidth.toFixed(2)} m</span>
                <span>設計基準車:</span> <span>{island.designVehicle === 'passenger' ? '普通車' : island.designVehicle === 'semi_trailer' ? '大貨車' : '聯結車 (WB15)'}</span>
                <span>封閉多邊形:</span> <span>{island.points.length} 節點</span>
                <span>槽化線斜線:</span> <span className={island.hasHatching ? 'text-amber-500 font-semibold' : 'text-slate-500'}>{island.hasHatching ? '開啟' : '關閉'}</span>
              </div>
            </div>

            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-2">
              <label className="text-xs text-slate-400 block font-semibold">槽化島線色設定</label>
              <div className="flex gap-2">
                {[
                  { name: '法規白色', value: '#ffffff' },
                  { name: '槽化黃色', value: '#FFCC00' }
                ].map((colorOpt) => (
                  <button
                    key={colorOpt.value}
                    onClick={() => {
                      onSaveHistory?.();
                      onUpdateElement({
                        ...island,
                        color: colorOpt.value
                      });
                    }}
                    className={`flex-1 py-1.5 text-[10px] rounded border text-center transition-colors cursor-pointer ${
                      (island.color || '#ffffff') === colorOpt.value
                        ? 'bg-[#2d3039] border-blue-500/50 text-blue-400 font-medium'
                        : 'bg-[#1f2229] border-[#2d3039] text-slate-400'
                    }`}
                  >
                    {colorOpt.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-400">槽化線填充 (Hatching)</label>
                <button
                  id="toggle-hatching-btn"
                  onClick={() => {
                    onSaveHistory?.();
                    onUpdateElement({
                      ...island,
                      hasHatching: !island.hasHatching
                    });
                  }}
                  className={`w-10 h-5 rounded-full p-0.5 transition-colors cursor-pointer ${
                    island.hasHatching ? 'bg-blue-600' : 'bg-[#1f2229] border border-[#2d3039]'
                  }`}
                >
                  <div className={`bg-white w-4 h-4 rounded-full transition-transform ${
                    island.hasHatching ? 'translate-x-5' : 'translate-x-0'
                  }`} />
                </button>
              </div>

              {island.hasHatching && (
                <p className="text-[10px] text-slate-500 italic leading-snug">
                  * 依交通部《道路交通標誌標線號誌設置規則》，槽化線線寬15-20cm，採 45 度斜率，常規劃設 30-50cm 等距間隔。畫布採實體尺寸真實描繪。
                </p>
              )}
            </div>

            <button
              id="delete-island-btn"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(selectedElement.id);
              }}
              className="w-full py-2 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 text-xs rounded transition-colors"
            >
              刪除此導流島
            </button>
          </div>
        );
      }

      case 'text': {
        const txt = selectedElement as TextElement;
        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-2">
              <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>文字標記內容設定</span>
              </h4>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400">
                <span>類型:</span> <span className="text-slate-200">文字標記 (Text)</span>
                <span>內容:</span> <span className="text-blue-400 font-bold truncate max-w-[120px]">{txt.text || "(未命名)"}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-slate-400">工程標記文字</label>
              <input
                id="edit-text-input"
                type="text"
                value={txt.text}
                onChange={(e) => {
                  onUpdateElement({
                    ...txt,
                    text: e.target.value
                  });
                }}
                className="w-full bg-[#1f2229] border border-[#2d3039] px-3 py-2 text-xs rounded text-white focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-400">文字高度尺寸 (m)</span>
                <span className="text-blue-400 font-mono">{txt.fontSize.toFixed(1)}m</span>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="edit-text-size"
                  type="range"
                  min="0.5"
                  max="5.0"
                  step="0.1"
                  value={txt.fontSize}
                  onChange={(e) => {
                    onUpdateElement({
                      ...txt,
                      fontSize: parseFloat(e.target.value)
                    });
                  }}
                  className="flex-1 accent-blue-500 cursor-pointer"
                />
                <input
                  type="number"
                  min="0.5"
                  max="5.0"
                  step="0.1"
                  value={parseFloat(txt.fontSize.toFixed(1))}
                  onChange={(e) => {
                    let val = parseFloat(e.target.value);
                    if (!isNaN(val)) {
                      if (val < 0.5) val = 0.5;
                      if (val > 5.0) val = 5.0;
                      onUpdateElement({
                        ...txt,
                        fontSize: val
                      });
                    }
                  }}
                  className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                />
              </div>
            </div>

            <button
              id="delete-text-btn"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(selectedElement.id);
              }}
              className="w-full py-2 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 text-xs rounded transition-colors"
            >
              刪除此文字標記
            </button>
          </div>
        );
      }

      case 'smart_path': {
        const sp = selectedElement as any;
        const activeVeh = sp.designVehicle || designVehicle;

        // Calculate maximum steering angle based on the curve points
        const tempPts: Point2D[] = [];
        if (sp.points && sp.points.length > 1) {
          for (let jj = 0; jj < sp.points.length - 1; jj++) {
            const pStart = sp.points[jj];
            const cpStart = sp.cpRight[jj] || pStart;
            const cpEnd = sp.cpLeft[jj + 1] || sp.points[jj + 1];
            const pEnd = sp.points[jj + 1];
            const samples = sampleCubicBezier(pStart, cpStart, cpEnd, pEnd, 30);
            if (jj === 0) {
              tempPts.push(...samples);
            } else {
              tempPts.push(...samples.slice(1));
            }
          }
        }
        const maxSteeringAngle = getMaxSteeringAngleForPath(tempPts, activeVeh);
        const isSafe = maxSteeringAngle <= 40;

        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-2">
              <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>貝茲自由標線 (車流軌跡)</span>
              </h4>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400">
                <span>類型:</span> <span className="text-slate-200">自由貝茲車道線</span>
                <span>設計車種:</span> <span className="text-blue-400 font-bold">{activeVeh === 'passenger' ? '小客車' : activeVeh === 'semi_trailer' ? '大客車' : '聯結車'}</span>
                <span>控制端點數:</span> <span className="text-slate-300">{sp.points?.length || 0} 個</span>
                <span>最大轉向角:</span> <span className={`${isSafe ? 'text-green-400 font-bold' : 'text-red-400 font-bold'}`}>{maxSteeringAngle ? `${maxSteeringAngle.toFixed(1)}°` : '0°'}</span>
                <span>最大限制角度:</span> <span className="text-slate-400 font-bold">40.0°</span>
              </div>
            </div>

            {/* Custom vehicle selector for this specific swept path */}
            <div className="space-y-2 p-3 bg-[#1f2229]/40 border border-[#2d3039] rounded-lg">
              <label className="text-[10.5px] font-bold text-slate-400 block">此軌跡模擬車型</label>
              <div className="grid grid-cols-3 gap-1 pt-1">
                {[
                  { value: 'passenger', label: '小客車' },
                  { value: 'semi_trailer', label: '大客車' },
                  { value: 'articulated', label: '聯結車' }
                ].map((v) => {
                  const isActive = activeVeh === v.value;
                  return (
                    <button
                      key={v.value}
                      onClick={() => {
                        onSaveHistory?.();
                        onUpdateElement({
                          ...sp,
                          designVehicle: v.value as any
                        });
                      }}
                      className={`py-1.5 text-[10.5px] font-bold rounded border transition-all cursor-pointer text-center ${
                        isActive 
                          ? 'bg-blue-600 text-white border-blue-500 shadow-sm' 
                          : 'bg-[#14161c] hover:bg-[#1f2229] border-[#2d3039] text-slate-450'
                      }`}
                    >
                      {v.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] text-slate-500 leading-normal pt-1">
                變更此車型可即時模擬不同車廂/聯結車型軌跡掃掠寬度。
              </p>
            </div>

            <div className={`p-3 rounded-lg border text-xs leading-snug flex flex-col gap-1 ${
              isSafe 
                ? 'bg-green-950/20 border-green-800/20 text-green-300' 
                : 'bg-red-950/20 border-red-800/20 text-red-300 animate-pulse'
            }`}>
              <div className="font-bold flex items-center gap-1">
                <span>{isSafe ? '✅ 安全轉向合格' : '❌ 轉向超限警告'}</span>
              </div>
              <p className="text-[10px] text-slate-400">
                {isSafe 
                  ? `符合該車種 (${activeVeh === 'passenger' ? '小客車' : activeVeh === 'semi_trailer' ? '大客車' : '聯結車'}) 最大40度轉向角限制。` 
                  : `警告！車輛瞬間轉角為 ${maxSteeringAngle.toFixed(1)}°，高於法規規範 40° 限制。`}
              </p>
            </div>

            <button
              id="delete-smartpath-btn"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(selectedElement.id);
              }}
              className="w-full py-2 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 hover:text-red-350 text-xs rounded transition-colors"
            >
              刪除此曲線標線
            </button>
          </div>
        );
      }

      case 'crosswalk': {
        const cw = selectedElement as any;
        const lenA = distance(cw.pA1, cw.pA2);
        const lenB = distance(cw.pB1, cw.pB2);

        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-2">
              <h4 className="text-xs font-semibold text-slate-350 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>行穿線 (Crosswalk)</span>
              </h4>
              <p className="text-[10px] text-slate-450 leading-normal">
                枕木紋行人穿越道線：線寬及間隔符合公路標線《設置規則》第185條 **40cm (0.4m)** 規範。
              </p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400 pt-1">
                <span>起點線長 (Line A):</span> <span className="text-slate-200">{lenA.toFixed(2)} m</span>
                <span>終點線長 (Line B):</span> <span className="text-slate-200">{lenB.toFixed(2)} m</span>
              </div>
            </div>

            <div className="space-y-3 p-3 bg-[#1f2229]/40 border border-[#2d3039] rounded-lg">
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">客製化標線寬度</span>
                  <span className="text-emerald-400 font-mono">{(cw.stripeWidth ?? 0.4).toFixed(2)} m</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="edit-crosswalk-width"
                    type="range"
                    min="0.30"
                    max="0.80"
                    step="0.05"
                    value={cw.stripeWidth ?? 0.4}
                    onChange={(e) => {
                      onUpdateElement({
                        ...cw,
                        stripeWidth: parseFloat(e.target.value)
                      });
                    }}
                    className="flex-1 accent-emerald-500 cursor-pointer"
                  />
                  <input
                    type="number"
                    min="0.30"
                    max="0.80"
                    step="0.05"
                    value={parseFloat((cw.stripeWidth ?? 0.4).toFixed(2))}
                    onChange={(e) => {
                      let val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        if (val < 0.30) val = 0.30;
                        if (val > 0.80) val = 0.80;
                        onUpdateElement({
                          ...cw,
                          stripeWidth: val
                        });
                      }
                    }}
                    className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">客製化標線間距</span>
                  <span className="text-emerald-400 font-mono">{(cw.stripeGap ?? 0.4).toFixed(2)} m</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="edit-crosswalk-gap"
                    type="range"
                    min="0.30"
                    max="0.80"
                    step="0.05"
                    value={cw.stripeGap ?? 0.4}
                    onChange={(e) => {
                      onUpdateElement({
                        ...cw,
                        stripeGap: parseFloat(e.target.value)
                      });
                    }}
                    className="flex-1 accent-emerald-500 cursor-pointer"
                  />
                  <input
                    type="number"
                    min="0.30"
                    max="0.80"
                    step="0.05"
                    value={parseFloat((cw.stripeGap ?? 0.4).toFixed(2))}
                    onChange={(e) => {
                      let val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        if (val < 0.30) val = 0.30;
                        if (val > 0.80) val = 0.80;
                        onUpdateElement({
                          ...cw,
                          stripeGap: val
                        });
                      }
                    }}
                    className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            <button
              id="delete-crosswalk-btn"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(selectedElement.id);
              }}
              className="w-full py-2 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 hover:text-red-350 text-xs rounded transition-colors"
            >
              刪除此行穿線
            </button>
          </div>
        );
      }

      case 'road_arrow': {
        const arrow = selectedElement as any;
        const arrowType = arrow.arrowType;
        const length = arrow.length;
        const angleDeg = Math.round((arrow.angle * 180) / Math.PI);
        const arrowLabels: Record<string, string> = {
          straight: '直行',
          left: '左轉',
          right: '右轉',
          straight_left: '直行左轉',
          straight_right: '直行右轉'
        };

        return (
          <div className="space-y-4">
            <div className="p-3 bg-[#1f2229]/40 rounded-lg border border-[#2d3039] space-y-2">
              <h4 className="text-xs font-semibold text-slate-350 flex items-center gap-1.5">
                {renderPropsIcon(selectedElement.type)}
                <span>路面指向線 (Direction Arrow)</span>
              </h4>
              <p className="text-[10px] text-slate-455 leading-normal">
                指示車輛行駛方向之指向線標記。
              </p>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[10px] text-slate-400 pt-1">
                <span>中心坐標 X:</span> <span className="text-slate-200">{arrow.p.x.toFixed(2)} m</span>
                <span>中心坐標 Y:</span> <span className="text-slate-200">{arrow.p.y.toFixed(2)} m</span>
              </div>
            </div>

            <div className="space-y-3 p-3 bg-[#1f2229]/40 border border-[#2d3039] rounded-lg">
              <div className="space-y-1.5 text-xs">
                <label className="text-slate-400 block font-medium">箭頭類型</label>
                <select
                  value={arrowType}
                  onChange={(e) => {
                    onUpdateElement({
                      ...arrow,
                      arrowType: e.target.value as any
                    });
                  }}
                  className="w-full bg-[#1f2229] border border-[#2d3039] px-2 py-1.5 rounded text-white focus:outline-none focus:border-blue-500 text-xs"
                >
                  {Object.entries(arrowLabels).map(([val, label]) => (
                    <option key={val} value={val} className="bg-[#14161c]">{label}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">長度 (m)</span>
                  <span className="text-slate-200 font-mono font-bold">{length.toFixed(1)} m</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="1.0"
                    max="10.0"
                    step="0.1"
                    value={length}
                    onChange={(e) => {
                      onUpdateElement({
                        ...arrow,
                        length: parseFloat(e.target.value)
                      });
                    }}
                    className="flex-1 accent-blue-500 cursor-pointer"
                  />
                  <input
                    type="number"
                    min="1.0"
                    max="10.0"
                    step="0.1"
                    value={parseFloat(length.toFixed(1))}
                    onChange={(e) => {
                      let val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        if (val < 1.0) val = 1.0;
                        if (val > 10.0) val = 10.0;
                        onUpdateElement({
                          ...arrow,
                          length: val
                        });
                      }
                    }}
                    className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">旋轉偏角 (度)</span>
                  <span className="text-slate-200 font-mono font-bold">{angleDeg}°</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="-180"
                    max="180"
                    step="1"
                    value={angleDeg}
                    onChange={(e) => {
                      const rad = (parseFloat(e.target.value) * Math.PI) / 180;
                      onUpdateElement({
                        ...arrow,
                        angle: rad
                      });
                    }}
                    className="flex-1 accent-blue-500 cursor-pointer"
                  />
                  <input
                    type="number"
                    min="-180"
                    max="180"
                    step="1"
                    value={angleDeg}
                    onChange={(e) => {
                      let val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        if (val < -180) val = -180;
                        if (val > 180) val = 180;
                        onUpdateElement({
                          ...arrow,
                          angle: (val * Math.PI) / 180
                        });
                      }
                    }}
                    className="w-16 bg-[#1f2229] border border-[#2d3039] px-1 py-0.5 rounded text-white text-right focus:outline-none focus:border-blue-500 font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                onSaveHistory?.();
                onDeleteElement(selectedElement.id);
              }}
              className="w-full py-2 bg-red-950/20 text-red-400 border border-red-950/40 hover:bg-red-950/40 hover:text-red-350 text-xs rounded transition-colors"
            >
              刪除此指向線標記
            </button>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <>
      {selectedAnchorsUI}
      {getInnerProps()}
    </>
  );
};

  return (
    <div id="right-property-panel" className="bg-[#14161c] w-full h-full p-4 flex flex-col select-none">
      <div className="space-y-5 overflow-y-auto flex-1 pr-1">
        
        {/* Module Title */}
        <div className="flex items-center gap-2 border-b border-[#2d3039] pb-3">
          <Settings className="w-4 h-4 text-slate-500" />
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-widest">屬性控制台</h3>
        </div>



        {/* Selected Element Controls (Render Dynamic) */}
        <div className="pt-1 space-y-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            <h4 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">所選 CAD 特徵點控制</h4>
          </div>
          {renderSelectedElementProps()}
        </div>

      </div>
    </div>
  );
}
