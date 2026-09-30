import { describe, it, expect } from 'vitest';
import {
  fitCamera,
  panBy,
  screenToWorld,
  worldToScreen,
  zoomAt,
  normalizeCrop,
  strokeIntersectsCrop,
} from './viewport';

describe('视口相机与裁切分离', () => {
  it('screen/world 互逆', () => {
    const cam = { scale: 1.5, offsetX: 12, offsetY: -34 };
    const w = { x: 200, y: 300 };
    expect(screenToWorld(cam, worldToScreen(cam, w))).toMatchObject({
      x: expect.closeTo(200, 9),
      y: expect.closeTo(300, 9),
    });
  });

  it('zoomAt 以锚点为不动点', () => {
    const cam = { scale: 1, offsetX: 0, offsetY: 0 };
    const anchor = { x: 250, y: 180 };
    const next = zoomAt(cam, anchor, 2);
    expect(worldToScreen(next, screenToWorld(cam, anchor))).toMatchObject({
      x: expect.closeTo(250, 9),
      y: expect.closeTo(180, 9),
    });
  });

  it('平移与缩放只改相机：屏幕原点始终反算回文档原点', () => {
    const cam = { scale: 1, offsetX: 0, offsetY: 0 };
    const zoomed = zoomAt(cam, { x: 0, y: 0 }, 0.5);
    const next = panBy(zoomed, 40, 60);
    expect(screenToWorld(next, { x: next.offsetX, y: next.offsetY })).toMatchObject({
      x: expect.closeTo(0, 9),
      y: expect.closeTo(0, 9),
    });
  });

  it('fitCamera 留出画布外 VP 的边距且完整包含画板', () => {
    const cam = fitCamera(
      { scale: 1, offsetX: 0, offsetY: 0 },
      { width: 1000, height: 700 },
      { width: 1600, height: 900 },
    );
    const tl = worldToScreen(cam, { x: 0, y: 0 });
    const br = worldToScreen(cam, { x: 1000, y: 700 });
    expect(tl.x).toBeGreaterThanOrEqual(0);
    expect(tl.y).toBeGreaterThanOrEqual(0);
    expect(br.x).toBeLessThanOrEqual(1600);
    expect(br.y).toBeLessThanOrEqual(900);
  });
});

describe('裁切', () => {
  it('normalizeCrop 处理反向拖拽', () => {
    expect(normalizeCrop(100, 100, -40, -30)).toEqual({
      x: 60,
      y: 70,
      w: 40,
      h: 30,
    });
  });

  it('笔画穿越裁切边界判定为相交', () => {
    const crop = { x: 0, y: 0, w: 100, h: 100 };
    expect(strokeIntersectsCrop([{ x: -50, y: 50 }, { x: 150, y: 50 }], crop)).toBe(true);
    expect(strokeIntersectsCrop([{ x: -50, y: -50 }, { x: -10, y: -10 }], crop)).toBe(false);
  });
});
