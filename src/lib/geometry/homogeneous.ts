import { cross } from 'mathjs';
import type { HPoint, Point2 } from '../../types';

/**
 * 齐次坐标直线几何。
 *
 * 屏幕/文档坐标系：x 向右、y 向下。
 * 直线也用齐次三元组 l = [a, b, c] 表示（ax + by + c = 0）。
 * 两点 p、q 的连线 = p × q；两线 l、m 的交点 = l × m。
 * 当交点的 W 分量为 0 时是无穷远点（两线平行），表示"平行于画面"的方向，
 * 调用方必须显式按方向处理，不得归一化，也不得截断到画布边缘。
 */

export type HLine = readonly [number, number, number];

export const INFINITY_W_EPS = 1e-10;

export function finite(p: HPoint): boolean {
  return Math.abs(p[2]) > INFINITY_W_EPS * Math.max(1, Math.hypot(p[0], p[1]));
}

/** 有限齐次点 -> 欧氏点；无穷远点抛错（强制调用方走方向分支）。 */
export function toEuclidean(p: HPoint): Point2 {
  if (!finite(p)) {
    throw new Error('toEuclidean: 点在无穷远 (W≈0)，应使用 toDirection 处理方向');
  }
  return { x: p[0] / p[2], y: p[1] / p[2] };
}

/** 无穷远点（方向）-> 单位向量 [dx, dy]；有限点抛错。 */
export function toDirection(p: HPoint): Point2 {
  if (finite(p)) {
    throw new Error('toDirection: 点是有限点，应使用 toEuclidean');
  }
  const len = Math.hypot(p[0], p[1]);
  if (len < 1e-15) throw new Error('toDirection: 退化齐次点 [0,0,0]');
  return { x: p[0] / len, y: p[1] / len };
}

export function hpoint(x: number, y: number): HPoint {
  return [x, y, 1];
}

/** 以单位方向 (dx,dy) 构造无穷远点 [dx,dy,0]。 */
export function infinityPoint(dx: number, dy: number): HPoint {
  const len = Math.hypot(dx, dy);
  if (len < 1e-15) throw new Error('infinityPoint: 方向向量长度为 0');
  return [dx / len, dy / len, 0];
}

export function lineThrough(p: HPoint, q: HPoint): HLine {
  const l = cross([...p], [...q]) as number[];
  const n = Math.hypot(l[0], l[1]);
  // 两点重合会得到 [0,0,0] —— 退化共线/重合输入，显式抛错而不是产生 NaN。
  if (n < 1e-12 * Math.max(1, Math.abs(l[2]))) {
    throw new Error('lineThrough: 两点重合，无法确定直线（退化输入）');
  }
  return [l[0] / n, l[1] / n, l[2] / n];
}

export function lineFromPoints(a: Point2, b: Point2): HLine {
  return lineThrough(hpoint(a.x, a.y), hpoint(b.x, b.y));
}

/** 两线交点（齐次）；平行线返回 W=0 的无穷远点，绝不返回画布边缘上的假点。 */
export function intersect(l1: HLine, l2: HLine): HPoint {
  const p = cross([...l1], [...l2]) as number[];
  const n = Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
  if (n < 1e-15) {
    // 两线系数成比例（重合）或同为零向量 —— 退化共线情形。
    throw new Error('intersect: 两线重合或退化，交点不确定');
  }
  return [p[0] / n, p[1] / n, p[2] / n];
}

export function linePointSide(l: HLine, p: Point2): number {
  return l[0] * p.x + l[1] * p.y + l[2];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 无穷远直线（W... 实际是直线 a=b=0）不存在；这里裁剪的总是有限直线段。 */
export interface Segment2 {
  a: Point2;
  b: Point2;
}

/**
 * 把"经过 p、朝向消失点 vp"的射线与矩形求交，返回落在矩形内的线段。
 * - vp 有限：过 p 与 vp 的整条直线裁剪进矩形（Liang–Barsky）；
 * - vp 无穷远：按其方向做无限长直线裁剪。
 * 两种情形都不把 vp 截到矩形边上。
 */
export function clipRayToRect(
  p: Point2,
  vp: HPoint,
  rect: Rect,
  length = 1e7,
): Segment2 | null {
  let dx: number;
  let dy: number;
  if (finite(vp)) {
    const v = toEuclidean(vp);
    dx = v.x - p.x;
    dy = v.y - p.y;
  } else {
    const d = toDirection(vp);
    dx = d.x;
    dy = d.y;
  }
  if (Math.hypot(dx, dy) < 1e-15) return null;
  dx *= length;
  dy *= length;
  // 以 p 为中点向两侧延伸，保证无限直线完整穿过矩形。
  return liangBarsky(p.x - dx, p.y - dy, p.x + dx, p.y + dy, rect);
}

/** 有限线段裁剪进矩形（Liang–Barsky）。 */
export function liangBarsky(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: Rect,
): Segment2 | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [
    x1 - rect.x,
    rect.x + rect.w - x1,
    y1 - rect.y,
    rect.y + rect.h - y1,
  ];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-15) {
      if (q[i] < 0) return null; // 线段平行于此边界且在矩形外
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return {
    a: { x: x1 + t0 * dx, y: y1 + t0 * dy },
    b: { x: x1 + t1 * dx, y: y1 + t1 * dy },
  };
}
