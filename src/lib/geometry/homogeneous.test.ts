import { describe, it, expect } from 'vitest';
import {
  finite,
  hpoint,
  infinityPoint,
  intersect,
  lineFromPoints,
  lineThrough,
  liangBarsky,
  clipRayToRect,
  toEuclidean,
  toDirection,
} from './homogeneous';

describe('齐次直线几何', () => {
  it('两条普通直线交于有限点', () => {
    // y=x 与 y=1 -> (1,1)
    const l1 = lineFromPoints({ x: 0, y: 0 }, { x: 2, y: 2 });
    const l2 = lineFromPoints({ x: -5, y: 1 }, { x: 5, y: 1 });
    const p = intersect(l1, l2);
    expect(finite(p)).toBe(true);
    expect(toEuclidean(p)).toEqual({ x: 1, y: 1 });
  });

  it('平行线交于无穷远（W=0），不是边缘假点', () => {
    const l1 = lineFromPoints({ x: 0, y: 0 }, { x: 1, y: 1 });
    const l2 = lineFromPoints({ x: 0, y: 2 }, { x: 1, y: 3 });
    const vp = intersect(l1, l2);
    expect(finite(vp)).toBe(false);
    expect(vp[2]).toBeCloseTo(0, 10);
    const d = toDirection(vp);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 12);
    expect(d.x).toBeCloseTo(d.y, 10); // 斜率 1 的方向（符号不定）
  });

  it('无穷远点与有限点连线得到与之平行的直线', () => {
    const vp = infinityPoint(3, 4);
    const l = lineThrough(hpoint(10, -70), vp);
    // 直线方向必须是 (3,4)：法向量 (a,b) 与方向点积为 0
    expect(3 * l[0] + 4 * l[1]).toBeCloseTo(0, 10);
    expect(l[0] * 10 + l[1] * -70 + l[2]).toBeCloseTo(0, 10);
  });

  it('重合直线/重合点被显式判为退化', () => {
    const l = lineFromPoints({ x: 0, y: 0 }, { x: 1, y: 0 });
    expect(() => intersect(l, l)).toThrow(/退化|重合/);
    expect(() => lineThrough(hpoint(2, 2), hpoint(2, 2))).toThrow(/重合/);
  });

  it('VP 在画布外极远处（1e7 像素量级）仍正确归一化', () => {
    const vp = hpoint(1e7, -1e8);
    const p = toEuclidean(vp);
    expect(p.x).toBeCloseTo(1e7, 3);
    expect(p.y).toBeCloseTo(-1e8, 3);
  });

  it('toEuclidean 拒绝无穷远点，防止误截到边缘', () => {
    expect(() => toEuclidean(infinityPoint(1, 0))).toThrow(/无穷远/);
  });
});

describe('线段裁剪', () => {
  const rect = { x: 0, y: 0, w: 100, h: 100 };

  it('Liang–Barsky 裁剪穿越矩形的线段', () => {
    const s = liangBarsky(-20, 50, 120, 50, rect)!;
    expect(s.a.x).toBeCloseTo(0, 10);
    expect(s.b.x).toBeCloseTo(100, 10);
  });

  it('矩形外的线段返回 null', () => {
    expect(liangBarsky(-50, -50, -10, -10, rect)).toBeNull();
  });

  it('向有限 VP 收敛的射线按整条直线裁剪，VP 不被截断', () => {
    const vp = hpoint(5000, 5000); // 画布外极远
    const s = clipRayToRect({ x: 50, y: 50 }, vp, rect)!;
    expect(Math.min(s.a.x, s.b.x)).toBeLessThan(1e-4);
    expect(Math.max(s.a.x, s.b.x)).toBeGreaterThan(100 - 1e-4);
  });

  it('无穷远 VP 按平行方向裁剪', () => {
    const s = clipRayToRect({ x: 50, y: 50 }, infinityPoint(1, 0), rect)!;
    expect(s.a).toEqual({ x: 0, y: 50 });
    expect(s.b).toEqual({ x: 100, y: 50 });
  });
});
