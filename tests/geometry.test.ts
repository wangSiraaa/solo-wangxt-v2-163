import { describe, expect, it } from 'vitest';
import type { CameraModel } from '../src/types';
import {
  buildGuide,
  createPresetCamera,
  focalFromVerticalFov,
  guideFanSegments,
  horizonLine,
  lineThroughRect,
} from '../src/geometry/perspective';
import {
  clipSegmentToRect,
  cross3,
  fromHomogeneous,
  lineIntersection,
  lineThrough,
  normalizeHLine,
  toHomogeneous,
} from '../src/geometry/homogeneous';

const W = 1200;
const H = 800;

describe('齐次坐标基础', () => {
  it('两直线交点与两点连线互逆（mathjs 叉积）', () => {
    const l1 = lineThrough(toHomogeneous({ x: 0, y: 1 }), toHomogeneous({ x: 10, y: 1 }));
    const l2 = lineThrough(toHomogeneous({ x: 3, y: -5 }), toHomogeneous({ x: 3, y: 9 }));
    const p = lineIntersection(l1, l2);
    expect(fromHomogeneous(p)).toEqual({ x: 3, y: 1 });
    // 交点应同时落在两条线上
    expect(l1[0] * p[0] + l1[1] * p[1] + l1[2] * p[2]).toBeCloseTo(0, 10);
  });

  it('平行直线交点在无穷远 w=0，不产生被夹到边缘的大坐标', () => {
    const l1 = lineThrough(toHomogeneous({ x: 0, y: 0 }), toHomogeneous({ x: 1, y: 2 }));
    const l2 = lineThrough(toHomogeneous({ x: 5, y: 0 }), toHomogeneous({ x: 6, y: 2 }));
    const p = lineIntersection(l1, l2);
    expect(p[2]).toBeCloseTo(0, 10);
    expect(fromHomogeneous(p)).toBeNull();
  });

  it('重合点连线退化为零直线，可被检测', () => {
    const l = lineThrough(toHomogeneous({ x: 4, y: 4 }), toHomogeneous({ x: 4, y: 4 }));
    expect(Math.hypot(l[0], l[1])).toBeCloseTo(0, 10);
  });

  it('线段矩形裁剪：完全在外返回 null，穿框返回入出点', () => {
    const r = clipSegmentToRect({ x: -10, y: 400 }, { x: 1300, y: 400 }, W, H);
    expect(r).not.toBeNull();
    expect(r![0]).toEqual({ x: 0, y: 400 });
    expect(r![1]).toEqual({ x: W, y: 400 });
    expect(clipSegmentToRect({ x: -10, y: -10 }, { x: -5, y: -5 }, W, H)).toBeNull();
  });
});

describe('相机基与投影', () => {
  it('一点透视：yaw=pitch=0 时 X/Y 消失点在无穷远，Z 消失点在画面中心', () => {
    const cam = createPresetCamera('one', W, H);
    const guide = buildGuide(cam, W, H);
    expect(guide.axes.x.isInfinite).toBe(true);
    expect(guide.axes.y.isInfinite).toBe(true);
    expect(guide.axes.z.isInfinite).toBe(false);
    const z = fromHomogeneous(guide.axes.z.vanishingPoint)!;
    expect(z.x).toBeCloseTo(W / 2, 6);
    expect(z.y).toBeCloseTo(H / 2, 6);
  });

  it('两点透视：X/Z 为两个不同的有限消失点，竖直 Y 在无穷远（铅垂线平行）', () => {
    const cam = createPresetCamera('two', W, H);
    const guide = buildGuide(cam, W, H);
    expect(guide.axes.y.isInfinite).toBe(true);
    expect(guide.axes.x.isInfinite).toBe(false);
    expect(guide.axes.z.isInfinite).toBe(false);
    // Y 无穷远方向必须严格竖直（w=0, u=0）
    const [u, v, w] = guide.axes.y.vanishingPoint;
    expect(w).toBeCloseTo(0, 10);
    expect(u).toBeCloseTo(0, 10);
    expect(Math.abs(v)).toBeCloseTo(1, 10);
  });

  it('三点透视：三个消失点均有限，且竖直 VP 位于地平线之外', () => {
    const cam = createPresetCamera('three', W, H);
    const guide = buildGuide(cam, W, H);
    expect(Object.values(guide.axes).every((a) => !a.isInfinite)).toBe(true);
    const vpY = fromHomogeneous(guide.axes.y.vanishingPoint)!;
    // 俯视（高位地平线）：竖直 VP 在地平线下方（y 向下坐标系）
    const [a, b, c] = normalizeHLine(guide.horizon);
    const side = a * vpY.x + b * vpY.y + c;
    expect(Math.abs(side)).toBeGreaterThan(1);
  });

  it('高位地平线：俯视时地平线位于像主点上方，且是齐次准确直线', () => {
    // yaw=0 时地平线有解析解 y = py - f·tan(pitch)；
    // 齐次叉积版本对任意 yaw/roll 都成立（其余用例已覆盖）。
    const base = createPresetCamera('one', W, H);
    const cam: CameraModel = { ...base, pitch: (30 * Math.PI) / 180 };
    const guide = buildGuide(cam, W, H);
    const [a, b, c] = normalizeHLine(guide.horizon);
    // 在像主点 x 处的地平线 y
    const yAtPrincipal = -(a * cam.principalX + c) / b;
    expect(yAtPrincipal).toBeLessThan(cam.principalY);
    // 解析值：py - f·tan(pitch)（pitch>0 俯视 → 高位地平线）
    expect(yAtPrincipal).toBeCloseTo(cam.principalY - cam.focal * Math.tan(cam.pitch), 5);
  });

  it('极端透视：yaw 趋近 0 时 X 消失点趋于无穷远，过程中不夹边', () => {
    const base = createPresetCamera('two', W, H);
    const angles = [40, 20, 10, 1, 0.1];
    for (const deg of angles) {
      const cam = { ...base, yaw: (deg * Math.PI) / 180 };
      const vp = buildGuide(cam, W, H).axes.x.vanishingPoint;
      // 有限 VP 时坐标可以远超画布（1200），系统必须保留真值而不是截断
      const p = fromHomogeneous(vp);
      if (p && deg <= 40) {
        expect(p.x < 0 || p.x > W).toBe(true);
      }
    }
    // 极限 yaw=0：X 轴平行于画面，必须是齐次无穷远点，而不是大数
    const limit = buildGuide({ ...base, yaw: 0 }, W, H).axes.x.vanishingPoint;
    expect(limit[2]).toBeCloseTo(0, 9);
  });

  it('极端广角与长焦：焦距变化只影响消失点深度，不改变 w 是否为零的定性结论', () => {
    const cam = createPresetCamera('two', W, H);
    const wide = buildGuide({ ...cam, focal: focalFromVerticalFov((170 * Math.PI) / 180, H) }, W, H);
    const tele = buildGuide({ ...cam, focal: focalFromVerticalFov((5 * Math.PI) / 180, H) }, W, H);
    expect(wide.axes.y.isInfinite).toBe(true);
    expect(tele.axes.y.isInfinite).toBe(true);
    const xWide = fromHomogeneous(wide.axes.x.vanishingPoint)!.x;
    const xTele = fromHomogeneous(tele.axes.x.vanishingPoint)!.x;
    // 长焦下消失点被推到极远
    expect(Math.abs(xTele - W / 2)).toBeGreaterThan(Math.abs(xWide - W / 2) * 5);
  });

  it('地平线始终同时通过两个水平消失点（含一点透视中 X 在无穷远）', () => {
    for (const mode of ['one', 'two', 'three'] as const) {
      const guide = buildGuide(createPresetCamera(mode, W, H), W, H);
      const h = guide.horizon;
      const on = (p: readonly number[]) => h[0] * p[0] + h[1] * p[1] + h[2] * p[2];
      expect(Math.abs(on(guide.axes.x.vanishingPoint))).toBeLessThan(1e-7);
      expect(Math.abs(on(guide.axes.z.vanishingPoint))).toBeLessThan(1e-7);
    }
  });

  it('滚转 + 俯仰时地平线为斜线（不做水平常数特判）', () => {
    const cam = { ...createPresetCamera('one', W, H), pitch: 0.2, roll: 0.3 };
    const h = normalizeHLine(horizonLine(
      buildGuide(cam, W, H).axes.x.vanishingPoint,
      buildGuide(cam, W, H).axes.z.vanishingPoint,
    ));
    // 倾斜直线：|a| 与 |b| 都不可忽略
    expect(Math.abs(h[0])).toBeGreaterThan(0.1);
    expect(Math.abs(h[1])).toBeGreaterThan(0.5);
  });
});

describe('参考扇形（画外 VP / 无穷远）', () => {
  it('所有 X 轴扇形线（齐次）严格经过 X 消失点，即使它在画外', () => {
    const cam = createPresetCamera('two', W, H);
    const guide = buildGuide(cam, W, H);
    const vp = guide.axes.x.vanishingPoint;
    expect(fromHomogeneous(vp)!.x).toBeLessThan(0); // 预设 VP 在画外左侧
    const segs = guideFanSegments(guide, 8).filter((s) => s.axis === 'x' && !s.isHorizon);
    expect(segs.length).toBeGreaterThan(5);
    for (const s of segs) {
      const l = normalizeHLine(cross3(toHomogeneous(s.a), toHomogeneous(s.b)));
      const residual = l[0] * vp[0] + l[1] * vp[1] + l[2] * vp[2];
      const scale = Math.hypot(vp[0] / vp[2], vp[1] / vp[2], 1);
      expect(Math.abs(residual) / scale).toBeLessThan(1e-9);
    }
  });

  it('一点透视的无穷远轴：扇形线全部严格平行', () => {
    const guide = buildGuide(createPresetCamera('one', W, H), W, H);
    const segs = guideFanSegments(guide, 8).filter((s) => s.axis === 'y' && !s.isHorizon);
    expect(segs.length).toBeGreaterThan(5);
    const dirs = segs.map((s) => {
      const d = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
      const n = Math.hypot(d.x, d.y) || 1;
      return { x: d.x / n, y: d.y / n };
    });
    for (const d of dirs) {
      // 竖直方向（允许反向）
      expect(Math.abs(d.x)).toBeLessThan(1e-9);
      expect(Math.abs(d.y)).toBeCloseTo(1, 9);
    }
  });

  it('远在画布外的消失点直线与矩形相交正确，不依赖把 VP 拉回边缘', () => {
    const guide = buildGuide(
      { ...createPresetCamera('two', W, H), yaw: (0.1 * Math.PI) / 180 },
      W,
      H,
    );
    const vp = guide.axes.x.vanishingPoint;
    const seed = { x: 200, y: 300 };
    const line = normalizeHLine(cross3(vp, toHomogeneous(seed)));
    const chord = lineThroughRect(line, W, H);
    expect(chord).not.toBeNull();
    // 交点弦两端必须在矩形边界上
    for (const p of [chord![0], chord![1]]) {
      const onEdge =
        Math.abs(p.x) < 1e-6 ||
        Math.abs(p.x - W) < 1e-6 ||
        Math.abs(p.y) < 1e-6 ||
        Math.abs(p.y - H) < 1e-6;
      expect(onEdge).toBe(true);
    }
  });
});
