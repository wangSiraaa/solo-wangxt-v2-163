import { describe, it, expect } from 'vitest';
import {
  basisFromRotation,
  projectWorldPoint,
  rulerFromRotation,
} from './camera3d';
import {
  RULER_PRESETS,
  axesCollinear,
  horizonLine,
  validateRuler,
} from './rulers';
import { finite, linePointSide, toDirection, toEuclidean } from '../geometry/homogeneous';
import type { AxisId } from '../../types';

const W = 1000;
const H = 700;
const DEG = Math.PI / 180;

describe('由相机旋转生成标尺', () => {
  it('一点透视：纵深 VP 落在主点，水平/竖直 VP 在无穷远', () => {
    const ruler = rulerFromRotation(1, { pan: 0, tilt: 0 }, 500, {
      x: W / 2,
      y: H / 2,
    });
    expect(finite(ruler.axes[1])).toBe(true);
    expect(toEuclidean(ruler.axes[1])).toEqual({ x: 500, y: 350 });
    expect(finite(ruler.axes[0])).toBe(false);
    expect(finite(ruler.axes[2])).toBe(false);
    expect(toDirection(ruler.axes[0])).toEqual({ x: 1, y: 0 });
    expect(toDirection(ruler.axes[2])).toEqual({ x: 0, y: 1 });
  });

  it('两点透视：竖直 VP 在无穷远，两个水平 VP 分居两侧', () => {
    const ruler = rulerFromRotation(2, { pan: 35 * DEG, tilt: 0 }, 500, {
      x: 500,
      y: 350,
    });
    expect(finite(ruler.axes[2])).toBe(false);
    const v0 = toEuclidean(ruler.axes[0]);
    const v1 = toEuclidean(ruler.axes[1]);
    // pan=+35° 时：X 轴 VP 在主点左侧，Y 轴 VP 在右侧
    expect(v0.x).toBeLessThan(500);
    expect(v1.x).toBeGreaterThan(500);
    expect(v0.y).toBeCloseTo(350, 6);
    expect(v1.y).toBeCloseTo(350, 6);
  });

  it('三点透视：三个 VP 全部有限且不共线', () => {
    const ruler = rulerFromRotation(3, { pan: 40 * DEG, tilt: -55 * DEG }, 300, {
      x: 500,
      y: 700,
    });
    for (let a = 0; a < 3; a++) {
      expect(finite(ruler.axes[a as AxisId])).toBe(true);
    }
    expect(axesCollinear(ruler)).toBe(false);
  });

  it('极端三点预设：VP 远在画布外依然有限且数值稳定，绝不截到边缘', () => {
    const worm = RULER_PRESETS.find((p) => p.id === 'three-point-worm')!;
    const rw = worm.build(W, H);
    const vUp = toEuclidean(rw.axes[2]);
    expect(Number.isFinite(vUp.x) && Number.isFinite(vUp.y)).toBe(true);
    expect(vUp.y).toBeLessThan(-H); // 仰视：竖直 VP 在画框上方之外
    expect(validateRuler(rw)).toEqual([]);

    const bird = RULER_PRESETS.find((p) => p.id === 'three-point-bird')!;
    const rb = bird.build(W, H);
    const vDown = toEuclidean(rb.axes[2]);
    expect(vDown.y).toBeGreaterThan(H + 100); // 俯视：竖直 VP 已在画框下方之外
    expect(validateRuler(rb)).toEqual([]);
  });

  it('所有预设通过标尺合法性自检', () => {
    for (const preset of RULER_PRESETS) {
      expect(validateRuler(preset.build(W, H)), preset.id).toEqual([]);
    }
  });

  it('高位地平线：一点透视 VP 位于画面 92% 处', () => {
    const preset = RULER_PRESETS.find((p) => p.id === 'one-point-high')!;
    const ruler = preset.build(W, H);
    expect(toEuclidean(ruler.axes[1]).y).toBeCloseTo(H * 0.92, 6);
  });
});

describe('地平线', () => {
  it('一点透视的地平线是过纵深 VP 的水平线，水平轴在无穷远', () => {
    const ruler = RULER_PRESETS.find((p) => p.id === 'one-point-high')!.build(W, H);
    const h = horizonLine(ruler)!;
    const vp = toEuclidean(ruler.axes[1]);
    expect(linePointSide(h, vp)).toBeCloseTo(0, 8);
    expect(linePointSide(h, { x: 0, y: vp.y })).toBeCloseTo(0, 8);
  });

  it('两点透视地平线连接两个水平 VP', () => {
    const ruler = RULER_PRESETS.find((p) => p.id === 'two-point-normal')!.build(W, H);
    const h = horizonLine(ruler)!;
    expect(linePointSide(h, toEuclidean(ruler.axes[0]))).toBeCloseTo(0, 8);
    expect(linePointSide(h, toEuclidean(ruler.axes[1]))).toBeCloseTo(0, 8);
  });
});

describe('投影一致性', () => {
  it('参考盒边的投影指向对应消失点（端到端几何检验）', () => {
    const ruler = rulerFromRotation(3, { pan: 30 * DEG, tilt: 25 * DEG }, 500, {
      x: 500,
      y: 350,
    });
    const basis = basisFromRotation({ pan: 30 * DEG, tilt: 25 * DEG });
    const center: [number, number, number] = [0, 0, -900];
    // 盒子两个角点，只沿世界 X 轴相差
    const pa = projectWorldPoint([-120, 0, 0], ruler, basis, center);
    const pb = projectWorldPoint([120, 0, 0], ruler, basis, center);
    const vp = toEuclidean(ruler.axes[0]);
    // 边两端与 VP 共线
    const cross =
      (pb.x - pa.x) * (vp.y - pa.y) - (pb.y - pa.y) * (vp.x - pa.x);
    expect(Math.abs(cross)).toBeLessThan(1e-4 * Math.hypot(pb.x - pa.x, pb.y - pa.y));
  });

  it('相机后方的点投影被拒绝', () => {
    const ruler = rulerFromRotation(2, { pan: 0, tilt: 0 }, 500, { x: 500, y: 350 });
    const basis = basisFromRotation({ pan: 0, tilt: 0 });
    // 默认视线沿 +Y，相机后方是 Y<0
    expect(() => projectWorldPoint([0, -100, 0], ruler, basis)).toThrow(/后方/);
  });
});
