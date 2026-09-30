import { describe, it, expect } from 'vitest';
import type { Ruler } from '../../types';
import { hpoint, infinityPoint } from './homogeneous';
import { guideSegments, horizonSegment, vpMarkers } from './guides';

const region = { x: 0, y: 0, w: 1000, h: 700 };

const ruler: Ruler = {
  kind: 3,
  axes: [hpoint(-3000, 350), hpoint(4000, 350), hpoint(500, -5000)],
  rotation: { pan: 0.6, tilt: -0.5 },
  focal: 2240,
  principal: { x: 500, y: 350 },
  horizonAxes: [0, 1],
  verticalAxis: 2,
};

describe('标尺几何 guides', () => {
  it('有限 VP 的引导线都经过该 VP（线段所在直线过 VP）', () => {
    for (const axis of [0, 1, 2] as const) {
      const vp = (ruler.axes[axis] as unknown as [number, number, number]);
      const vx = vp[0] / vp[2];
      const vy = vp[1] / vp[2];
      const segs = guideSegments(ruler, axis, region);
      expect(segs.length).toBeGreaterThan(0);
      for (const s of segs.slice(0, 4)) {
        // VP 到引导线段所在直线的距离应可忽略
        const cross =
          (s.b.x - s.a.x) * (vy - s.a.y) - (s.b.y - s.a.y) * (vx - s.a.x);
        const lineLen = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
        const vpDist = Math.hypot(vx - s.a.x, vy - s.a.y);
        // sin(夹角) < 1e-7：方向一致性，不随 VP 距离放大
        expect(Math.abs(cross) / (lineLen * vpDist)).toBeLessThan(1e-7);
      }
    }
  });

  it('无穷远 VP 的引导线彼此平行且方向正确，绝不在边缘放假 VP', () => {
    const r: Ruler = {
      ...ruler,
      axes: [infinityPoint(1, 0), infinityPoint(0, 1), hpoint(500, -3000)],
    };
    const horizontal = guideSegments(r, 0, region);
    expect(horizontal.length).toBeGreaterThan(0);
    for (const s of horizontal) {
      expect(s.a.y).toBeCloseTo(s.b.y, 9); // 水平
    }
    const vertical = guideSegments(r, 1, region);
    for (const s of vertical) {
      expect(s.a.x).toBeCloseTo(s.b.x, 9); // 竖直
    }
    const markers = vpMarkers(r, region);
    expect(markers[0].kind).toBe('infinity');
    expect(markers[1].kind).toBe('infinity');
  });

  it('VP 在画布外时标记 inside=false，在内部时 inside=true', () => {
    const markers = vpMarkers(ruler, region);
    expect(markers[0].inside).toBe(false); // (-3000,350) 画框左侧之外
    expect(markers[1].inside).toBe(false);
    expect(markers[2].inside).toBe(false); // (500,-5000) 上方之外

    const inside: Ruler = {
      ...ruler,
      axes: [hpoint(300, 300), hpoint(700, 400), hpoint(500, 100)],
    };
    expect(vpMarkers(inside, region).every((m) => m.inside)).toBe(true);
  });

  it('地平线连接两个水平 VP，被裁剪进视口区域', () => {
    const seg = horizonSegment(ruler, region)!;
    // y=350 水平线穿过整个区域
    expect(seg.a.y).toBeCloseTo(350, 9);
    expect(seg.b.y).toBeCloseTo(350, 9);
    expect(Math.min(seg.a.x, seg.b.x)).toBeCloseTo(0, 9);
    expect(Math.max(seg.a.x, seg.b.x)).toBeCloseTo(1000, 9);
  });

  it('两水平轴都在无穷远时地平线在无穷远（返回 null），不硬画', () => {
    const r: Ruler = {
      ...ruler,
      axes: [infinityPoint(1, 0), infinityPoint(0, 1), hpoint(500, -5000)],
    };
    expect(horizonSegment(r, region)).toBeNull();
  });
});
