import { AXIS_COLORS, type Project, type Ruler, type Stroke, type Point2 } from '../../types';
import { constrainStroke } from '../geometry/snap';
import {
  clipRayToRect,
  finite,
  linePointSide,
  toDirection,
  toEuclidean,
  type Rect,
} from '../geometry/homogeneous';
import { horizonLine } from '../perspective/rulers';

/**
 * 分层导出。
 * - artwork 层：只含笔画（raw 或 constrained 由选项决定）；
 * - ruler 层：只含消失点、地平线与方向引导线；
 * - merged：两层叠加。
 * "视觉上交到一起"之外还提供独立的两层，几何检验（VP、方向）可只看 ruler 层。
 *
 * 裁切只改变导出区域（平移上下文 + clip），不触碰任何文档数据。
 */

export interface ExportOptions {
  /** 导出约束后的笔画还是原始笔画。 */
  version: 'constrained' | 'raw';
  /** 是否按裁切矩形导出；否则导出整个画板。 */
  useCrop: boolean;
  /** 按轴着色约束段（画稿层也可用于检验）。 */
  colorByAxis?: boolean;
  /** 画稿背景（默认透明）。 */
  background?: string | null;
  /** 设备像素比（导出位图缩放）。 */
  pixelRatio?: number;
}

export interface ExportResult {
  size: { width: number; height: number };
  artwork: HTMLCanvasElement;
  ruler: HTMLCanvasElement;
  merged: HTMLCanvasElement;
}

function exportRegion(project: Project, useCrop: boolean): Rect {
  if (useCrop && project.crop) return { ...project.crop };
  return { x: 0, y: 0, w: project.width, h: project.height };
}

function makeCanvas(region: Rect, ratio: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(region.w * ratio);
  c.height = Math.round(region.h * ratio);
  return c;
}

function beginRegion(ctx: CanvasRenderingContext2D, region: Rect, ratio: number) {
  ctx.scale(ratio, ratio);
  ctx.translate(-region.x, -region.y);
}

function drawPolyline(ctx: CanvasRenderingContext2D, pts: Point2[]) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function drawStrokeArtwork(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  ruler: Ruler,
  opts: ExportOptions,
) {
  const pts =
    opts.version === 'raw' ? stroke.raw : constrainStroke(stroke.raw, stroke.axes, ruler);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width;

  if (opts.colorByAxis && opts.version === 'constrained') {
    // 逐段着色：能直接检验每一段是否被约束到正确消失点方向。
    for (let i = 0; i < pts.length - 1; i++) {
      const axis = stroke.axes[i];
      ctx.strokeStyle = axis === null ? '#888888' : AXIS_COLORS[axis];
      ctx.beginPath();
      ctx.moveTo(pts[i].x, pts[i].y);
      ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = stroke.color;
    drawPolyline(ctx, pts);
  }
}

/** 引导线：对每个启用的轴画穿过画板的收敛/平行直线族。 */
function drawGuidesForAxis(
  ctx: CanvasRenderingContext2D,
  ruler: Ruler,
  axis: 0 | 1 | 2,
  region: Rect,
  color: string,
) {
  const vp = ruler.axes[axis];
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.28;
  ctx.lineWidth = 1;

  // 沿区域边界均匀取锚点，从锚点向 VP（或无穷远方向）拉直线。
  const N = 9;
  const anchors: Point2[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    anchors.push({ x: region.x + region.w * t, y: region.y });
    anchors.push({ x: region.x + region.w * t, y: region.y + region.h });
    anchors.push({ x: region.x, y: region.y + region.h * t });
    anchors.push({ x: region.x + region.w, y: region.y + region.h * t });
  }

  const drawn = new Set<string>();
  for (const p of anchors) {
    const seg = clipRayToRect(p, vp, region);
    if (!seg) continue;
    if (Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y) < 1e-9) continue;
    const key = `${Math.round(seg.a.x)},${Math.round(seg.a.y)}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.lineTo(seg.b.x, seg.b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawVanishingMarker(
  ctx: CanvasRenderingContext2D,
  ruler: Ruler,
  axis: 0 | 1 | 2,
  region: Rect,
  color: string,
) {
  const vp = ruler.axes[axis];
  if (!finite(vp)) {
    // 无穷远 VP：在边界中点画方向箭头（明确表示"平行方向"，不是边缘上的假 VP）。
    const d = toDirection(vp);
    const cx = region.x + region.w / 2;
    const cy = region.y + region.h / 2;
    const r = Math.min(region.w, region.h) * 0.18;
    const tip: Point2 = { x: cx + d.x * r, y: cy + d.y * r };
    const tail: Point2 = { x: cx - d.x * r, y: cy - d.y * r };
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tail.x, tail.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    drawArrowHead(ctx, tip, d, 8);
    return;
  }
  const v = toEuclidean(vp);
  const inside =
    v.x >= region.x - 2 &&
    v.x <= region.x + region.w + 2 &&
    v.y >= region.y - 2 &&
    v.y <= region.y + region.h + 2;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.5;
  const r = 7;
  if (inside) {
    ctx.beginPath();
    ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(v.x - r - 4, v.y);
    ctx.lineTo(v.x + r + 4, v.y);
    ctx.moveTo(v.x, v.y - r - 4);
    ctx.lineTo(v.x, v.y + r + 4);
    ctx.stroke();
    ctx.font = '12px sans-serif';
    ctx.fillText(`VP${axis + 1}`, v.x + r + 6, v.y - r - 2);
  }
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tip: Point2,
  dir: Point2,
  size: number,
) {
  const a = Math.atan2(dir.y, dir.x);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(a - Math.PI / 6), tip.y - size * Math.sin(a - Math.PI / 6));
  ctx.lineTo(tip.x - size * Math.cos(a + Math.PI / 6), tip.y - size * Math.sin(a + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawHorizon(ctx: CanvasRenderingContext2D, ruler: Ruler, region: Rect) {
  const l = horizonLine(ruler);
  if (!l) return; // 正交情形：地平线也在无穷远
  const corners = [
    { x: region.x, y: region.y },
    { x: region.x + region.w, y: region.y },
    { x: region.x + region.w, y: region.y + region.h },
    { x: region.x, y: region.y + region.h },
  ];
  // 地平线直线裁剪进区域
  let min = Infinity;
  let max = -Infinity;
  for (const c of corners) {
    const s = linePointSide(l, c);
    min = Math.min(min, s);
    max = Math.max(max, s);
  }
  if (min * max > 0) return; // 整条地平线在区域外
  ctx.save();
  ctx.strokeStyle = '#222222';
  ctx.setLineDash([10, 6]);
  ctx.lineWidth = 1.5;
  // 用区域内两侧点连成线：求直线与区域边界的交
  const eps = 1e-9;
  const hits: Point2[] = [];
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
  if (hits.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(hits[0].x, hits[0].y);
    ctx.lineTo(hits[1].x, hits[1].y);
    ctx.stroke();
  }
  ctx.restore();
}

export function exportLayers(project: Project, options: ExportOptions): ExportResult {
  const ratio = options.pixelRatio ?? 1;
  const region = exportRegion(project, options.useCrop);
  const artwork = makeCanvas(region, ratio);
  const rulerCanvas = makeCanvas(region, ratio);
  const merged = makeCanvas(region, ratio);

  // artowrk 层
  {
    const ctx = artwork.getContext('2d')!;
    beginRegion(ctx, region, ratio);
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(region.x, region.y, region.w, region.h);
    }
    for (const s of project.strokes) {
      drawStrokeArtwork(ctx, s, project.ruler, options);
    }
  }

  // ruler 层
  {
    const ctx = rulerCanvas.getContext('2d')!;
    beginRegion(ctx, region, ratio);
    for (let a = 0 as 0 | 1 | 2; a < 3; a = (a + 1) as 0 | 1 | 2) {
      drawGuidesForAxis(ctx, project.ruler, a, region, AXIS_COLORS[a]);
    }
    drawHorizon(ctx, project.ruler, region);
    for (let a = 0 as 0 | 1 | 2; a < 3; a = (a + 1) as 0 | 1 | 2) {
      drawVanishingMarker(ctx, project.ruler, a, region, AXIS_COLORS[a]);
    }
  }

  {
    const ctx = merged.getContext('2d')!;
    if (options.background) {
      ctx.fillStyle = options.background;
      ctx.fillRect(0, 0, merged.width, merged.height);
    }
    // 两个源 canvas 尺寸一致（region * ratio），整幅叠加即可。
    ctx.drawImage(artwork, 0, 0);
    ctx.drawImage(rulerCanvas, 0, 0);
  }

  return {
    size: { width: region.w, height: region.h },
    artwork,
    ruler: rulerCanvas,
    merged,
  };
}

export function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}
