import { CadTool } from '../types';

export interface ToolDef {
  id: CadTool;
  /** 短名稱（工具列文字標籤） */
  label: string;
  /** 說明（滑鼠提示） */
  desc: string;
  /** 搜尋關鍵字 */
  keywords?: string;
}

export interface ToolCategory {
  key: string;
  title: string;
  tools: ToolDef[];
}

/** 依法規類別分組的完整工具目錄（新版介面使用） */
export const TOOL_CATEGORIES: ToolCategory[] = [
  {
    key: 'longitudinal',
    title: '縱向標線',
    tools: [
      { id: 'yellow_double', label: '分向限制線', desc: '雙黃實線：禁止跨越之分向限制線', keywords: '雙黃 中線' },
      { id: 'yellow_dashed', label: '分向線', desc: '黃虛線：可跨越之分向線', keywords: '黃虛線 中線' },
      { id: 'white_dashed', label: '車道線', desc: '白虛線：線段 4 m、間距 6 m', keywords: '白虛線 車道' },
      { id: 'white_solid', label: '路面邊線', desc: '白實線：線寬 15 cm', keywords: '邊線 白實線' },
      { id: 'white_double', label: '雙白實線', desc: '雙白實線', keywords: '雙白' },
      { id: 'reversible_lane', label: '調撥車道線', desc: '雙白虛線：調撥車道', keywords: '調撥' },
      { id: 'crossing_dashed', label: '穿越虛線', desc: '路口指示線／附加車道穿越虛線：寬 30 cm、1 m／2 m', keywords: '路口 指示' },
    ],
  },
  {
    key: 'transverse',
    title: '橫向標線',
    tools: [
      { id: 'stop_line', label: '停止線', desc: '白實線：線寬 30～40 cm', keywords: '停止' },
      { id: 'yield_line', label: '讓路線', desc: '兩排方塊＋倒三角形', keywords: '讓 讓路' },
      { id: 'crosswalk', label: '行人穿越道', desc: '枕木紋行人穿越道線：點四點（兩側邊緣）', keywords: '斑馬線 枕木紋 行穿線' },
    ],
  },
  {
    key: 'zones',
    title: '禁停與區域',
    tools: [
      { id: 'red_solid', label: '禁止臨時停車', desc: '紅實線：禁止臨時停車線', keywords: '紅線 禁停' },
      { id: 'yellow_solid', label: '禁止停車', desc: '黃實線：禁止停車線', keywords: '黃線 禁停' },
      { id: 'grid_box', label: '網狀線', desc: '黃色交叉斜紋：禁止停車之網狀線', keywords: '網狀 黃網' },
      { id: 'channelization', label: '槽化線', desc: '外框＋斜紋（白／黃可選）', keywords: '槽化 導流島' },
      { id: 'Sidewalk', label: '人行道', desc: '人行道鋪面範圍', keywords: '人行道 鋪面' },
      { id: 'bicycle_lane', label: '自行車道', desc: '自行車道鋪面（可調寬度）', keywords: '自行車 腳踏車' },
    ],
  },
  {
    key: 'parking',
    title: '停車與機車',
    tools: [
      { id: 'parking_space', label: '停車格', desc: '單一停車格（汽車／機車）', keywords: '車格' },
      { id: 'parking_zone', label: '停車區', desc: '沿路徑自動排列車格', keywords: '停車帶 車格' },
      { id: 'moto_box', label: '機車停等區', desc: '停止線前之機車停等區：點三點', keywords: '機車 停等' },
      { id: 'moto_turn_box', label: '機車待轉區', desc: '兩段式左轉待轉區：點三點', keywords: '機車 待轉 兩段式' },
    ],
  },
  {
    key: 'symbols',
    title: '標字與符號',
    tools: [
      { id: 'road_arrow', label: '指向線', desc: '路面方向箭頭：點擊自動對齊車道', keywords: '箭頭 直行 左轉 右轉' },
      { id: 'road_text', label: '路面標字', desc: '慢、停、公車專用等路面字樣', keywords: '標字 慢 停 文字' },
      { id: 'text_label', label: '文字標註', desc: '圖面說明文字', keywords: '文字 註記 路名' },
    ],
  },
  {
    key: 'tools',
    title: '量測與輔助',
    tools: [
      { id: 'measurement', label: '測距', desc: '量測兩點距離', keywords: '距離 尺寸' },
      { id: 'angular_dimension', label: '角度', desc: '量測夾角', keywords: '角度' },
      { id: 'arc_3point', label: '三點圓弧', desc: '以三點繪製圓弧邊線', keywords: '圓弧' },
      { id: 'guideline', label: '輔助線', desc: '對齊用輔助線（不出圖）', keywords: '輔助' },
      { id: 'sketch_circle', label: '輔助圓', desc: '轉角半徑輔助圓（不出圖）', keywords: '圓 半徑' },
      { id: 'BuildingLine', label: '建築線', desc: '地籍／建築線參考', keywords: '建築線 地界' },
    ],
  },
];

export const ALL_TOOLS: ToolDef[] = TOOL_CATEGORIES.flatMap(c => c.tools);

/** 新版介面「簡潔」風格的常用工具 */
export const ESSENTIAL_TOOLS: CadTool[] = [
  'yellow_double', 'white_dashed', 'white_solid', 'stop_line', 'crosswalk', 'road_arrow', 'channelization', 'parking_zone', 'measurement',
];
