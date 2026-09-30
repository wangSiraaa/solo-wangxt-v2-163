import type { AxisId, HPoint, Point2, Ruler } from '../../types';
import {
  hpoint,
  infinityPoint,
  intersect,
  lineThrough,
  finite,
  toEuclidean,
  type HLine,
} from '../geometry/homogeneous';
import { rulerFromRotation } from './camera3d';

/**
 * 标尺预设与派生几何（地平线、共线退化检测）。
 */

export interface PresetSpec {
  id: string;
  label: string;
  description: string;
  build: (w: number, h: number) => Ruler;
}

/**
 * 一点透视：视线正对走廊。X、Z 轴平行于画面（无穷远 VP，水平/竖直方向），
 * Y 轴（纵深）VP 在主点。
 */
function onePoint(w: number, h: number, horizonY: number): Ruler {
  const c = { x: w / 2, y: horizonY };
  return {
    kind: 1,
    axes: [infinityPoint(1, 0), hpoint(c.x, c.y), infinityPoint(0, 1)],
    rotation: { pan: 0, tilt: 0 },
    focal: Math.min(w, h) * 0.9,
    principal: c,
    horizonAxes: [0, 1],
    verticalAxis: 2,
  };
}

export const RULER_PRESETS: PresetSpec[] = [
  {
    id: 'one-point-normal',
    label: '一点透视 · 标准地平线',
    description: '地平线在画面 1/2 处',
    build: (w, h) => onePoint(w, h, h * 0.5),
  },
  {
    id: 'one-point-high',
    label: '一点透视 · 高位地平线',
    description: '地平线在画面 92% 处（俯视地面为主）',
    build: (w, h) => onePoint(w, h, h * 0.92),
  },
  {
    id: 'two-point-normal',
    label: '两点透视 · 标准',
    description: 'yaw 35°，竖直方向为无穷远',
    build: (w, h) =>
      rulerFromRotation(2, { pan: THREE_DEG * 35, tilt: 0 }, Math.min(w, h) * 0.9, {
        x: w / 2,
        y: h * 0.5,
      }),
  },
  {
    id: 'two-point-high',
    label: '两点透视 · 高位地平线',
    description: 'yaw 20°，地平线在 90% 处',
    build: (w, h) =>
      rulerFromRotation(2, { pan: THREE_DEG * 20, tilt: 0 }, Math.min(w, h) * 0.9, {
        x: w / 2,
        y: h * 0.9,
      }),
  },
  {
    id: 'three-point-worm',
    label: '三点透视 · 仰视（极端）',
    description: 'yaw 40°、tilt -55°、长焦 f=3.2·边长，竖直消失点远在画框上方之外',
    build: (w, h) =>
      rulerFromRotation(
        3,
        { pan: THREE_DEG * 40, tilt: THREE_DEG * -55 },
        Math.min(w, h) * 3.2,
        { x: w * 0.5, y: h * 0.5 },
      ),
  },
  {
    id: 'three-point-bird',
    label: '三点透视 · 俯视（极端）',
    description: 'yaw 50°、tilt 70°、长焦 f=3.2·边长，竖直消失点远在画框下方之外',
    build: (w, h) =>
      rulerFromRotation(
        3,
        { pan: THREE_DEG * 50, tilt: THREE_DEG * 70 },
        Math.min(w, h) * 3.2,
        { x: w * 0.5, y: h * 0.5 },
      ),
  },
];

const THREE_DEG = Math.PI / 180;

/**
 * 地平线：两水平 VP 的连线。
 * - 两点：两个有限 VP 确定；
 * - 一点：一条 VP 有限、另一个在无穷远（水平线方向）—— 经过有限 VP 的水平直线；
 * - 若两个水平 VP 都在无穷远（正交投影），地平线本身也在无穷远，返回 null。
 */
export function horizonLine(ruler: Ruler): HLine | null {
  const [a, b] = ruler.horizonAxes.map((i) => ruler.axes[i]) as [HPoint, HPoint];
  if (!finite(a) && !finite(b)) return null;
  return lineThrough(a, b);
}

/**
 * 三个轴 VP 是否共线（退化透视）。
 * 合法三点透视中三个互相垂直方向的 VP 不可能共线；
 * 共线（含某两条连线重合）说明标尺退化，编辑器应拒绝并提示。
 * 用齐次行列式 det[vp0; vp1; vp2] ≈ 0 判断，不依赖 VP 是否有限。
 */
export function axesCollinear(ruler: Ruler): boolean {
  const [a, b, c] = ruler.axes;
  const det =
    a[0] * (b[1] * c[2] - b[2] * c[1]) -
    a[1] * (b[0] * c[2] - b[2] * c[0]) +
    a[2] * (b[0] * c[1] - b[1] * c[0]);
  const scale =
    Math.max(
      1,
      Math.hypot(a[0], a[1]) * (a[2] || 1),
      Math.hypot(b[0], b[1]) * (b[2] || 1),
      Math.hypot(c[0], c[1]) * (c[2] || 1),
    );
  return Math.abs(det) < 1e-9 * scale * scale;
}

/**
 * 用两条已知收敛直线求某轴 VP（供用户在画布外拖出 VP 时使用）。
 * 平行直线返回 W=0 的无穷远点；重合直线抛错（退化共线输入）。
 */
export function vanishingPointFromLines(l1: HLine, l2: HLine): HPoint {
  return intersect(l1, l2);
}

/** 有限 VP 的画布位置；无穷远返回 null（UI 画方向箭头而非假点）。 */
export function finiteVp(ruler: Ruler, axis: AxisId): Point2 | null {
  const vp = ruler.axes[axis];
  return finite(vp) ? toEuclidean(vp) : null;
}

/** 标尺的几何自检：返回问题列表（空数组 = 合法）。 */
export function validateRuler(ruler: Ruler): string[] {
  const problems: string[] = [];
  ruler.axes.forEach((vp, i) => {
    const n = Math.hypot(vp[0], vp[1], vp[2]);
    if (n < 1e-12) problems.push(`轴 ${i} 的消失点为零向量（退化）`);
  });
  if (ruler.kind === 3 && axesCollinear(ruler)) {
    problems.push('三点透视的三个消失点共线，这是退化配置');
  }
  if (!(ruler.focal > 0)) problems.push('焦距必须为正');
  return problems;
}
