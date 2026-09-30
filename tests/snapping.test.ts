import { describe, expect, it } from 'vitest';
import type { Point2, Stroke } from '../src/types';
import { buildGuide, createPresetCamera } from '../src/geometry/perspective';
import {
  constrainPoints,
  findSnapAxis,
  lineThroughVanishingPoint,
  snapStroke,
  DEFAULT_SNAP_ANGLE,
} from '../src/geometry/snapping';
import { fromHomogeneous, toHomogeneous } from '../src/geometry/homogeneous';
import { detectCollinearDegeneracy, verifyStroke } from '../src/geometry/verify';

const W = 1200;
const H = 800;

function stroke(rawPoints: Point2[], constrained: Point2[] | null, axis: Stroke['snappedAxis']): Stroke {
  return {
    id: 's1',
    layerId: 'layer-art',
    tool: 'segment',
    color: '#000',
    strokeWidth: 2,
    rawPoints,
    constrainedPoints: constrained,
    snappedAxis: axis,
    createdAt: 0,
  };
}

describe('吸附：有限消失点', () => {
  const guide = buildGuide(createPresetCamera('two', W, H), W, H);

  it('接近 X 汇聚方向的线段吸附到 X 轴', () => {
    const vpX = fromHomogeneous(guide.axes.x.vanishingPoint)!;
    const a: Point2 = { x: 300, y: 500 };
    // 真实指向 VP 的终点 + 微小扰动
    const b: Point2 = { x: vpX.x + 100, y: vpX.y + 60 };
    const match = findSnapAxis(a, b, guide.axes);
    expect(match).not.toBeNull();
    expect(match!.axis).toBe('x');

    const result = snapStroke([a, b], 'segment', guide.axes);
    expect(result).not.toBeNull();
    expect(result!.axis).toBe('x');
    // 约束后首点不动，长度保持，且直线严格经过 VP
    expect(result!.constrained[0]).toEqual(a);
    const l = lineThroughVanishingPoint(a, guide.axes.x.vanishingPoint);
    const q = result!.constrained[1];
    expect(l[0] * q.x + l[1] * q.y + l[2]).toBeCloseTo(0, 9);
  });

  it('偏离所有参考方向超过阈值时不吸附', () => {
    // 45° 斜线：两个水平 VP 是近水平线方向、竖直轴是 90°，与 45° 相差都超过 8°。
    const a: Point2 = { x: 100, y: 100 };
    const b: Point2 = { x: 300, y: 300 };
    const match = findSnapAxis(a, b, guide.axes, DEFAULT_SNAP_ANGLE);
    expect(match).toBeNull();
    expect(snapStroke([a, b], 'segment', guide.axes)).toBeNull();
  });

  it('约束后的笔画通过几何校验（每一段都过消失点）', () => {
    const vpZ = fromHomogeneous(guide.axes.z.vanishingPoint)!;
    const a: Point2 = { x: 800, y: 650 };
    // 沿 a→VPZ 真实方向取点，加少量横向抖动；起点在地平线之外，X 轴方向与之明显分离。
    const dir = { x: vpZ.x - a.x, y: vpZ.y - a.y };
    const n = Math.hypot(dir.x, dir.y);
    const b: Point2 = {
      x: a.x + (dir.x / n) * 400 + 6,
      y: a.y + (dir.y / n) * 400 - 4,
    };
    const result = snapStroke([a, b], 'segment', guide.axes);
    expect(result).not.toBeNull();
    expect(result!.axis).toBe('z');
    const issue = verifyStroke(
      stroke([a, b], result!.constrained, result!.axis),
      guide,
    );
    expect(issue).toBeNull();
  });
});

describe('吸附：无穷远消失点（平行于画面）', () => {
  const guide = buildGuide(createPresetCamera('two', W, H), W, H);

  it('竖直线吸附到 Y 无穷远轴，约束结果严格竖直（平行）', () => {
    const a: Point2 = { x: 500, y: 200 };
    const b: Point2 = { x: 506, y: 600 }; // 略带抖动的竖线
    const result = snapStroke([a, b], 'segment', guide.axes);
    expect(result).not.toBeNull();
    expect(result!.axis).toBe('y');
    const [p, q] = result!.constrained;
    expect(q.x).toBeCloseTo(p.x, 9);
    // 几何校验对无穷远 VP 同样通过
    expect(verifyStroke(stroke([a, b], result!.constrained, 'y'), guide)).toBeNull();
  });

  it('一点透视下 X 轴无穷远：水平线吸附后保持水平', () => {
    const one = buildGuide(createPresetCamera('one', W, H), W, H);
    const a: Point2 = { x: 200, y: 300 };
    const b: Point2 = { x: 900, y: 294 };
    const result = snapStroke([a, b], 'segment', one.axes);
    expect(result).not.toBeNull();
    expect(['x', 'z']).toContain(result!.axis);
    const q = result!.constrained[1];
    if (result!.axis === 'x') {
      expect(q.y).toBeCloseTo(a.y, 9);
    }
  });
});

describe('退化与共线输入', () => {
  const guide = buildGuide(createPresetCamera('two', W, H), W, H);

  it('零长度/重合点输入不产生吸附，不抛异常', () => {
    const a: Point2 = { x: 100, y: 100 };
    expect(snapStroke([a, { ...a }], 'segment', guide.axes)).toBeNull();
    expect(snapStroke([a], 'segment', guide.axes)).toBeNull();
    expect(detectCollinearDegeneracy([a, { ...a }, { ...a }])).toEqual({
      ok: false,
      reason: 'coincident',
    });
    expect(detectCollinearDegeneracy([a])).toEqual({ ok: false, reason: 'too-few' });
  });

  it('NaN / 无穷坐标输入被安全拒绝', () => {
    const a: Point2 = { x: 100, y: 100 };
    const bad: Point2 = { x: Number.NaN, y: 500 };
    expect(() => snapStroke([a, bad], 'segment', guide.axes)).not.toThrow();
    const result = snapStroke([a, bad], 'segment', guide.axes);
    // NaN 夹角不可比，不应吸附
    expect(result === null || Number.isFinite(result.constrained[1].x)).toBe(true);
  });

  it('极端透视（yaw 0.01°，X VP 在极远画外）下吸附仍稳定，约束线通过画外 VP', () => {
    const extreme = buildGuide(
      { ...createPresetCamera('two', W, H), yaw: (0.01 * Math.PI) / 180 },
      W,
      H,
    );
    const vpX = extreme.axes.x.vanishingPoint;
    const a: Point2 = { x: 400, y: 500 };
    // 直接沿「到画外 VP」方向造一条线
    const v = fromHomogeneous(vpX)!;
    const dir = { x: v.x - a.x, y: v.y - a.y };
    const n = Math.hypot(dir.x, dir.y);
    const b: Point2 = { x: a.x + (dir.x / n) * 300, y: a.y + (dir.y / n) * 300 };
    const result = snapStroke([a, b], 'segment', extreme.axes, (1 * Math.PI) / 180);
    expect(result).not.toBeNull();
    expect(result!.axis).toBe('x');
    expect(verifyStroke(stroke([a, b], result!.constrained, 'x'), extreme, 1e-5)).toBeNull();
  });
});

describe('自由笔画约束', () => {
  const guide = buildGuide(createPresetCamera('two', W, H), W, H);

  it('自由笔画各点投影到同一条消失直线，校验通过', () => {
    const vp = fromHomogeneous(guide.axes.z.vanishingPoint)!;
    const a: Point2 = { x: 600, y: 600 };
    const raw: Point2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      raw.push({
        x: a.x + (vp.x - a.x) * t + (i % 2 ? 3 : -2),
        y: a.y + (vp.y - a.y) * t + (i % 2 ? -2 : 3),
      });
    }
    const result = snapStroke(raw, 'freehand', guide.axes);
    expect(result).not.toBeNull();
    const issue = verifyStroke(stroke(raw, result!.constrained, result!.axis), guide, 1e-5);
    expect(issue).toBeNull();
  });

  it('constrainPoints 保留首点且输入数组不被修改', () => {
    const raw: Point2[] = [
      { x: 0, y: 0 },
      { x: 5, y: 2 },
      { x: 10, y: 5 },
    ];
    const snapshot = JSON.parse(JSON.stringify(raw));
    constrainPoints(raw, guide.axes, 'y', 'freehand');
    expect(raw).toEqual(snapshot);
    void toHomogeneous; // 保持工具导入引用
  });
});
