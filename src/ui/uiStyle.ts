export type UiStyle = 'classic' | 'minimal' | 'guided' | 'polished';

export interface UiStyleMeta {
  id: UiStyle;
  name: string;
  tagline: string;
  points: string[];
}

export const UI_STYLES: UiStyleMeta[] = [
  {
    id: 'classic',
    name: '經典（舊版）',
    tagline: '原本的版面配置',
    points: ['圖示工具列在左', '設定按鈕在上方', '與舊版操作相同'],
  },
  {
    id: 'minimal',
    name: 'A・簡潔',
    tagline: '常用工具在左，其餘收在選單',
    points: ['細窄工具列＋「更多工具」', '檔案、檢視各收進一個選單', '屬性面板只在需要時出現'],
  },
  {
    id: 'guided',
    name: 'B・直覺',
    tagline: '工具附名稱並依類別排列',
    points: ['工具附文字並依法規分類', '工具搜尋（Ctrl+K）', '右側分頁：屬性／圖層／數量'],
  },
  {
    id: 'polished',
    name: 'C・美觀',
    tagline: '滿版畫布＋浮動面板',
    points: ['畫布佔滿整個視窗', '底部工具 Dock 與分類彈出', '面板可收合，畫面最大'],
  },
];

const KEY = 'webtrafficcad.uiStyle';

/** 讀取介面風格：網址參數 ?ui= 優先，其次為上次選擇，預設為 B・直覺 */
export function loadUiStyle(): UiStyle {
  try {
    const q = new URLSearchParams(window.location.search).get('ui');
    if (q && UI_STYLES.some(s => s.id === q)) return q as UiStyle;
    const saved = localStorage.getItem(KEY);
    if (saved && UI_STYLES.some(s => s.id === saved)) return saved as UiStyle;
  } catch {
    // 無法存取 localStorage 時使用預設
  }
  return 'guided';
}

export function saveUiStyle(style: UiStyle) {
  try {
    localStorage.setItem(KEY, style);
  } catch {
    // ignore
  }
}
