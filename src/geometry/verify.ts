import type {
  CropRect,
  GuideAxis,
  HPoint,
  PerspectiveGuide,
  Point2,
  Stroke,
} from '../types';
import {
  cross3,
  EPSILON,
  lineThrough,
  normalizeHLine,
  toHomogeneous,
} from './homogeneous';

export interface VerificationIssue {
  strokeId: string;
  kind: 'off-vanishing-line' | 'degenerate' | 'missing-constraint';
  message: string;
}

/**
 * 几何校验（不靠肉眼）：
 * 约束后的笔画每一段都必须与「首点 × 消失点」共线。
 *
 * 齐次判据：段直线 l = cross(p_i, p_{i+1}) 必须经过 VP，
 * 即 dot(l, VP) ≈ 0。对无穷远 VP（w=0）这等价于段方向严格平行，
 * 同一条公式同时覆盖有限/无穷远两种情形 —— 这正是用齐次坐标的原因。
 */
export function verifyStroke(
  stroke: Stroke,
  guide: PerspectiveGuide,
  tol = 1e-6,
): VerificationIssue | null {
  const pts = stroke.constrainedPoints;
  if (!pts || !stroke.snappedAxis) {
    return {
      strokeId: stroke.id,
      kind: 'missing-constraint',
      message: '笔画缺少约束数据',
    };
  }
  const axis: GuideAxis | undefined = guide.axes[stroke.snappedAxis];
  if (!axis) return null;
  const vp = axis.vanishingPoint;

  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i];
    const q = pts[i + 1];
    if (Math.hypot(q.x - p.x, q.y - p.y) <= EPSILON) {
      return {
        strokeId: stroke.id,
        kind: 'degenerate',
        message: `第 ${i + 1} 段为退化零长度段`,
      };
    }
    const l = normalizeHLine(lineThrough(toHomogeneous(p), toHomogeneous(q)));
    const residual = l[0] * vp[0] + l[1] * vp[1] + l[2] * vp[2];
    // 无穷远 VP 时残差按方向模长归一（l 已归一化，vp 的 (u,v) 为单位方向）。
    const scale = Math.abs(vp[2]) > EPSILON ? Math.hypot(vp[0] / vp[2], vp[1] / vp[2], 1) : 1;
    if (Math.abs(residual) / Math.max(1, scale) > tol) {
      return {
        strokeId: stroke.id,
        kind: 'off-vanishing-line',
        message: `第 ${i + 1} 段未经过 ${axis.label} 消失点（残差 ${residual.toExponential(2)}）`,
      };
    }
  }
  return null;
}

export function verifyAllStrokes(
  strokes: Stroke[],
  guide: PerspectiveGuide,
): VerificationIssue[] {
  return strokes
    .filter((s) => s.constrainedPoints && s.snappedAxis)
    .map((s) => verifyStroke(s, guide))
    .filter((i): i is VerificationIssue => i !== null);
}

/**
 * 校验地平线：两个水平消失点都必须落在地平线上（齐次点积为 0）。
 * 一点透视中 X 消失点在无穷远，同一公式仍然成立。
 */
export function verifyHorizon(guide: PerspectiveGuide, tol = 1e-9): boolean {
  const h = guide.horizon;
  const on = (vp: HPoint) =>
    Math.abs(h[0] * vp[0] + h[1] * vp[1] + h[2] * vp[2]) <= tol;
  return on(guide.axes.x.vanishingPoint) && on(guide.axes.z.vanishingPoint);
}

/**
 * 检测输入点是否退化共线/重合（标尺建立时的健壮性检查）。
 * 返回共线点下标集合之外的异常信息；完全重合返回 'coincident'。
 */
export function detectCollinearDegeneracy(points: Point2[]):
  | { ok: true }
  | { ok: false; reason: 'too-few' | 'coincident' } {
  if (points.length < 2) return { ok: false, reason: 'too-few' };
  const a = points[0];
  const b = points.find((p) => Math.hypot(p.x - a.x, p.y - a.y) > EPSILON);
  if (!b) return { ok: false, reason: 'coincident' };
  return { ok: true };
}

/**
 * 计算导出范围（文档坐标）。
 *
 * - 画稿导出：有裁剪框用裁剪框，否则用整幅文档；裁剪与相机参数完全无关。
 * - 标尺导出：可选把远在画布外的有限消失点纳入范围（加边距），
 *   无穷远消失点不产生边界（按方向处理，不造一个大坐标点）。
 */
export interface ExportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function artworkExportBounds(
  width: number,
  height: number,
  crop: CropRect | null,
): ExportBounds {
  if (crop) return { ...crop };
  return { x: 0, y: 0, width, height };
}

export function rulerExportBounds(
  docWidth: number,
  docHeight: number,
  guide: PerspectiveGuide,
  margin = 80,
): ExportBounds {
  let minX = 0;
  let minY = 0;
  let maxX = docWidth;
  let maxY = docHeight;
  for (const axis of Object.values(guide.axes)) {
    if (axis.isInfinite) continue; // 无穷远：不参与边界计算
    const vp = axis.vanishingPoint;
    const x = vp[0] / vp[2];
    const y = vp[1] / vp[2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    x: minX - margin,
    y: minY - margin,
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
  };
}

/** 两点所在直线（齐次）；供 UI/导出层复用。 */
export function segmentLine(p: Point2, q: Point2) {
  return normalizeHLine(cross3(toHomogeneous(p), toHomogeneous(q)));
}
