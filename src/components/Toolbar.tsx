import React from 'react';
import { CadTool } from '../types';
import { 
  Trash2, 
  RefreshCw
} from 'lucide-react';
import { arrowData } from '../arrowData';

interface ToolbarProps {
  activeTool: CadTool;
  setActiveTool: (tool: CadTool) => void;
  onLoadDemo: () => void;
  designVehicle: 'passenger' | 'semi_trailer' | 'articulated';
  setDesignVehicle: (v: 'passenger' | 'semi_trailer' | 'articulated') => void;
  snapToGrid: boolean;
  setSnapToGrid: (b: boolean) => void;
  snapToEndpoint: boolean;
  setSnapToEndpoint: (b: boolean) => void;
  snapToMidpoint: boolean;
  setSnapToMidpoint: (b: boolean) => void;
  snapToNearest: boolean;
  setSnapToNearest: (b: boolean) => void;
  roadArrowConfig?: { arrowType: 'straight' | 'left' | 'right' | 'straight_left' | 'straight_right'; length: number; angle: number };
  setRoadArrowConfig?: (cfg: any) => void;
}

// Render dynamic custom professional vector Traffic CAD SVGs
export function renderToolIcon(id: CadTool) {
  switch (id) {
    case 'select':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" fill="currentColor" />
          <path d="M13 13l6 6" />
        </svg>
      );
    case 'sketch_circle':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="12" cy="12" r="8" strokeDasharray="3,3" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'guideline':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" strokeDasharray="3,3" />
        </svg>
      );
    case 'yellow_double':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" strokeWidth="2.5">
          <line x1="8" y1="3" x2="8" y2="21" stroke="#f5b400" />
          <line x1="16" y1="3" x2="16" y2="21" stroke="#f5b400" />
        </svg>
      );
    case 'white_double':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="2.5">
          <line x1="8" y1="3" x2="8" y2="21" />
          <line x1="16" y1="3" x2="16" y2="21" />
        </svg>
      );
    case 'white_solid':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="3">
          <line x1="12" y1="3" x2="12" y2="21" />
        </svg>
      );
    case 'white_dashed':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="5,4" />
        </svg>
      );
    case 'yellow_dashed':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="#f5b400" strokeWidth="2">
          <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="5,4" />
        </svg>
      );
    case 'crossing_dashed':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="3">
          <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="3,3" />
        </svg>
      );
    case 'stop_line':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="4">
          <line x1="3" y1="12" x2="21" y2="12" />
        </svg>
      );
    case 'yield_line':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="currentColor" stroke="none">
          {[3, 9, 15].map(x => <rect key={`a${x}`} x={x} y="3" width="4" height="2.2" />)}
          {[3, 9, 15].map(x => <rect key={`b${x}`} x={x} y="7" width="4" height="2.2" />)}
          <path d="M5 12h14l-7 10z M8.6 14l3.4 5.2 3.4-5.2z" fillRule="evenodd" />
        </svg>
      );
    case 'BuildingLine':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 21h18M5 21V8l7-4 7 4v13" />
          <line x1="9" y1="12" x2="15" y2="12" />
          <line x1="9" y1="16" x2="15" y2="16" />
        </svg>
      );
    case 'reversible_lane':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="2" xmlns="http://www.w3.org/2000/svg">
  <line x1="8" y1="3" x2="8" y2="21" strokeDasharray="5,4" />
  
  <line x1="16" y1="3" x2="16" y2="21" strokeDasharray="5,4" />
</svg>
      );
    case 'Sidewalk':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.2">
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
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="4" y="4" width="16" height="16" rx="1.5" />
          <line x1="4" y1="12" x2="12" y2="4" />
          <line x1="4" y1="20" x2="20" y2="4" />
          <line x1="12" y1="20" x2="20" y2="12" />
        </svg>
      );
    case 'crosswalk':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="currentColor" stroke="none">
          {[3, 7.5, 12, 16.5].map(x => <rect key={x} x={x} y="5" width="2.6" height="14" />)}
                  </svg>
      );
    case 'bicycle_lane':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
          <circle cx="5.5" cy="15.5" r="3.5" />
          <circle cx="18.5" cy="15.5" r="3.5" />
          <path d="M5.5 15.5L9 9h7l2.5 6.5M9 9l3.5 6.5L16 9M8 6.5h3M15 6.5h2l-1 2.5" />
        </svg>
      );
    case 'parking_space':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          {/* Vertical rectangle 2.5:5.5 ratio => width 8, height 17.6 */}
          <rect x="8" y="3.2" width="8" height="17.6" rx="1.5" />
          {/* Clear P letter - vertical stroke + semicircle bump */}
          <path d="M10.5 15V8h2.5a2 2 0 0 1 0 4H10.5" strokeWidth="1.8" />
        </svg>
      );
    case 'parking_zone':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          {/* P letter on top center - larger and clearer */}
          <path d="M10.5 7.5V2h3a1.5 1.5 0 0 1 0 3h-3" strokeWidth="1.8" />
          {/* Two vertical rectangles, 2.5:5.5 ratio => width 5, height 11. Moved closer (x=5 and x=14) */}
          <rect x="5" y="9" width="5" height="11" rx="1" fill="currentColor" fillOpacity="0.1" />
          <rect x="14" y="9" width="5" height="11" rx="1" fill="currentColor" fillOpacity="0.1" />
          {/* Horizontal dashed line through middle */}
          <line x1="2" y1="14.5" x2="22" y2="14.5" strokeDasharray="2,2" />
          {/* Endpoints */}
          <circle cx="2" cy="14.5" r="1.5" fill="currentColor" />
          <circle cx="22" cy="14.5" r="1.5" fill="currentColor" />
        </svg>
      );
    case 'smart_path':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="6" y="4" width="12" height="16" rx="3" />
          <path d="M8 9h8" />
          <rect x="8" y="10" width="8" height="6" rx="1" fill="currentColor" fillOpacity="0.1" />
          <rect x="4" y="6" width="2" height="3" rx="0.5" fill="currentColor" />
          <rect x="18" y="6" width="2" height="3" rx="0.5" fill="currentColor" />
          <rect x="4" y="15" width="2" height="3" rx="0.5" fill="currentColor" />
          <rect x="18" y="15" width="2" height="3" rx="0.5" fill="currentColor" />
        </svg>
      );
    case 'road_arrow': {
      const data = arrowData['straight_right'];
      if (!data) return null;
      const aspect = data.aspectRatio;
      const pointsString = data.points.map(pt => {
        const svgX = (pt.x / aspect + 0.5) * 16 + 4; // 縮小到 16px 寬度，留 4px margins
        const svgY = (1.0 - pt.y) * 18 + 3; // 18px 高度，留 3px margins
        return `${svgX.toFixed(2)},${svgY.toFixed(2)}`;
      }).join(' ');

      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="currentColor" stroke="none">
          <polygon points={pointsString} />
        </svg>
      );
    }
    case 'measurement':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="7" x2="3" y2="17" strokeWidth="2" />
          <line x1="21" y1="7" x2="21" y2="17" strokeWidth="2" />
        </svg>
      );
    case 'angular_dimension':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 20h18M3 20L15 4" strokeLinecap="round" />
          <path d="M10 20a7 7 0 0 0-2.8-5.6" strokeWidth="1.6" />
        </svg>
      );
    case 'arc_3point':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 18 A 8.2 8.2 0 0 1 20 18" />
          <circle cx="4" cy="18" r="1.8" fill="currentColor" />
          <circle cx="12" cy="11.6" r="1.8" fill="currentColor" />
          <circle cx="20" cy="18" r="1.8" fill="currentColor" />
        </svg>
      );

    case 'red_solid':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" strokeWidth="3">
          <line x1="4" y1="18" x2="20" y2="18" stroke="#ef4444" />
          <rect x="4" y="5" width="16" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'yellow_solid':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" strokeWidth="3">
          <line x1="4" y1="18" x2="20" y2="18" stroke="#f5b400" />
          <rect x="4" y="5" width="16" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      );
    case 'grid_box':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="#f5b400" strokeWidth="1.3">
          <rect x="4" y="4" width="16" height="16" />
          <path d="M4 12L12 4M4 20L20 4M12 20L20 12M4 12L12 20M4 4L20 20M12 4L20 12" />
        </svg>
      );
    case 'moto_box':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
          <rect x="2.5" y="4" width="19" height="16" rx="1" />
          <circle cx="7.5" cy="15" r="2" />
          <circle cx="16.5" cy="15" r="2" />
          <path d="M9.5 15h4l1.5-4.5h-3M15 10.5l1.5 4.5M10 10.5h2" />
        </svg>
      );
    case 'moto_turn_box':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
          <rect x="2.5" y="9" width="19" height="11" rx="1" />
          <circle cx="7.5" cy="16.5" r="1.7" />
          <circle cx="16.5" cy="16.5" r="1.7" />
          <path d="M9.2 16.5h5.6l-1.3-3.5h-2.5" />
          <path d="M18 7V5.5a2 2 0 0 0-2-2H8M10 1.5l-2 2 2 2" />
        </svg>
      );
    case 'road_text':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="currentColor" stroke="none">
          <text x="12" y="19.5" textAnchor="middle" fontSize="18" fontWeight="700" fontFamily='"Noto Sans TC", "Microsoft JhengHei", sans-serif' transform="translate(12 0) scale(0.62 1) translate(-12 0)">慢</text>
        </svg>
      );
    case 'text_label':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M5 6h14M12 6v13M9 19h6" />
        </svg>
      );

    default:
      return null;
  }
}

export default function Toolbar({ 
  activeTool, 
  setActiveTool, 
  onLoadDemo,
  designVehicle,
  setDesignVehicle,
  snapToGrid,
  setSnapToGrid,
  snapToEndpoint,
  setSnapToEndpoint,
  snapToMidpoint,
  setSnapToMidpoint,
  snapToNearest,
  setSnapToNearest,
  roadArrowConfig,
  setRoadArrowConfig
}: ToolbarProps) {
  
  const categories = [
    {
      title: "標線",
      items: [
        { id: 'yellow_double' as CadTool, desc: '分向限制線（雙黃實線）' },
        { id: 'white_double' as CadTool, desc: '雙白實線' },
        { id: 'white_solid' as CadTool, desc: '路面邊線：15 cm 白實線' },
        { id: 'white_dashed' as CadTool, desc: '車道線：白虛線（4 m 實線、6 m 間距）' },
        { id: 'yellow_dashed' as CadTool, desc: '分向線：黃虛線（4 m 實線、6 m 間距）' },
        { id: 'crossing_dashed' as CadTool, desc: '穿越虛線／路口指示線：30 cm 寬' },
        { id: 'stop_line' as CadTool, desc: '停止線：30～40 cm 白實線' },
        { id: 'yield_line' as CadTool, desc: '讓路線：兩排方塊＋倒三角形' },
        { id: 'BuildingLine' as CadTool, desc: '建築線：地籍或人行道邊界參考線' },
        { id: 'reversible_lane' as CadTool, desc: '調撥車道線：雙白虛線' },
        { id: 'red_solid' as CadTool, desc: '禁止臨時停車線：紅實線' },
        { id: 'yellow_solid' as CadTool, desc: '禁止停車線：黃實線' }
      ]
    },
    {
      title: "區塊",
      items: [
        { id: 'Sidewalk' as CadTool, desc: '人行道鋪面：多邊形區域' },
        { id: 'channelization' as CadTool, desc: '槽化線：外框與斜紋（白／黃）' },
        { id: 'crosswalk' as CadTool, desc: '行人穿越道線（枕木紋）：依序點四點' },
        { id: 'bicycle_lane' as CadTool, desc: '自行車道：粉紅色鋪面' },
        { id: 'parking_space' as CadTool, desc: '停車格：汽車、機車位印章' },
        { id: 'parking_zone' as CadTool, desc: '停車區：沿路徑自動排列車格' },
        { id: 'road_arrow' as CadTool, desc: '指向線：點擊自動對齊車道方向' },
        { id: 'grid_box' as CadTool, desc: '網狀線：黃色交叉斜紋' },
        { id: 'moto_box' as CadTool, desc: '機車停等區：依序點三點' },
        { id: 'moto_turn_box' as CadTool, desc: '機車待轉區：依序點三點' },
        { id: 'road_text' as CadTool, desc: '路面標字：慢、停、公車專用…' }
      ]
    },
    {
      title: "量測與工具",
      items: [
        { id: 'measurement' as CadTool, desc: '測距工具：測量兩點距離，支援對齊其他線段與垂線吸附' },
        { id: 'angular_dimension' as CadTool, desc: '角度標註：點選夾角頂點與兩線端點，標示並測量夾角' },
        { id: 'arc_3point' as CadTool, desc: '三點圓弧：依序點選起點、圓弧上一點及終點繪製圓弧標線' },
        { id: 'guideline' as CadTool, desc: '輔助線：對齊用，不出圖' },
        { id: 'sketch_circle' as CadTool, desc: '輔助圓：畫圓輔助與圓角半徑標定' },
        { id: 'text_label' as CadTool, desc: '文字標註：點擊後輸入文字' }
      ]
    }
  ];

  return (
    <div 
      id="left-toolbar" 
      className="flex flex-col bg-[#14161c] border-r border-[#2d3039] w-[110px] h-full p-2 justify-between select-none overflow-y-auto shrink-0"
    >
      <div className="space-y-4">
        {/* CAD Brand Mini Header */}
        <div className="flex flex-col items-center justify-center py-2 border-b border-[#2d3039]/40 mb-1 text-center">
          <span className="text-xs font-bold text-slate-300">標線繪製</span>
        </div>

        {/* Global Select Pointer Tool at Top */}
        <div className="flex flex-col items-center">
          <button
            id="tool-btn-select"
            onClick={() => setActiveTool('select')}
            className={`w-[42px] h-[42px] rounded-lg flex items-center justify-center transition-all cursor-pointer border ${
              activeTool === 'select'
                ? 'bg-blue-600/20 text-blue-300 border-blue-500/70'
                : 'text-slate-400 bg-[#0f1115]/30 border-[#2d3039]/20 hover:bg-[#1f2229] hover:text-slate-200 hover:border-[#2d3039]'
            }`}
            title="選擇與修改幾何物件/拖移端點"
          >
            {renderToolIcon('select')}
          </button>
        </div>

        {/* CAD Categories Tools Grid */}
        <div className="space-y-3">
          {categories.map((cat, catIdx) => (
            <div key={catIdx} className="space-y-1">
              <div className="text-[10px] font-black text-slate-500 tracking-widest text-center uppercase border-b border-[#2d3039]/30 pb-0.5">
                {cat.title}
              </div>
              <div className="grid grid-cols-2 gap-1.5 justify-items-center">
                {cat.items.map((tool) => {
                  const isActive = activeTool === tool.id;
                  return (
                    <div key={tool.id} className="relative group">
                      <button
                        id={`tool-btn-${tool.id}`}
                        onClick={() => setActiveTool(tool.id)}
                        className={`w-[42px] h-[42px] rounded-lg flex items-center justify-center transition-all border cursor-pointer ${
                          isActive 
                            ? 'bg-blue-600/20 text-blue-300 border-blue-500/70' 
                            : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229] hover:text-slate-200'
                        }`}
                        title={tool.desc}
                      >
                        {renderToolIcon(tool.id)}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <button
        id="load-template-btn"
        onClick={onLoadDemo}
        className="mt-3 w-full py-2 text-[10px] font-bold rounded-lg border border-[#2d3039] text-slate-400 hover:text-slate-200 hover:border-slate-500 bg-[#0f1115]/40 cursor-pointer"
        title="載入十字路口範本，快速開始"
      >
        載入範本
      </button>
    </div>

  );
}
