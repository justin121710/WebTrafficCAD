import React from 'react';
import { CadTool } from '../types';
import { arrowData } from '../arrowData';

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
