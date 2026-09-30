import type { AxisId, Point2, Ruler } from '../../types';
import {
  clipRayToRect,
  finite,
  linePointSide,
  toDirection,
  toEuclidean,
  type Rect,
  type Segment2,
} from './homogeneous';
import { horizonLine } from '../perspective/rulers';

/**
 * 标尺可视化的纯几何（Konva 叠加层与 PNG 导出共用，
 * 保证"屏幕上看到的"与"导出的几何"一致）。
 */

/** 某轴在给定矩形内的引导线段集合（已去重）。 */
export function guideSegments(ruler: Ruler, axis: AxisId, region: Rect): Segment2[] {
  const vp = ruler.axes[axis];
  const N = 9;
  const anchors: Point2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    anchors.push({ x: region.x + region.w * t, y: region.y });
    anchors.push({ x: region.x + region.w * t, y: region.y + region.h });
    anchors.push({ x: region.x, y: region.y + region.h * t });
    anchors.push({ x: region.x + region.w, y: region.y + region.h * t });
  }
  const out: Segment2[] = [];
  const seen = new Set<string>();
  for (const p of anchors) {
    const seg = clipRayToRect(p, vp, region);
    if (!seg) continue;
    // 射线擦过角点时裁剪结果退化为零长点，丢弃（退化共线输入处理）
    if (Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) < 1e-9) continue;
    const key = `${Math.round(seg.a.x)},${Math.round(seg.a.y)}|${Math.round(seg.b.x)},${Math.round(seg.b.y)}`;
    const rev = `${Math.round(seg.b.x)},${Math.round(seg.b.y)}|${Math.round(seg.a.x)},${Math.round(seg.a.y)}`;
    if (seen.has(key) || seen.has(rev)) continue;
    seen.add(key);
    out.push(seg);
  }
  return out;
}

/** 地平线在区域内的裁剪线段；地平线在无穷远或完全在区域外时返回 null。 */
export function horizonSegment(ruler: Ruler, region: Rect): Segment2 | null {
  const l = horizonLine(ruler);
  if (!l) return null;
  const corners: Point2[] = [
    { x: region.x, y: region.y },
    { x: region.x + region.w, y: region.y },
    { x: region.x + region.w, y: region.y + region.h },
    { x: region.x, y: region.y + region.h },
  ];
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const s = linePointSide(l, c);
    min = Math.min(min, s);
    max = Math.max(max, s);
  }
  if (min * max > 0) return null;

  const hits: Point2[] = [];
  const eps = 1e-9;
  const edges: [Point2, Point2][] = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]],
  ];
  for (const [a, b] of edges) {
    const sa = linePointSide(l, a);
    const sb = linePointSide(l, b);
    if (Math.abs(sa) < eps) hits.push(a);
    if (sa * sb < 0) {
      const t = sa / (sa - sb);
      hits.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  if (hits.length < 2) return null;
  // 取相距最远的两个交点
  let best: Segment2 = { a: hits[0], b: hits[1] };
  let bestD = 0;
  for (let i = 0; i < hits.length; i++) {
    for (let j = i + 1; j < hits.length; j++) {
      const d = (hits[i].x - hits[j].x) ** 2 + (hits[i].y - hits[j].y) ** 2;
      if (d > bestD) {
        bestD = d;
        best = { a: hits[i], b: hits[j] };
      }
    }
  }
  return best;
}

export interface VpMarker {
  axis: AxisId;
  kind: 'finite' | 'infinity';
  point: Point2;
  /** 无穷远时的单位方向。 */
  direction?: Point2;
  /** 有限 VP 是否在给定区域内（在区外时 UI 要画指向箭头，而不是截到边上）。 */
  inside: boolean;
}

export function vpMarkers(ruler: Ruler, region: Rect): VpMarker[] {
  const out: VpMarker[] = [];
  // 三个轴始终都展示：一点/两点透视中未收敛的轴以无穷远方向箭头呈现。
  for (let a = 0 as AxisId; a < 3; a = (a + 1) as AxisId) {
    const vp = ruler.axes[a];
    if (!finite(vp)) {
      out.push({
        axis: a,
        kind: 'infinity',
        point: { x: region.x + region.w / 2, y: region.y + region.h / 2 },
        direction: toDirection(vp),
        inside: true,
      });
    } else {
      const v = toEuclidean(vp);
      out.push({
        axis: a,
        kind: 'finite',
        point: v,
        inside:
          v.x >= region.x &&
          v.x <= region.x + region.w &&
          v.y >= region.y &&
          v.y <= region.y + region.h,
      });
    }
  }
  return out;
}
