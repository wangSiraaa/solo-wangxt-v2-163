import { cross as mathCross, dot as mathDot } from 'mathjs';
import type { HLine, HPoint, Point2 } from '../types';

export const EPSILON = 1e-9;

/** 三维向量叉积（mathjs 返回类型较宽，这里收窄为三元组）。 */
export function cross3(
  a: readonly number[],
  b: readonly number[],
): [number, number, number] {
  const r = mathCross([...a], [...b]) as number[];
  return [r[0], r[1], r[2]];
}

export function dot3(a: readonly number[], b: readonly number[]): number {
  return mathDot([...a], [...b]) as number;
}

/** 有限欧氏点 → 齐次点。 */
export function toHomogeneous(p: Point2): HPoint {
  return [p.x, p.y, 1] as const;
}

/**
 * 齐次点反投影为有限点。
 * 对 w≈0 的无穷远点返回 null —— 调用方必须走无穷远分支，绝不能返回大坐标夹边。
 */
export function fromHomogeneous(p: HPoint): Point2 | null {
  const [u, v, w] = p;
  if (Math.abs(w) <= EPSILON) return null;
  return { x: u / w, y: v / w };
}

/** 齐次点是否表示无穷远方向。 */
export function isInfinite(p: HPoint): boolean {
  return Math.abs(p[2]) <= EPSILON;
}

/** 归一化齐次点，使有限点 w=1、无穷远点 (u,v) 为单位方向。 */
export function normalizeHPoint(p: HPoint): HPoint {
  const [u, v, w] = p;
  if (Math.abs(w) > EPSILON) {
    return [u / w, v / w, 1] as const;
  }
  const n = Math.hypot(u, v) || 1;
  return [u / n, v / n, 0] as const;
}

/** 归一化直线系数，使法向量 (a,b) 为单位长度（便于数值比较）。 */
export function normalizeHLine(l: HLine): HLine {
  const [a, b, c] = l;
  const n = Math.hypot(a, b);
  if (n <= EPSILON) return [0, 0, 0] as const;
  return [a / n, b / n, c / n] as const;
}

/** 两直线交点（齐次）；退化（平行/重合）时 w=0 或零向量。 */
export function lineIntersection(l1: HLine, l2: HLine): HPoint {
  return normalizeHPoint(cross3(l1, l2));
}

/** 过两点的直线（齐次）；重合点退化时返回零直线。 */
export function lineThrough(p1: HPoint, p2: HPoint): HLine {
  return normalizeHLine(cross3(p1, p2));
}

/** 点在直线上（带容差，输入需归一化）。 */
export function pointOnLine(p: HPoint, l: HLine): boolean {
  return Math.abs(l[0] * p[0] + l[1] * p[1] + l[2] * p[2]) <= 1e-7;
}

/** 有限点到归一化直线的有向距离。 */
export function distanceToLine(p: Point2, l: HLine): number {
  return l[0] * p.x + l[1] * p.y + l[2];
}

/** 点到直线垂足（输入直线需归一化；返回有限点，直线非法时返回 null）。 */
export function projectPointToLine(p: Point2, l: HLine): Point2 | null {
  const [a, b, c] = l;
  if (Math.hypot(a, b) <= EPSILON) return null;
  const d = a * p.x + b * p.y + c;
  return { x: p.x - a * d, y: p.y - b * d };
}

/**
 * 把有限线段裁剪到矩形 [0,width]×[0,height]，Liang–Barsky 算法。
 * 完全在外返回 null；在内则返回 [入点, 出点]。
 */
export function clipSegmentToRect(
  a: Point2,
  b: Point2,
  width: number,
  height: number,
): [Point2, Point2] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x, width - a.x, a.y, height - a.y];

  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) <= EPSILON) {
      if (q[i] < 0) return null; // 与边界平行且在外侧
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

  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** 两点距离。 */
export function distance(a: Point2, b: Point2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 生成短随机 id（无后端环境足够）。 */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
