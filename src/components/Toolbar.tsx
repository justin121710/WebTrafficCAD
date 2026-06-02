import React from 'react';
import { CadTool } from '../types';
import { 
  Trash2, 
  RefreshCw
} from 'lucide-react';

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
}

// Render dynamic custom professional vector Traffic CAD SVGs
function renderToolIcon(id: CadTool) {
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
          <line x1="2" y1="12" x2="22" y2="12" strokeDasharray="4,2,1,2" />
          <line x1="5" y1="4" x2="19" y2="20" stroke="currentColor" strokeDasharray="2,2" opacity="0.6" />
        </svg>
      );
    case 'yellow_double':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" strokeWidth="2.5">
          <line x1="8" y1="3" x2="8" y2="21" stroke="#FFCC00" />
          <line x1="16" y1="3" x2="16" y2="21" stroke="#FFCC00" />
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
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="#eab308" strokeWidth="2">
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
        <svg viewBox="0 0 147 218" className="w-[24px] h-[24px] object-contain" fill="none" stroke="currentColor" strokeWidth="2" xmlns="http://www.w3.org/2000/svg">
    <g transform="matrix(1,0,0,1,-971.745112,-1907.965364)">
        
        <g transform="matrix(0.229046,0,0,0.114737,786.682476,1832.623466)">
            <rect x="807.972" y="656.65" width="154.41" height="154.41" fill="currentColor" stroke="none"/>
        </g>
        <g transform="matrix(0.229046,0,0,0.114737,786.682476,1868.056537)">
            <rect x="807.972" y="656.65" width="154.41" height="154.41" fill="currentColor" stroke="none"/>
        </g>
        <g transform="matrix(0.229046,0,0,0.114737,842.457538,1832.623466)">
            <rect x="807.972" y="656.65" width="154.41" height="154.41" fill="currentColor" stroke="none"/>
        </g>
        <g transform="matrix(0.229046,0,0,0.114737,898.232599,1832.623466)">
            <rect x="807.972" y="656.65" width="154.41" height="154.41" fill="currentColor" stroke="none"/>
        </g>
        <g transform="matrix(0.229046,0,0,0.114737,842.575708,1868.056537)">
            <rect x="807.972" y="656.65" width="154.41" height="154.41" fill="currentColor" stroke="none"/>
        </g>
        <g transform="matrix(0.229046,0,0,0.114737,898.232599,1868.056537)">
            <rect x="807.972" y="656.65" width="154.41" height="154.41" fill="currentColor" stroke="none"/>
        </g>
        
        <g transform="matrix(0.976024,0,0,1,23.790491,0)">
            <path d="M992.271,1985.535L1100.979,1985.535L1046.625,2125.582L992.271,1985.535ZM1014.873,2020.968L1046.625,2106.593L1078.663,2020.968L1014.873,2020.968Z" fill="currentColor" stroke="none"/>
        </g>
        
    </g>
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
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="5" width="18" height="14" rx="2" strokeDasharray="2,2" />
          <rect x="6" y="7" width="2" height="10" fill="currentColor" />
          <rect x="11" y="7" width="2" height="10" fill="currentColor" />
          <rect x="16" y="7" width="2" height="10" fill="currentColor" />
        </svg>
      );
    case 'bicycle_lane':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="5.5" cy="14" r="2.5" />
          <circle cx="18.5" cy="14" r="2.5" />
          <path d="M12 14v-4l3-3M8 10h8" />
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
    case 'road_arrow':
      return (
        <svg viewBox="0 0 24 24" className="w-[24px] h-[24px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19V5M12 5l-5 5M12 5l5 5" />
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
  setSnapToNearest
}: ToolbarProps) {
  
  const categories = [
    {
      title: "輔助",
      items: [
        { id: 'sketch_circle' as CadTool, desc: '輔助圓：第一點決定圓心，第二點決定半徑' },
        { id: 'guideline' as CadTool, desc: '輔助基準線：輔助對齊之切點基準線' }
      ]
    },
    {
      title: "線標",
      items: [
        { id: 'yellow_double' as CadTool, desc: '雙黃實線（世界座標 10cm 寬 + 10cm 間隔，分向限制線）' },
        { id: 'white_double' as CadTool, desc: '雙白實線（15cm雙白實線，禁止變換車道線）' },
        { id: 'white_solid' as CadTool, desc: '車道邊線：15cm白色實線' },
        { id: 'white_dashed' as CadTool, desc: '白虛線（4m實線、6m空隙，標準標線規則）' },
        { id: 'yellow_dashed' as CadTool, desc: '車道黃虛線（4m實線、6m空隙，標準標線規則）' },
        { id: 'crossing_dashed' as CadTool, desc: '附加車道虛線/穿越線：30cm寬，1m實線2m空隙' },
        { id: 'stop_line' as CadTool, desc: '停止線：30-40cm白色實線' },
        { id: 'yield_line' as CadTool, desc: '讓路線：尖角朝下的倒白色三角形標線組' },
        { id: 'BuildingLine' as CadTool, desc: '建築線：地籍或人行道邊界建築參考線' },
        { id: 'reversible_lane' as CadTool, desc: '調撥車道線：雙排平行虛線' }
      ]
    },
    {
      title: "區塊",
      items: [
        { id: 'Sidewalk' as CadTool, desc: '人行道鋪面：多邊形貝茲圓滑人行步道區' },
        { id: 'channelization' as CadTool, desc: '槽化線：導流島與 45° 填充斜紋標線' },
        { id: 'crosswalk' as CadTool, desc: '行穿線 / 斑馬線：40cm線寬40cm間隙之枕木紋' },
        { id: 'bicycle_lane' as CadTool, desc: '腳踏車道：品紅色專用車道鋪面' },
        { id: 'parking_space' as CadTool, desc: '停車格：汽車、機車位印章繪製與屬性控制' },
        { id: 'parking_zone' as CadTool, desc: '停車區：以鋼筆繪製彎曲或直行路徑，自動沿路向填滿車格，可調整角度、間隔與尺寸' },
        { id: 'road_arrow' as CadTool, desc: '指向線箭頭：路面方向指示印章（直行、左右轉與混合）' }
      ]
    }
  ];

  return (
    <div 
      id="left-toolbar" 
      className="flex flex-col bg-[#14161c] border-r border-[#2d3039] w-[145px] h-full p-2 justify-between select-none overflow-y-auto shrink-0"
    >
      <div className="space-y-4">
        {/* CAD Brand Mini Header */}
        <div className="flex flex-col items-center justify-center py-2 border-b border-[#2d3039]/40 mb-1 text-center">
          <div className="w-[55px] h-[55px] rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center font-black text-white text-base shadow-lg shadow-blue-500/20 mb-1.5 border border-blue-400/20">
            CAD
          </div>
          <span className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">Traffic</span>
        </div>

        {/* Global Select Pointer Tool at Top */}
        <div className="flex flex-col items-center">
          <button
            id="tool-btn-select"
            onClick={() => setActiveTool('select')}
            className={`w-[55px] h-[55px] rounded-lg flex items-center justify-center transition-all cursor-pointer border ${
              activeTool === 'select'
                ? 'bg-blue-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_8px_rgba(0,255,255,0.25)]'
                : 'text-slate-400 bg-[#0f1115]/30 border-[#2d3039]/20 hover:bg-[#1f2229] hover:text-slate-200 hover:border-[#2d3039]'
            }`}
            title="選擇與修改幾何物件/拖移端點 (Select & Modify)"
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
                        className={`w-[55px] h-[55px] rounded-lg flex items-center justify-center transition-all border cursor-pointer ${
                          isActive 
                            ? 'bg-blue-950/60 text-[#00FFFF] border-[#00FFFF]/80 shadow-[0_0_8px_rgba(0,255,255,0.25)]' 
                            : 'text-slate-400 bg-[#0f1115]/40 border-[#2d3039]/20 hover:border-[#3b4252] hover:bg-[#1f2229] hover:text-slate-200'
                        }`}
                        title={tool.desc}
                      >
                        {renderToolIcon(tool.id)}
                      </button>

                      {/* Smart Vehicle selectors inside the grid if smart_path is active */}
                      {tool.id === 'smart_path' && isActive && (
                        <div className="col-span-2 mt-1 p-1 bg-cyan-950/20 border border-cyan-800/30 rounded flex flex-col items-center gap-1 w-[100px] absolute -left-[22.5px] top-15 z-10 shadow-xl shadow-black/80 animate-fade-in">
                          <span className="text-[8px] font-bold text-cyan-400 leading-none">車種模擬</span>
                          <div className="flex gap-1.5 justify-center w-full">
                            <button 
                              onClick={(e) => { e.stopPropagation(); setDesignVehicle('passenger'); }} 
                              className={`w-6 h-6 rounded text-[9px] font-bold cursor-pointer transition-colors ${designVehicle === 'passenger' ? 'bg-cyan-500 text-black' : 'bg-transparent text-cyan-400 hover:bg-cyan-950/40'}`} 
                              title="客車 (Passenger Carriage)"
                            >
                              P
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); setDesignVehicle('semi_trailer'); }} 
                              className={`w-6 h-6 rounded text-[9px] font-bold cursor-pointer transition-colors ${designVehicle === 'semi_trailer' ? 'bg-cyan-500 text-black' : 'bg-transparent text-cyan-400 hover:bg-cyan-950/40'}`} 
                              title="大客車 / 單體大貨車 (Coach / Rigid Truck)"
                            >
                              B
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); setDesignVehicle('articulated'); }} 
                              className={`w-6 h-6 rounded text-[9px] font-bold cursor-pointer transition-colors ${designVehicle === 'articulated' ? 'bg-cyan-500 text-black' : 'bg-transparent text-cyan-400 hover:bg-cyan-950/40'}`} 
                              title="聯結車 (Articulated Trailer)"
                            >
                              T
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
