import { describe, it, expect } from 'vitest';
import { reducer, initialProject, type State } from './store';
import { constrainStroke } from '../lib/geometry/snap';
import { RULER_PRESETS } from '../lib/perspective/rulers';
import type { Point2 } from '../types';

function stateWithRuler(presetId: string): State {
  const p = initialProject();
  const preset = RULER_PRESETS.find((x) => x.id === presetId)!;
  return {
    project: { ...p, ruler: preset.build(p.width, p.height) },
    tool: 'pen',
    toleranceDeg: 12,
    color: '#000',
    width: 3,
    saveState: 'idle',
  };
}

function draw(state: State, pts: Point2[]): State {
  let s = reducer(state, { type: 'beginStroke', id: 's1', point: pts[0] });
  for (let i = 1; i < pts.length; i++) {
    s = reducer(s, { type: 'extendStroke', point: pts[i] });
  }
  return reducer(s, { type: 'endStroke' });
}

describe('状态层：原始与约束双版本', () => {
  it('绘制后 raw 与逐段 axes 同时保存，可派生出约束点', () => {
    const ruler = stateWithRuler('two-point-normal').project.ruler;
    // 沿指向水平 VP 的方向画一条明显的透视线
    const vp = (ruler.axes[1] as unknown as [number, number, number]);
    const vx = vp[0] / vp[2];
    const vy = vp[1] / vp[2];
    const p0 = { x: 300, y: 700 };
    const t = 0.05;
    const p1 = { x: p0.x + (vx - p0.x) * t, y: p0.y + (vy - p0.y) * t };
    const p2 = { x: p0.x + (vx - p0.x) * (t * 2), y: p0.y + (vy - p0.y) * (t * 2) };

    const s = draw(stateWithRuler('two-point-normal'), [p0, p1, p2]);
    const stroke = s.project.strokes[0];
    expect(stroke.raw).toHaveLength(3);
    expect(stroke.axes).toHaveLength(2);
    expect(stroke.axes.every((a) => a === 1)).toBe(true);

    const constrained = constrainStroke(stroke.raw, stroke.axes, ruler);
    expect(constrained).toHaveLength(3);
  });

  it('关闭吸附不删除任何笔画；重新打开仍可派生约束', () => {
    let s = draw(stateWithRuler('one-point-normal'), [
      { x: 300, y: 600 },
      { x: 420, y: 480 },
      { x: 520, y: 400 },
    ]);
    const before = JSON.stringify(s.project.strokes);
    s = reducer(s, { type: 'toggleSnap', enabled: false });
    expect(JSON.stringify(s.project.strokes)).toBe(before);
    s = reducer(s, { type: 'toggleSnap', enabled: true });
    expect(JSON.stringify(s.project.strokes)).toBe(before);
  });

  it('裁切与相机互不影响', () => {
    let s = stateWithRuler('one-point-high');
    const cam0 = s.project.camera;
    s = reducer(s, {
      type: 'setCrop',
      crop: { x: 100, y: 100, w: 400, h: 300 },
    });
    expect(s.project.camera).toBe(cam0);
    const crop0 = s.project.crop;
    s = reducer(s, {
      type: 'setCamera',
      camera: { scale: 2.2, offsetX: 50, offsetY: -80 },
    });
    expect(s.project.crop).toBe(crop0);
    expect(s.project.strokes).toEqual([]); // 几何数据不受观察变化影响
  });

  it('高位地平线预设下仍可正常分类（VP 在画面 92% 处）', () => {
    const s0 = stateWithRuler('one-point-high');
    const { ruler } = s0.project;
    const vp = ruler.axes[1] as unknown as [number, number, number];
    const vx = vp[0] / vp[2];
    const vy = vp[1] / vp[2];
    const p0 = { x: 200, y: 100 };
    const p1 = {
      x: p0.x + (vx - p0.x) * 0.03,
      y: p0.y + (vy - p0.y) * 0.03,
    };
    const s = draw(s0, [p0, p1]);
    expect(s.project.strokes[0].axes[0]).toBe(1);
  });

  it('极端三点预设下绘制不崩溃，axes 长度正确', () => {
    const s = draw(stateWithRuler('three-point-worm'), [
      { x: 100, y: 100 },
      { x: 300, y: 200 },
      { x: 500, y: 260 },
      { x: 700, y: 300 },
    ]);
    const stroke = s.project.strokes[0];
    expect(stroke.axes).toHaveLength(3);
    expect(stroke.raw).toHaveLength(4);
  });
});
