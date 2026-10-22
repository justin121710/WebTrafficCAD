/** 背景計算掃掠範圍外框（多邊形聯集），避免拖曳後主執行緒卡頓 */
import { unionPolygons } from './analysis';
import { Pt } from './model';

const ctx: any = self;
ctx.onmessage = (e: MessageEvent<{ id: number; polys: Pt[][] }>) => {
  const { id, polys } = e.data;
  let rings: Pt[][][] = [];
  try {
    rings = unionPolygons(polys);
  } catch {
    rings = [];
  }
  ctx.postMessage({ id, rings });
};
