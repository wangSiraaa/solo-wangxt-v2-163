import { describe, it, expect } from 'vitest';
import type { Point2, Ruler } from '../../types';
import { hpoint, infinityPoint } from './homogeneous';
import {
  classifySegment,
  constrainStroke,
  projectToLine,
  rayDirection,
  segmentAngleToAxis,
  vanishingLine,
} from './snap';

function onePointRuler(vp: Point2): Ruler {
  // kind=3 仅为让分类器遍历全部三个槽位；这里轴 0 有限、1/2 为无穷远，
  // 与一点透视实际使用的方向集合一致。
  return {
    kind: 3,
    axes: [
      hpoint(vp.x, vp.y),
      infinityPoint(1, 0),
      infinityPoint(0, 1),
    ],
    focal: 500,
    principal: vp,
    rotation: { pan: 0, tilt: 0 },
    horizonAxes: [0, 1],
    verticalAxis: 2,
  };
}

describe('吸附分类', () => {
  const ruler = onePointRuler({ x: 400, y: 300 });

  it('指向 VP 的段归为该轴', () => {
    expect(classifySegment({ x: 100, y: 100 }, { x: 200, y: 150 }, ruler)).toBe(0);
  });

  it('偏离过大的段保持自由（null）', () => {
    expect(classifySegment({ x: 100, y: 100 }, { x: 200, y: 260 }, ruler)).toBeNull();
  });

  it('背离有限 VP 的同直线段不会被误吸', () => {
    // VP 在 (400,300)，p0 在 VP 另一侧，段继续背离 VP 向右下
    expect(classifySegment({ x: 600, y: 450 }, { x: 700, y: 525 }, ruler)).toBeNull();
  });

  it('零长退化段不分类', () => {
    expect(classifySegment({ x: 5, y: 5 }, { x: 5, y: 5 }, ruler)).toBeNull();
  });

  it('无穷远轴按平行方向匹配', () => {
    // 轴 1 是水平方向
    expect(classifySegment({ x: 0, y: 0 }, { x: 100, y: 1 }, ruler)).toBe(1);
    // 轴 2 是竖直方向
    expect(classifySegment({ x: 0, y: 0 }, { x: 1, y: 100 }, ruler)).toBe(2);
  });

  it('极远 VP 等价于近似平行方向，仍能分类', () => {
    const far: Ruler = { ...ruler, axes: [hpoint(1e9, 300), ...ruler.axes.slice(1)] as Ruler['axes'] };
    const angle = segmentAngleToAxis({ x: 0, y: 300 }, { x: 100, y: 300 }, far.axes[0]);
    expect(angle).toBeLessThan(0.01);
  });
});

describe('链式约束', () => {
  const ruler = onePointRuler({ x: 400, y: 300 });

  it('约束段终点落在过约束起点、朝向 VP 的直线上', () => {
    const raw: Point2[] = [
      { x: 100, y: 100 },
      { x: 200, y: 160 },
      { x: 300, y: 210 },
    ];
    const axes = [0, 0] as const;
    const out = constrainStroke(raw, [...axes], ruler);
    const l = vanishingLine(out[0], ruler.axes[0]);
    for (let i = 1; i < out.length; i++) {
      expect(l[0] * out[i].x + l[1] * out[i].y + l[2]).toBeCloseTo(0, 6);
    }
  });

  it('链式约束的相邻段首尾相接，不会产生裂缝', () => {
    const raw: Point2[] = [
      { x: 50, y: 80 },
      { x: 150, y: 140 },
      { x: 250, y: 220 },
    ];
    const out = constrainStroke(raw, [0, 0], ruler);
    expect(out[1]).toBeDefined();
    // 第二段的约束线过 out[1]，故 out[2] 与 out[1] 在同一条 VP 线上
    const l2 = vanishingLine(out[1], ruler.axes[0]);
    expect(l2[0] * out[2].x + l2[1] * out[2].y + l2[2]).toBeCloseTo(0, 8);
  });

  it('自由段透传 raw 并在其后重新起锚；raw 永不改变', () => {
    const raw: Point2[] = [
      { x: 10, y: 10 },
      { x: 20, y: 99 },
      { x: 200, y: 160 },
    ];
    const snapshot = JSON.stringify(raw);
    const out = constrainStroke(raw, [null, 0], ruler);
    expect(out[1]).toEqual(raw[1]);
    expect(JSON.stringify(raw)).toBe(snapshot);
    const l = vanishingLine(out[1], ruler.axes[0]);
    expect(l[0] * out[2].x + l[1] * out[2].y + l[2]).toBeCloseTo(0, 8);
  });

  it('垂足投影是正交投影', () => {
    const l = vanishingLine({ x: 0, y: 0 }, infinityPoint(1, 0)); // y=0
    const q = projectToLine({ x: 35, y: 42 }, l);
    expect(q.x).toBeCloseTo(35, 10);
    expect(q.y).toBeCloseTo(0, 10);
  });

  it('起点与有限 VP 重合时方向退化被检测', () => {
    expect(() => rayDirection({ x: 400, y: 300 }, hpoint(400, 300))).toThrow(/退化/);
  });
});
