import type { AxisId, GuideAxis, HLine, HPoint, Point2, Stroke } from '../types';
import {
  cross3,
  distance,
  EPSILON,
  fromHomogeneous,
  normalizeHLine,
  projectPointToLine,
  toHomogeneous,
} from './homogeneous';

/** 默认吸附角阈值（弧度）：线段方向与参考方向夹角小于它才吸附。 */
export const DEFAULT_SNAP_ANGLE = (8 * Math.PI) / 180;

export interface SnapResult {
  axis: AxisId;
  constrained: Point2[];
}

/**
 * 过点 p 与消失点 vp（可为无穷远）的直线，齐次表示。
 * vp 在无穷远时 cross(vp, [x,y,1]) 得到一族平行线 —— 不需要对 vp 做任何夹取。
 */
export function lineThroughVanishingPoint(p: Point2, vp: HPoint): HLine {
  return normalizeHLine(cross3(vp, toHomogeneous(p)));
}

/**
 * 文档坐标下齐次直线的二维方向向量（沿直线）。
 * 直线 (a,b,c) 的方向为 (-b,a)。
 */
export function lineDirection2D(line: HLine): Point2 {
  const d = { x: -line[1], y: line[0] };
  const n = Math.hypot(d.x, d.y);
  return n <= EPSILON ? { x: 1, y: 0 } : { x: d.x / n, y: d.y / n };
}

function angleBetween(u: Point2, v: Point2): number {
  const n1 = Math.hypot(u.x, u.y);
  const n2 = Math.hypot(v.x, v.y);
  if (n1 <= EPSILON || n2 <= EPSILON) return Math.PI / 2;
  const cos = Math.abs((u.x * v.x + u.y * v.y) / (n1 * n2)); // 无向夹角
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

/**
 * 在所有坐标轴中寻找与线段 a→b 方向最匹配的参考线。
 * 匹配基于过 a 的消失直线方向；夹角超过阈值返回 null（不吸附）。
 */
export function findSnapAxis(
  a: Point2,
  b: Point2,
  axes: Record<AxisId, GuideAxis>,
  threshold = DEFAULT_SNAP_ANGLE,
): { axis: AxisId; line: HLine; angle: number } | null {
  const strokeDir = { x: b.x - a.x, y: b.y - a.y };
  if (Math.hypot(strokeDir.x, strokeDir.y) <= EPSILON) return null;

  let best: { axis: AxisId; line: HLine; angle: number } | null = null;
  for (const id of ['x', 'y', 'z'] as AxisId[]) {
    const axis = axes[id];
    const line = lineThroughVanishingPoint(a, axis.vanishingPoint);
    if (Math.hypot(line[0], line[1]) <= EPSILON) continue;
    const angle = angleBetween(strokeDir, lineDirection2D(line));
    if (angle <= threshold && (!best || angle < best.angle)) {
      best = { axis: id, line, angle };
    }
  }
  return best;
}

/**
 * 把一条笔画约束到过首点、指向某消失点的直线上：
 * 其余各点投影到该直线（齐次垂足），线段工具的末点保持到首点的原始距离。
 *
 * 无穷远 VP 时该直线是平行方向 —— 与有限 VP 走完全相同的齐次公式，
 * 不允许出现「VP 太远就夹到边缘再连线」的退化路径。
 */
export function constrainPoints(
  rawPoints: Point2[],
  axes: Record<AxisId, GuideAxis>,
  axis: AxisId,
  tool: Stroke['tool'],
): Point2[] {
  if (rawPoints.length === 0) return [];
  const first = rawPoints[0];
  const line = lineThroughVanishingPoint(first, axes[axis].vanishingPoint);

  if (tool === 'segment' && rawPoints.length >= 2) {
    const last = rawPoints[rawPoints.length - 1];
    const dir = lineDirection2D(line);
    const signed =
      (last.x - first.x) * dir.x + (last.y - first.y) * dir.y >= 0 ? 1 : -1;
    const len = distance(first, last) || 1;
    return [first, { x: first.x + dir.x * len * signed, y: first.y + dir.y * len * signed }];
  }

  // 自由笔画：逐点投影到同一条消失直线。
  return rawPoints.map((p, i) => {
    if (i === 0) return p;
    return projectPointToLine(p, line) ?? p;
  });
}

/**
 * 对原始笔画执行吸附；不满足阈值时返回未吸附结果。
 * 纯函数：输入笔画不被修改，调用方负责同时保存 raw 与 constrained。
 */
export function snapStroke(
  rawPoints: Point2[],
  tool: Stroke['tool'],
  axes: Record<AxisId, GuideAxis>,
  threshold = DEFAULT_SNAP_ANGLE,
): SnapResult | null {
  if (rawPoints.length < 2) return null;
  const first = rawPoints[0];
  const last = rawPoints[rawPoints.length - 1];
  const match = findSnapAxis(first, last, axes, threshold);
  if (!match) return null;
  return {
    axis: match.axis,
    constrained: constrainPoints(rawPoints, axes, match.axis, tool),
  };
}

/** 判断消失点是否有限（导出/绘制辅助）。 */
export function isAxisInfinite(axis: GuideAxis): boolean {
  return fromHomogeneous(axis.vanishingPoint) === null;
}
