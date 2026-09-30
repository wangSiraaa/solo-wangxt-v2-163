import { describe, expect, it } from 'vitest';
import type { Project, Stroke } from '../src/types';
import { createProject } from '../src/storage/project';
import { deleteDatabase, getProject, putProject } from '../src/storage/db';
import { artworkExportBounds, rulerExportBounds, verifyAllStrokes } from '../src/geometry/verify';
import { buildGuide, createPresetCamera } from '../src/geometry/perspective';

function fakeStroke(overrides: Partial<Stroke> = {}): Stroke {
  return {
    id: Math.random().toString(36).slice(2),
    layerId: 'layer-art',
    tool: 'segment',
    color: '#000',
    strokeWidth: 2,
    rawPoints: [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
    ],
    constrainedPoints: null,
    snappedAxis: null,
    createdAt: 0,
    ...overrides,
  };
}

describe('IndexedDB 往返（无后端）', () => {
  it('工程（含双版本笔画）可存取', async () => {
    await deleteDatabase();
    const project = createProject('往返测试');
    project.strokes.push(
      fakeStroke({
        rawPoints: [
          { x: 1, y: 2 },
          { x: 3, y: 4 },
        ],
        constrainedPoints: [
          { x: 1, y: 2 },
          { x: 3, y: 3 },
        ],
        snappedAxis: 'y',
      }),
    );
    await putProject(project);
    const loaded = await getProject<Project>(project.id);
    expect(loaded).toBeDefined();
    expect(loaded!.name).toBe('往返测试');
    expect(loaded!.strokes).toHaveLength(1);
    // 关键：原始与约束版本都持久化，关闭吸附不丢数据
    expect(loaded!.strokes[0].rawPoints[1]).toEqual({ x: 3, y: 4 });
    expect(loaded!.strokes[0].constrainedPoints![1]).toEqual({ x: 3, y: 3 });
    expect(loaded!.strokes[0].snappedAxis).toBe('y');
  });
});

describe('相机 / 视图 / 裁剪解耦', () => {
  it('改相机不改变裁剪框与笔画数据', () => {
    const project = createProject();
    project.crop = { x: 100, y: 100, width: 400, height: 300 };
    project.strokes.push(fakeStroke());
    const strokesBefore = JSON.stringify(project.strokes);

    const guideBefore = buildGuide(project.camera, project.width, project.height);
    // 模拟相机面板：极端俯视 + 三点透视
    const camAfter = {
      ...createPresetCamera('three', project.width, project.height),
      pitch: (70 * Math.PI) / 180,
      principalX: project.camera.principalX,
      principalY: project.camera.principalY,
    };
    const guideAfter = buildGuide(camAfter, project.width, project.height);

    expect(project.crop).toEqual({ x: 100, y: 100, width: 400, height: 300 });
    expect(JSON.stringify(project.strokes)).toBe(strokesBefore);
    // 标尺几何确实变了
    expect(guideAfter.axes.y.vanishingPoint[2]).not.toBeCloseTo(
      guideBefore.axes.y.vanishingPoint[2],
      3,
    );
  });

  it('画稿导出范围只取裁剪框，与相机无关', () => {
    const p = createProject();
    p.crop = { x: 50, y: 60, width: 200, height: 120 };
    const b = artworkExportBounds(p.width, p.height, p.crop);
    expect(b).toEqual({ x: 50, y: 60, width: 200, height: 120 });
    // 极端相机下结果不变
    const cam = createPresetCamera('three', p.width, p.height);
    void cam;
    expect(artworkExportBounds(p.width, p.height, p.crop)).toEqual(b);
  });

  it('标尺导出范围包含画外有限消失点，但不包含无穷远方向', () => {
    const guide = buildGuide(createPresetCamera('two', 1200, 800), 1200, 800);
    const bounds = rulerExportBounds(1200, 800, guide, 0);
    // X VP 在画外左侧（yaw=35°）
    expect(bounds.x).toBeLessThan(0);
    // 无穷远 Y 轴不会把范围拉向 Infinity
    expect(Number.isFinite(bounds.width)).toBe(true);
    expect(Number.isFinite(bounds.height)).toBe(true);
  });

  it('一点透视下标尺范围仍为有限矩形（X、Y 均无穷远，只有 Z 有限）', () => {
    const guide = buildGuide(createPresetCamera('one', 1200, 800), 1200, 800);
    const bounds = rulerExportBounds(1200, 800, guide, 0);
    expect(Number.isFinite(bounds.width)).toBe(true);
    expect(bounds.width).toBe(1200);
    expect(bounds.height).toBe(800);
  });
});

describe('关闭吸附不丢笔画（数据层）', () => {
  it('快照开关只是显示选择：无开关参与的校验函数仍可对约束版本工作', () => {
    const guide = buildGuide(createPresetCamera('two', 1200, 800), 1200, 800);
    const s = fakeStroke({
      rawPoints: [
        { x: 300, y: 500 },
        { x: 310, y: 100 },
      ],
      constrainedPoints: [
        { x: 300, y: 500 },
        { x: 300, y: 100 },
      ],
      snappedAxis: 'y',
    });
    // 模拟关闭吸附后再打开：两个版本都还在
    const displayWhenOff = s.rawPoints;
    const displayWhenOn = s.constrainedPoints!;
    expect(displayWhenOff[1].x).toBe(310);
    expect(displayWhenOn[1].x).toBe(300);
    expect(verifyAllStrokes([s], guide)).toHaveLength(0);
  });
});
