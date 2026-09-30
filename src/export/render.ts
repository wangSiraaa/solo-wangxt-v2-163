import type {
  HPoint,
  Layer,
  PerspectiveGuide,
  Point2,
  Stroke,
} from '../types';
import {
  clipSegmentToRect,
  fromHomogeneous,
  lineThrough,
  normalizeHLine,
  toHomogeneous,
} from '../geometry/homogeneous';
import type { ExportBounds } from '../geometry/verify';
import { artworkExportBounds, rulerExportBounds } from '../geometry/verify';

export type ExportLayerKind = 'artwork' | 'ruler';

export interface ExportOptions {
  includeBackground: boolean;
  /** 标尺导出时是否标注消失点（无穷远画方向箭头而非假点）。 */
  annotateVanishingPoints: boolean;
}

interface Canvas2D {
  ctx: CanvasRenderingContext2D;
  canvas: HTMLCanvasElement;
}

function makeCanvas(width: number, height: number): Canvas2D {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D 画布');
  return { ctx, canvas };
}

/** 在 ctx 上建立「文档坐标 → 像素」平移（bounds 左上角为原点）。 */
function beginLayer(
  c: Canvas2D,
  bounds: ExportBounds,
  bg: string | null,
): CanvasRenderingContext2D {
  const { ctx } = c;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.canvas.width, c.canvas.height);
  }
  ctx.translate(-bounds.x, -bounds.y);
  return ctx;
}

/** 画一条笔画：画稿导出用 constrained（吸附开）或 raw（吸附关），数据两者都在。 */
function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, useConstrained: boolean): void {
  const pts = useConstrained && stroke.constrainedPoints ? stroke.constrainedPoints : stroke.rawPoints;
  if (pts.length < 1) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (stroke.tool === 'segment' && pts.length >= 2) {
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  } else {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * 过消失点（有限或无穷远）与种子点的直线，裁剪到 bounds 后描边。
 * 直线在 bounds 的「局部坐标」内求交点，上下文已平移，直接画局部坐标。
 */
function traceLineThrough(
  ctx: CanvasRenderingContext2D,
  vp: HPoint,
  seed: Point2,
  bounds: ExportBounds,
): void {
  const line = normalizeHLine(lineThrough(vp, toHomogeneous(seed)));
  const [a, b, c] = line;
  if (Math.hypot(a, b) < 1e-12) return;

  // 垂足 p0 与方向 dir（文档坐标），转局部坐标后裁剪。
  const p0Doc: Point2 = { x: -a * c, y: -b * c };
  const dir: Point2 = { x: -b, y: a };
  const p0: Point2 = { x: p0Doc.x - bounds.x, y: p0Doc.y - bounds.y };
  const span =
    Math.hypot(bounds.width, bounds.height) +
    Math.hypot(p0.x, p0.y) +
    Math.hypot(p0.x - bounds.width, p0.y - bounds.height);
  const far: Point2 = { x: p0.x + dir.x * span, y: p0.y + dir.y * span };
  const near: Point2 = { x: p0.x - dir.x * span, y: p0.y - dir.y * span };
  const chord = clipSegmentToRect(near, far, bounds.width, bounds.height);
  if (!chord) return;
  ctx.moveTo(chord[0].x + bounds.x, chord[0].y + bounds.y);
  ctx.lineTo(chord[1].x + bounds.x, chord[1].y + bounds.y);
}

function drawRuler(
  ctx: CanvasRenderingContext2D,
  guide: PerspectiveGuide,
  bounds: ExportBounds,
  options: ExportOptions,
): void {
  const axes = Object.values(guide.axes);
  const seeds: Point2[] = [];
  const per = 10;
  for (let i = 0; i <= per; i++) {
    const t = i / per;
    seeds.push({ x: guide.width * t, y: 0 });
    seeds.push({ x: guide.width * t, y: guide.height });
    seeds.push({ x: 0, y: guide.height * t });
    seeds.push({ x: guide.width, y: guide.height * t });
  }

  for (const axis of axes) {
    ctx.strokeStyle = axis.color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const seed of seeds) traceLineThrough(ctx, axis.vanishingPoint, seed, bounds);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 地平线（齐次直线，俯仰+滚转时为斜线，不假设水平）
  const [a, b, c] = normalizeHLine(guide.horizon);
  if (Math.hypot(a, b) > 1e-12) {
    const p0Doc = { x: -a * c - bounds.x, y: -b * c - bounds.y };
    const dir = { x: -b, y: a };
    const span = Math.hypot(bounds.width, bounds.height) * 2 + Math.hypot(p0Doc.x, p0Doc.y);
    ctx.strokeStyle = '#8e8e93';
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(p0Doc.x - dir.x * span + bounds.x, p0Doc.y - dir.y * span + bounds.y);
    ctx.lineTo(p0Doc.x + dir.x * span + bounds.x, p0Doc.y + dir.y * span + bounds.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (options.annotateVanishingPoints) {
    for (const axis of axes) {
      const p = fromHomogeneous(axis.vanishingPoint);
      ctx.fillStyle = axis.color;
      ctx.font = '13px sans-serif';
      if (p) {
        // 有限点（可在画布外；ruler bounds 已包含它，绝不在此截断）。
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(`${axis.label} (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`, p.x + 8, p.y - 8);
      } else {
        // 无穷远消失点：不造假点；在画面中心画方向箭头并标注 ∞。
        const [u, v] = axis.vanishingPoint;
        const cx = guide.width / 2;
        const cy = guide.height / 2;
        const r = 26;
        const ex = cx + u * r;
        const ey = cy + v * r;
        ctx.save();
        ctx.strokeStyle = axis.color;
        ctx.fillStyle = axis.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - u * 8, cy - v * 8);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(ex, ey, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(`${axis.label} ∞`, ex + u * 12 - 4, ey + v * 12 - 4);
        ctx.restore();
      }
    }
  }
}

export interface RenderedLayer {
  kind: ExportLayerKind;
  bounds: ExportBounds;
  canvas: HTMLCanvasElement;
}

/** 画稿层：仅画稿图层上的笔画；导出范围只取决于裁剪框/文档，与相机无关。 */
export function renderArtworkLayer(args: {
  strokes: Stroke[];
  layers: Layer[];
  docWidth: number;
  docHeight: number;
  crop: { x: number; y: number; width: number; height: number } | null;
  useConstrained: boolean;
  options: ExportOptions;
}): RenderedLayer {
  const bounds = artworkExportBounds(args.docWidth, args.docHeight, args.crop);
  const c = makeCanvas(bounds.width, bounds.height);
  const ctx = beginLayer(c, bounds, args.options.includeBackground ? '#ffffff' : null);

  const visibleArt = new Set(
    args.layers.filter((l) => !l.isGuide && l.visible).map((l) => l.id),
  );
  for (const stroke of args.strokes) {
    if (visibleArt.has(stroke.layerId)) drawStroke(ctx, stroke, args.useConstrained);
  }
  return { kind: 'artwork', bounds, canvas: c.canvas };
}

/** 标尺层：参考线 + 地平线 + 消失点标注；范围可覆盖画外 VP。 */
export function renderRulerLayer(args: {
  guide: PerspectiveGuide;
  options: ExportOptions;
  /** true=范围与画稿一致（VP 在画外时自然落在画面外）；false=包含全部有限 VP。 */
  fitArtwork: boolean;
  docWidth: number;
  docHeight: number;
}): RenderedLayer {
  const bounds = args.fitArtwork
    ? { x: 0, y: 0, width: args.docWidth, height: args.docHeight }
    : rulerExportBounds(args.docWidth, args.docHeight, args.guide);
  const c = makeCanvas(bounds.width, bounds.height);
  const ctx = beginLayer(c, bounds, args.options.includeBackground ? '#fafafa' : null);
  drawRuler(ctx, args.guide, bounds, args.options);
  return { kind: 'ruler', bounds, canvas: c.canvas };
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 编码失败'));
    }, 'image/png');
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(data: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  downloadBlob(blob, filename);
}
