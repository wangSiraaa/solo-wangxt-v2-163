import type { Camera, CropRect, Point2 } from '../types';

/**
 * 视口相机：文档坐标 <-> 屏幕坐标的仿射变换。
 * 这是"观察方式"，不改变任何文档数据，也与文档裁切（crop）完全无关：
 * 平移/缩放视口不会移动笔画或消失点，裁切矩形也不会随缩放变化。
 */

export const IDENTITY_CAMERA: Camera = { scale: 1, offsetX: 0, offsetY: 0 };

export function screenToWorld(cam: Camera, p: Point2): Point2 {
  return { x: (p.x - cam.offsetX) / cam.scale, y: (p.y - cam.offsetY) / cam.scale };
}

export function worldToScreen(cam: Camera, p: Point2): Point2 {
  return { x: p.x * cam.scale + cam.offsetX, y: p.y * cam.scale + cam.offsetY };
}

/** 以屏幕点 anchor 为不动点缩放（滚轮缩放）。 */
export function zoomAt(cam: Camera, anchor: Point2, factor: number): Camera {
  const scale = cam.scale * factor;
  return {
    scale,
    offsetX: anchor.x - (anchor.x - cam.offsetX) * factor,
    offsetY: anchor.y - (anchor.y - cam.offsetY) * factor,
  };
}

export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...cam, offsetX: cam.offsetX + dxScreen, offsetY: cam.offsetY + dyScreen };
}

export function fitCamera(
  _cam: Camera,
  doc: { width: number; height: number },
  view: { width: number; height: number },
  margin = 320,
): Camera {
  // margin 留出画布外消失点的显示空间（VP 可以在画布外很远）。
  const scale = Math.min(
    (view.width - margin) / doc.width,
    (view.height - margin) / doc.height,
  );
  return {
    scale,
    offsetX: (view.width - doc.width * scale) / 2,
    offsetY: (view.height - doc.height * scale) / 2,
  };
}

/**
 * 文档裁切：只影响导出区域，不影响相机与几何。
 */

export function normalizeCrop(x: number, y: number, w: number, h: number): CropRect {
  return {
    x: Math.min(x, x + w),
    y: Math.min(y, y + h),
    w: Math.abs(w),
    h: Math.abs(h),
  };
}

export function pointInCrop(p: Point2, crop: CropRect): boolean {
  return (
    p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h
  );
}

/** 笔画是否与裁切矩形有交（raw 任一端点在内，或任一线段穿越）。 */
export function strokeIntersectsCrop(
  pts: Point2[],
  crop: CropRect,
): boolean {
  if (pts.some((p) => pointInCrop(p, crop))) return true;
  const edges: [Point2, Point2][] = [
    [{ x: crop.x, y: crop.y }, { x: crop.x + crop.w, y: crop.y }],
    [
      { x: crop.x + crop.w, y: crop.y },
      { x: crop.x + crop.w, y: crop.y + crop.h },
    ],
    [
      { x: crop.x + crop.w, y: crop.y + crop.h },
      { x: crop.x, y: crop.y + crop.h },
    ],
    [
      { x: crop.x, y: crop.y + crop.h },
      { x: crop.x, y: crop.y },
    ],
  ];
  for (let i = 0; i < pts.length - 1; i++) {
    if (edges.some((e) => segmentsIntersect(pts[i], pts[i + 1], e[0], e[1]))) {
      return true;
    }
  }
  return false;
}

function cross2(a: Point2, b: Point2): number {
  return a.x * b.y - a.y * b.x;
}
function sub(a: Point2, b: Point2): Point2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function segmentsIntersect(p1: Point2, p2: Point2, p3: Point2, p4: Point2): boolean {
  const d1 = cross2(sub(p3, p1), sub(p4, p1));
  const d2 = cross2(sub(p3, p2), sub(p4, p2));
  const d3 = cross2(sub(p1, p3), sub(p2, p3));
  const d4 = cross2(sub(p1, p4), sub(p2, p4));
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
