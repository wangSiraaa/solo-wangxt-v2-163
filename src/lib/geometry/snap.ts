import { dot, norm } from 'mathjs';
import type { AxisId, HPoint, Point2, Ruler, SegmentAxis } from '../../types';
import {
  finite,
  hpoint,
  lineThrough,
  toDirection,
  toEuclidean,
  type HLine,
} from './homogeneous';

/**
 * 吸附与投影。
 *
 * 约定：
 * - 一段 raw 线段 (p0 -> p1) 相对某轴的偏角 = 该段方向与"p0 指向消失点的射线方向"的夹角；
 *   无穷远 VP 时射线方向就是该轴方向（平行于画面的线）。
 * - 约束采用链式投影：第 i 个约束点 = 第 i 个 raw 点在过"上一个约束点、朝向 VP"
 *   的直线上的垂足。这样多段折线首尾相接，不会出现平行直线族那种裂缝。
 * - 超容差的段保持自由（axis=null），链在自由段之后以 raw 点重新起锚。
 */

/** 过点 p 且朝向消失点 vp 的齐次直线。vp 无穷远时自然得到平行线。 */
export function vanishingLine(p: Point2, vp: HPoint): HLine {
  return lineThrough(hpoint(p.x, p.y), vp);
}

/** 点 q 在直线 l 上的垂足投影。 */
export function projectToLine(q: Point2, l: HLine): Point2 {
  const [a, b, c] = l;
  const n2 = a * a + b * b;
  const d = (a * q.x + b * q.y + c) / n2;
  return { x: q.x - a * d, y: q.y - b * d };
}

/** p 指向消失点的单位方向；无穷远 VP 返回该轴方向。 */
export function rayDirection(p: Point2, vp: HPoint): Point2 {
  if (finite(vp)) {
    const v = toEuclidean(vp);
    const dx = v.x - p.x;
    const dy = v.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-12) {
      // 起点恰好压在有限消失点上：方向不定，退化为由直线系数取方向。
      throw new Error('rayDirection: 起点与有限消失点重合，方向退化');
    }
    return { x: dx / len, y: dy / len };
  }
  return toDirection(vp);
}

/**
 * 段方向与"p 指向 VP 的有向射线"的夹角（度，0..180）。
 * 有限 VP 时线段必须朝向 VP（点积为正）才算同方向；
 * 背离 VP 的段（直线在 p 的另一侧）给接近 180° 的大角，不会被误吸。
 * 无穷远 VP 是双向平行方向，取无向锐角。
 */
function angleToRay(seg: Point2, ray: Point2, signed: boolean): number {
  const la = Math.hypot(seg.x, seg.y);
  const lb = Math.hypot(ray.x, ray.y);
  if (la < 1e-15 || lb < 1e-15) return 0;
  const cos = (dot([seg.x, seg.y], [ray.x, ray.y]) as number) / (la * lb);
  const clamped = Math.min(1, Math.max(-1, cos));
  const unsigned = (Math.acos(Math.abs(clamped)) * 180) / Math.PI;
  if (signed && cos < 0) return 180 - unsigned;
  return unsigned;
}

/** 段 (p0,p1) 相对某轴的偏角（度）。有限 VP 有向，无穷远 VP 无向。 */
export function segmentAngleToAxis(p0: Point2, p1: Point2, vp: HPoint): number {
  const seg = { x: p1.x - p0.x, y: p1.y - p0.y };
  if ((norm([seg.x, seg.y]) as number) < 1e-12) return 0;
  const dir = rayDirection(p0, vp);
  return angleToRay(seg, dir, finite(vp));
}

export interface AxisCandidate {
  axis: AxisId;
  angleDeg: number;
}

/**
 * 对全部三个世界轴按偏角排序。
 * 一点/两点透视只是其中部分 VP 在无穷远，三个方向始终都可绘制
 * （水平、竖直为平行方向，纵深指向有限 VP），因此不能按 kind 只遍历前 N 个。
 */
export function rankAxes(
  p0: Point2,
  p1: Point2,
  ruler: Ruler,
): AxisCandidate[] {
  const out: AxisCandidate[] = [];
  for (let a = 0 as AxisId; a < 3; a = (a + 1) as AxisId) {
    out.push({
      axis: a,
      angleDeg: segmentAngleToAxis(p0, p1, ruler.axes[a]),
    });
  }
  return out.sort((u, v) => u.angleDeg - v.angleDeg);
}

/** 容差内返回最佳轴，否则 null（保持自由线）。 */
export function classifySegment(
  p0: Point2,
  p1: Point2,
  ruler: Ruler,
  toleranceDeg = 12,
): SegmentAxis {
  const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (segLen < 1e-9) return null; // 退化零长段不分类
  const [best] = rankAxes(p0, p1, ruler);
  return best.angleDeg <= toleranceDeg ? best.axis : null;
}

/** 对整条笔画做逐段轴分类。 */
export function classifyStroke(
  raw: Point2[],
  ruler: Ruler,
  toleranceDeg = 12,
): SegmentAxis[] {
  const axes: SegmentAxis[] = [];
  for (let i = 0; i < raw.length - 1; i++) {
    axes.push(classifySegment(raw[i], raw[i + 1], ruler, toleranceDeg));
  }
  return axes;
}

/**
 * 链式约束：由 raw + ruler + 每段归属派生约束点。
 * 约束线过"上一个已约束点"，朝向该轴 VP（无穷远即平行）。
 * 原始点不做任何修改；自由段直接透传 raw 坐标并在该点重新起锚。
 */
export function constrainStroke(
  raw: Point2[],
  segAxes: SegmentAxis[],
  ruler: Ruler,
): Point2[] {
  if (raw.length === 0) return [];
  const out: Point2[] = [{ ...raw[0] }];
  for (let i = 0; i < raw.length - 1; i++) {
    const axis = segAxes[i];
    if (axis === null) {
      out.push({ ...raw[i + 1] });
      continue;
    }
    const line = vanishingLine(out[i], ruler.axes[axis]);
    out.push(projectToLine(raw[i + 1], line));
  }
  return out;
}

/** 便捷：一步完成分类 + 约束（实时绘制时用）。 */
export function snapStroke(
  raw: Point2[],
  ruler: Ruler,
  toleranceDeg = 12,
): { axes: SegmentAxis[]; constrained: Point2[] } {
  const axes = classifyStroke(raw, ruler, toleranceDeg);
  return { axes, constrained: constrainStroke(raw, axes, ruler) };
}
