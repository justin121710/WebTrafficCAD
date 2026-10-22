import { CadElement, Point2D } from './types';

let seq = 0;
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const line = (type: string, pts: [number, number][], extra: Record<string, any> = {}): CadElement => {
  const P = pts.map(([x, y]) => ({ x, y }));
  return { id: uid(type), type, points: P, cpLeft: P.map(p => ({ ...p })), cpRight: P.map(p => ({ ...p })), minRadius: 999, isValid: true, ...extra } as any;
};

export interface CrossroadOptions {
  /** 每方向車道數 */
  lanes: number;
  /** 車道寬（m） */
  laneWidth: number;
  /** 路段長度（自路口邊緣起算，m） */
  armLength: number;
}

/**
 * 十字路口範本：雙向各 N 車道、停止線、行人穿越道、指向線、機車停等區。
 * 行人穿越道寬 4 m；機車停等區前緣距行人穿越道 1 m、深 3 m，汽車停止線在其後。
 */
export function buildCrossroadTemplate(o: CrossroadOptions = { lanes: 2, laneWidth: 3.5, armLength: 36 }): CadElement[] {
  const els: CadElement[] = [];
  const half = o.lanes * o.laneWidth; // 半幅路寬
  const cw = 4; // 行人穿越道寬
  const edge = half + 1.5; // 路口邊緣（含轉角）
  const motoFront = edge + 0.5 + cw + 1; // 機車停等區前緣（距行人穿越道 1 m）
  const motoDepth = 3;
  const stop = motoFront + motoDepth; // 汽車停止線
  const far = edge + o.armLength;

  // 四個方向（以旋轉角表示）：東、北、西、南
  const rot = (k: number, x: number, y: number): [number, number] => {
    const a = (k * Math.PI) / 2;
    return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)];
  };
  const pt = (k: number, x: number, y: number): Point2D => { const [a, b] = rot(k, x, y); return { x: a, y: b }; };

  for (let k = 0; k < 4; k++) {
    // 中心線、車道線、邊線（沿 +x 方向的路臂，旋轉 k×90°）
    els.push(line('yellow_double', [rot(k, stop, 0), rot(k, far, 0)]));
    for (let i = 1; i < o.lanes; i++) {
      els.push(line('white_dashed', [rot(k, stop, i * o.laneWidth), rot(k, far, i * o.laneWidth)]));
      els.push(line('white_dashed', [rot(k, edge, -i * o.laneWidth), rot(k, far, -i * o.laneWidth)]));
    }
    els.push(line('white_solid', [rot(k, edge, half), rot(k, far, half)]));
    els.push(line('white_solid', [rot(k, edge, -half), rot(k, far, -half)]));
    // 進口道：往路口行駛方向為 -x，靠右行駛時其右側為 +y，因此進口車道位於 y ∈ (0, half)
    els.push(line('stop_line', [rot(k, stop, 0.2), rot(k, stop, half)]));
    // 行人穿越道（跨整個路幅）
    els.push({
      id: uid('crosswalk'), type: 'crosswalk',
      pA1: pt(k, edge + 0.5, -half), pA2: pt(k, edge + 0.5, half),
      pB1: pt(k, edge + 0.5 + cw, -half), pB2: pt(k, edge + 0.5 + cw, half),
      stripeWidth: 0.4, stripeGap: 0.4,
    } as any);
    // 機車停等區（汽車停止線與行人穿越道之間）
    els.push({ id: uid('moto'), type: 'moto_box', p1: pt(k, motoFront, half), p2: pt(k, motoFront, 0.3), depth: motoDepth } as any);
    // 指向線：各進口車道
    for (let i = 0; i < o.lanes; i++) {
      const c = pt(k, stop + 18, (i + 0.5) * o.laneWidth);
      const heading = (k * Math.PI) / 2 + Math.PI; // 朝向路口
      const type = o.lanes === 1 ? 'straight' : i === 0 ? 'straight_left' : i === o.lanes - 1 ? 'straight_right' : 'straight';
      els.push({ id: uid('arrow'), type: 'road_arrow', p: c, arrowType: type, length: 5, angle: heading - Math.PI / 2 } as any);
    }
  }
  els.push({ id: uid('text'), type: 'text', p: { x: -far + 10, y: half + 6 }, text: '十字路口範本（雙向各 ' + o.lanes + ' 車道）', fontSize: 1.6 } as any);
  return els;
}
