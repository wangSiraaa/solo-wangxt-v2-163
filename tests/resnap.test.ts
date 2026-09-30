import { describe, expect, it } from 'vitest';
import type { Point2, Stroke } from '../src/types';
import { buildGuide, createPresetCamera } from '../src/geometry/perspective';
import { snapStroke } from '../src/geometry/snapping';

function stroke(raw: Point2[]): Stroke {
  return {
    id: 's',
    layerId: 'layer-art',
    tool: 'segment',
    color: '#000',
    strokeWidth: 2,
    rawPoints: raw,
    constrainedPoints: null,
    snappedAxis: null,
    createdAt: 0,
  };
}

/** 复刻 store 的 resnap-strokes 分支：从 raw 重算，绝不改 raw。 */
function resnap(s: Stroke, cam: ReturnType<typeof createPresetCamera>, W: number, H: number): Stroke {
  const guide = buildGuide(cam, W, H);
  const snap = snapStroke(s.rawPoints, s.tool, guide.axes);
  return { ...s, constrainedPoints: snap?.constrained ?? null, snappedAxis: snap?.axis ?? null };
}

describe('标尺变化后的重新吸附（原始笔画不可变）', () => {
  const W = 1200;
  const H = 800;

  it('从两点透视切到一点透视：原本汇聚的笔画可重新判为无穷远平行，raw 不变', () => {
    const two = createPresetCamera('two', W, H);
    const guide2 = buildGuide(two, W, H);
    const vpX = guide2.axes.x.vanishingPoint;
    const x = vpX[0] / vpX[2];
    const y = vpX[1] / vpX[2];
    const a: Point2 = { x: 400, y: 600 };
    const b: Point2 = { x: x + 60, y: y + 30 }; // 两点下指向 X VP
    const s2 = resnap(stroke([a, b]), two, W, H);
    expect(s2.snappedAxis).toBe('x');
    const rawBefore = JSON.stringify(s2.rawPoints);

    // 切换相机（一点透视）：X 变为无穷远水平方向；原笔画是斜线 → 不再吸附，
    // 约束被清除但原始笔画完整保留，重新切回两点又能恢复约束。
    const one = createPresetCamera('one', W, H);
    const s1 = resnap(s2, one, W, H);
    expect(s1.constrainedPoints).toBeNull();
    expect(JSON.stringify(s1.rawPoints)).toBe(rawBefore);

    const s2Again = resnap(s1, two, W, H);
    expect(s2Again.snappedAxis).toBe('x');
    expect(JSON.stringify(s2Again.rawPoints)).toBe(rawBefore);
  });

  it('开关吸附不参与几何：同一份 raw 在任意开关状态下重算结果一致', () => {
    const cam = createPresetCamera('two', W, H);
    const s = stroke([
      { x: 500, y: 200 },
      { x: 504, y: 700 },
    ]);
    // 模拟「吸附关」时显示 raw、「吸附开」时显示 constrained，两者都从同一数据读取
    const off = s.rawPoints;
    const on = resnap(s, cam, W, H);
    expect(off).toBe(s.rawPoints);
    expect(on.rawPoints).toBe(off); // 开吸附没有覆盖原始数据
    expect(on.constrainedPoints).not.toBeNull();
    expect(on.constrainedPoints![1].x).toBeCloseTo(500, 9);
  });
});
