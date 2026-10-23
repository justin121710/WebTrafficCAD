import React from 'react';
import { MousePointer2, Waypoints, Route, PenTool, Paintbrush } from 'lucide-react';
import { SimTool } from '../store';

export interface SimToolDef {
  id: SimTool;
  label: string;
  key: string;
  desc: string;
  recommended?: boolean;
  icon: React.ReactNode;
}

export const SIM_TOOLS: SimToolDef[] = [
  { id: 'polyline', label: '點選＋半徑', key: 'P', recommended: true, desc: '依序點節點，轉角以指定半徑圓弧（可加緩和曲線）連接，適合正式檢核', icon: <Waypoints className="w-4 h-4" /> },
  { id: 'intersection', label: '路口轉彎', key: 'I', recommended: true, desc: '指定進入與離開路口的位置和方向，自動產生轉彎曲線', icon: <Route className="w-4 h-4" /> },
  { id: 'pen', label: '鋼筆曲線', key: 'N', desc: '貝茲曲線自由造型，可拉切線與尖角', icon: <PenTool className="w-4 h-4" /> },
  { id: 'freehand', label: '筆刷手繪', key: 'B', desc: '快速手繪草擬，會自動去除抖動', icon: <Paintbrush className="w-4 h-4" /> },
];

export const SIM_SELECT_DEF: SimToolDef = { id: 'select', label: '選取與編輯', key: 'V', desc: '點選軌跡；拖曳節點、◆半徑把手或整條軌跡；雙擊線段插入節點', icon: <MousePointer2 className="w-4 h-4" /> };
