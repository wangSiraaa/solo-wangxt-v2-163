import { useMemo, useRef, useState } from 'react';
import { Stage, Layer, Line, Rect, Circle, Group, Arrow } from 'react-konva';
import type Konva from 'konva';
import type { Point2, PerspectiveGuide, Stroke, ViewTransform } from '../types';
import { fromHomogeneous } from '../geometry/homogeneous';
import { guideFanSegments } from '../geometry/perspective';
import { constrainPoints, findSnapAxis } from '../geometry/snapping';
import type { Tool } from '../store';

interface EditorStageProps {
  width: number;
  height: number;
  docWidth: number;
  docHeight: number;
  guide: PerspectiveGuide;
  view: ViewTransform;
  tool: Tool;
  color: string;
  strokeWidth: number;
  snappingEnabled: boolean;
  strokes: Stroke[];
  layerVisibility: Map<string, boolean>;
  crop: { x: number; y: number; width: number; height: number } | null;
  onViewChange: (view: ViewTransform) => void;
  onCommitStroke: (points: Point2[]) => void;
  onCommitCrop: (crop: { x: number; y: number; width: number; height: number } | null) => void;
}

interface DraftState {
  points: Point2[];
}

const AXIS_COLOR: Record<string, string> = {
  x: '#e5484d',
  y: '#30a46c',
  z: '#3e63dd',
};

export function EditorStage(props: EditorStageProps) {
  const {
    width,
    height,
    docWidth,
    docHeight,
    guide,
    view,
    tool,
    color,
    strokeWidth,
    snappingEnabled,
    strokes,
    layerVisibility,
    crop,
    onViewChange,
    onCommitStroke,
    onCommitCrop,
  } = props;

  const stageRef = useRef<Konva.Stage>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point2 | null>(null);
  const [panStart, setPanStart] = useState<{ x: number; y: number; view: ViewTransform } | null>(null);
  const [cropStart, setCropStart] = useState<Point2 | null>(null);
  const [cropDraft, setCropDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const toDoc = (sx: number, sy: number): Point2 => ({
    x: (sx - view.offsetX) / view.scale,
    y: (sy - view.offsetY) / view.scale,
  });

  const fanSegments = useMemo(
    () => guideFanSegments(guide, 8),
    [guide],
  );

  const vanishingMarkers = useMemo(() => {
    return Object.values(guide.axes).map((axis) => {
      const finite = fromHomogeneous(axis.vanishingPoint);
      return { id: axis.id, color: axis.color, label: axis.label, finite, infinite: axis.isInfinite };
    });
  }, [guide]);

  const handlePointerDown = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;

    if (tool === 'pan') {
      setPanStart({ x: p.x, y: p.y, view: { ...view } });
      return;
    }
    if (tool === 'crop') {
      const d = toDoc(p.x, p.y);
      if (d.x < 0 || d.y < 0 || d.x > docWidth || d.y > docHeight) return;
      setCropStart(d);
      setCropDraft({ x: d.x, y: d.y, width: 0, height: 0 });
      return;
    }
    const d = toDoc(p.x, p.y);
    setDraft({ points: [d] });
  };

  const handlePointerMove = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const p = stage.getPointerPosition();
    if (!p) return;

    if (panStart) {
      onViewChange({
        ...view,
        offsetX: panStart.view.offsetX + (p.x - panStart.x),
        offsetY: panStart.view.offsetY + (p.y - panStart.y),
      });
      return;
    }
    if (cropStart) {
      const d = toDoc(p.x, p.y);
      const x = Math.max(0, Math.min(docWidth, d.x));
      const y = Math.max(0, Math.min(docHeight, d.y));
      setCropDraft({
        x: Math.min(cropStart.x, x),
        y: Math.min(cropStart.y, y),
        width: Math.abs(x - cropStart.x),
        height: Math.abs(y - cropStart.y),
      });
      return;
    }
    setHoverPoint(toDoc(p.x, p.y));
    if (draft) {
      const d = toDoc(p.x, p.y);
      if (tool === 'segment') {
        setDraft({ points: [draft.points[0], d] });
      } else {
        const last = draft.points[draft.points.length - 1];
        // 自由笔画按最小间距抽稀，减少 IndexedDB 体积。
        if (Math.hypot(d.x - last.x, d.y - last.y) > 1.5 / view.scale) {
          setDraft({ points: [...draft.points, d] });
        }
      }
    }
  };

  const handlePointerUp = () => {
    if (panStart) {
      setPanStart(null);
      return;
    }
    if (cropStart && cropDraft) {
      if (cropDraft.width > 4 && cropDraft.height > 4) onCommitCrop(cropDraft);
      setCropStart(null);
      setCropDraft(null);
      return;
    }
    if (draft && draft.points.length >= 2) {
      onCommitStroke(draft.points);
    }
    setDraft(null);
  };

  const draftPreviewPoints = useMemo(() => {
    if (!draft || draft.points.length === 0) return null;
    return { points: draft.points };
  }, [draft]);

  /** 线段工具下，鼠标悬停位置若落在吸附阈值内，预览约束后的走向。 */
  const snapPreview = useMemo(() => {
    if (!snappingEnabled || tool !== 'segment' || !hoverPoint || !draft || draft.points.length !== 2) {
      return null;
    }
    const start = draft.points[0];
    const rawEnd = draft.points[1];
    const match = findSnapAxis(start, rawEnd, guide.axes);
    if (!match) return null;
    const constrained = constrainPoints(draft.points, guide.axes, match.axis, 'segment');
    return { points: constrained, color: guide.axes[match.axis].color };
  }, [snappingEnabled, tool, hoverPoint, draft, guide]);

  const flatten = (pts: Point2[]) => pts.flatMap((p) => [p.x, p.y]);

  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    // 滚轮缩放只改视图，不动相机几何与裁剪。
    e.evt.preventDefault();
    const stage = stageRef.current;
    const p = stage?.getPointerPosition();
    if (!p) return;
    const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1;
    const nextScale = Math.min(8, Math.max(0.1, view.scale * factor));
    const docBefore = toDoc(p.x, p.y);
    onViewChange({
      scale: nextScale,
      offsetX: p.x - docBefore.x * nextScale,
      offsetY: p.y - docBefore.y * nextScale,
    });
  };

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
      style={{ cursor: tool === 'pan' ? 'grab' : 'crosshair', touchAction: 'none' }}
    >
      {/* 文档与标尺层 */}
      <Layer>
        <Group x={view.offsetX} y={view.offsetY} scaleX={view.scale} scaleY={view.scale}>
          <Rect x={0} y={0} width={docWidth} height={docHeight} fill="#ffffff" shadowBlur={12} shadowOpacity={0.15} />
          {/* 参考扇形线：有限 VP 可在画外，线仍准确汇聚；无穷远 VP 为平行线。 */}
          {fanSegments.map((s, i) => (
            <Line
              key={`fan-${i}`}
              points={[s.a.x, s.a.y, s.b.x, s.b.y]}
              stroke={s.isHorizon ? '#8e8e93' : AXIS_COLOR[s.axis]}
              strokeWidth={s.isHorizon ? 1.2 : 0.6}
              opacity={s.isHorizon ? 0.7 : 0.28}
              dash={s.isHorizon ? [8, 6] : undefined}
              listening={false}
            />
          ))}
          {/* 消失点标记：有限点在画内才画圆；无穷远只在画面中心画方向箭头，绝不画到边缘假点。 */}
          {vanishingMarkers.map((m) => {
            if (m.infinite) {
              const [u, v] = guide.axes[m.id].vanishingPoint;
              const cx = docWidth / 2;
              const cy = docHeight / 2;
              return (
                <Arrow
                  key={`vp-${m.id}`}
                  points={[cx - u * 14, cy - v * 14, cx + u * 14, cy + v * 14]}
                  fill={m.color}
                  stroke={m.color}
                  opacity={0.85}
                  pointerLength={8}
                  pointerWidth={6}
                  listening={false}
                />
              );
            }
            if (!m.finite) return null;
            const inside = m.finite.x >= 0 && m.finite.x <= docWidth && m.finite.y >= 0 && m.finite.y <= docHeight;
            return inside ? (
              <Circle key={`vp-${m.id}`} x={m.finite.x} y={m.finite.y} radius={5} fill={m.color} listening={false} />
            ) : null;
          })}
        </Group>
      </Layer>

      {/* 画稿层 */}
      <Layer>
        <Group x={view.offsetX} y={view.offsetY} scaleX={view.scale} scaleY={view.scale}>
          {strokes.map((s) => {
            if (layerVisibility.get(s.layerId) === false) return null;
            // 吸附开关只决定显示哪一版；关闭时画原始笔画，约束数据保留不丢。
            const pts = snappingEnabled && s.constrainedPoints ? s.constrainedPoints : s.rawPoints;
            return (
              <Line
                key={s.id}
                points={flatten(pts)}
                stroke={s.color}
                strokeWidth={s.strokeWidth}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            );
          })}
          {draftPreviewPoints && (
            <Line
              points={flatten(draftPreviewPoints.points)}
              stroke={color}
              strokeWidth={strokeWidth}
              opacity={snapPreview ? 0.35 : 0.7}
              lineCap="round"
              listening={false}
            />
          )}
          {snapPreview && (
            <Line
              points={flatten(snapPreview.points)}
              stroke={snapPreview.color}
              strokeWidth={strokeWidth}
              opacity={0.9}
              lineCap="round"
              listening={false}
            />
          )}
        </Group>
      </Layer>

      {/* 裁剪层（独立于相机与视图） */}
      <Layer>
        <Group x={view.offsetX} y={view.offsetY} scaleX={view.scale} scaleY={view.scale}>
          {crop && (
            <>
              {/* 用四块矩形在裁剪框外压暗，而不是给整个文档盖一层。 */}
              <Rect x={0} y={0} width={docWidth} height={crop.y} fill="rgba(0,0,0,0.28)" listening={false} />
              <Rect x={0} y={crop.y + crop.height} width={docWidth} height={Math.max(0, docHeight - crop.y - crop.height)} fill="rgba(0,0,0,0.28)" listening={false} />
              <Rect x={0} y={crop.y} width={crop.x} height={crop.height} fill="rgba(0,0,0,0.28)" listening={false} />
              <Rect x={crop.x + crop.width} y={crop.y} width={Math.max(0, docWidth - crop.x - crop.width)} height={crop.height} fill="rgba(0,0,0,0.28)" listening={false} />
              <Rect
                x={crop.x}
                y={crop.y}
                width={crop.width}
                height={crop.height}
                stroke="#111"
                strokeWidth={1.5}
                dash={[6, 4]}
                listening={false}
              />
            </>
          )}
          {cropDraft && (
            <Rect
              x={cropDraft.x}
              y={cropDraft.y}
              width={cropDraft.width}
              height={cropDraft.height}
              stroke="#0066ff"
              strokeWidth={1.5}
              dash={[4, 3]}
              listening={false}
            />
          )}
        </Group>
      </Layer>
    </Stage>
  );
}
