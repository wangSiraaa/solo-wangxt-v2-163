import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Line, Rect, Arrow, Group, Circle } from 'react-konva';
import type Konva from 'konva';
import { AXIS_COLORS, type Point2 } from '../types';
import { useStore } from '../state/store';
import { screenToWorld, panBy, zoomAt, normalizeCrop } from '../lib/viewport';
import { makeId } from '../lib/storage/idb';
import { guideSegments, horizonSegment, vpMarkers } from '../lib/geometry/guides';

/**
 * Konva 二维笔画编辑器。
 * - 世界坐标系（文档坐标）绘制，视口相机作用在外层 Group；
 * - 笔画同时存 raw 与逐段 axes，显示时取派生约束点；
 * - 关闭吸附只切换 displayed 数据，raw 不受影响；
 * - 平移/滚轮缩放只改 camera，不进文档数据。
 */

export function EditorStage({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const { state, dispatch, constrained } = useStore();
  const { project: p, tool } = state;
  const stageRef = useRef<Konva.Stage>(null);
  const drawing = useRef(false);
  const panning = useRef<{ x: number; y: number } | null>(null);
  const cropping = useRef<{ start: Point2 } | null>(null);
  const [cropDraft, setCropDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const toWorld = (sx: number, sy: number): Point2 =>
    screenToWorld(p.camera, { x: sx, y: sy });

  // 让整个文档（含画布外 VP 空间）都可作为引导区域：相机视口对应的世界矩形
  const viewRegion = useMemo(
    () => ({
      x: -p.camera.offsetX / p.camera.scale,
      y: -p.camera.offsetY / p.camera.scale,
      w: width / p.camera.scale,
      h: height / p.camera.scale,
    }),
    [p.camera, width, height],
  );

  const guides = useMemo(() => {
    if (!p.showRuler) return null;
    return {
      segments: [0, 1, 2].map((a) => ({
        axis: a as 0 | 1 | 2,
        segs: guideSegments(p.ruler, a as 0 | 1 | 2, viewRegion),
      })),
      horizon: horizonSegment(p.ruler, viewRegion),
      markers: vpMarkers(p.ruler, viewRegion),
    };
  }, [p.showRuler, p.ruler, viewRegion]);

  function handlePointerDown(e: Konva.KonvaEventObject<PointerEvent>) {
    const stage = e.target.getStage()!;
    const pointer = stage.getPointerPosition()!;
    if (tool === 'pan' || e.evt.button === 1 || e.evt.shiftKey) {
      panning.current = { x: pointer.x, y: pointer.y };
      return;
    }
    if (tool === 'crop') {
      cropping.current = { start: toWorld(pointer.x, pointer.y) };
      setCropDraft({ x: 0, y: 0, w: 0, h: 0 });
      return;
    }
    if (tool === 'pen') {
      drawing.current = true;
      dispatch({ type: 'beginStroke', id: makeId(), point: toWorld(pointer.x, pointer.y) });
    }
  }

  function handlePointerMove(e: Konva.KonvaEventObject<PointerEvent>) {
    const stage = e.target.getStage()!;
    const pointer = stage.getPointerPosition()!;
    if (panning.current) {
      const dx = pointer.x - panning.current.x;
      const dy = pointer.y - panning.current.y;
      panning.current = { x: pointer.x, y: pointer.y };
      dispatch({ type: 'setCamera', camera: panBy(p.camera, dx, dy) });
      return;
    }
    if (cropping.current) {
      const s = cropping.current.start;
      const q = toWorld(pointer.x, pointer.y);
      setCropDraft(normalizeCrop(s.x, s.y, q.x - s.x, q.y - s.y));
      return;
    }
    if (drawing.current) {
      dispatch({ type: 'extendStroke', point: toWorld(pointer.x, pointer.y) });
    }
  }

  function handlePointerUp() {
    if (panning.current) {
      panning.current = null;
      return;
    }
    if (cropping.current) {
      cropping.current = null;
      if (cropDraft && cropDraft.w > 4 && cropDraft.h > 4) {
        dispatch({ type: 'setCrop', crop: cropDraft });
      }
      setCropDraft(null);
      return;
    }
    if (drawing.current) {
      drawing.current = false;
      dispatch({ type: 'endStroke' });
    }
  }

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current!;
    const pointer = stage.getPointerPosition()!;
    const factor = e.evt.deltaY < 0 ? 1.12 : 1 / 1.12;
    dispatch({ type: 'setCamera', camera: zoomAt(p.camera, pointer, factor) });
  }

  // 键盘快捷键
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        dispatch({ type: 'undoStroke' });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cursor =
    tool === 'pan' ? 'grab' : tool === 'crop' ? 'crosshair' : 'crosshair';

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      style={{ background: '#eceae4', cursor, touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* 文档层：所有世界坐标内容放在同一相机 Group 内 */}
      <Layer listening={false}>
        <Group x={p.camera.offsetX} y={p.camera.offsetY} scaleX={p.camera.scale} scaleY={p.camera.scale}>
          {/* 画板 */}
          <Rect
            x={0}
            y={0}
            width={p.width}
            height={p.height}
            fill="#ffffff"
            stroke="#c9c4b8"
            strokeWidth={2 / p.camera.scale}
            shadowBlur={18 / p.camera.scale}
            shadowOpacity={0.15}
          />
        </Group>
      </Layer>

      {/* 标尺层（独立图层，导出时与画稿分层一致） */}
      {p.showRuler && guides && (
        <Layer listening={false}>
          <Group x={p.camera.offsetX} y={p.camera.offsetY} scaleX={p.camera.scale} scaleY={p.camera.scale}>
            {guides.segments.map(({ axis, segs }) =>
              segs.map((s, i) => (
                <Line
                  key={`g-${axis}-${i}`}
                  points={[s.a.x, s.a.y, s.b.x, s.b.y]}
                  stroke={AXIS_COLORS[axis]}
                  strokeWidth={1 / p.camera.scale}
                  opacity={0.22}
                />
              )),
            )}
            {guides.horizon && (
              <Line
                points={[
                  guides.horizon.a.x,
                  guides.horizon.a.y,
                  guides.horizon.b.x,
                  guides.horizon.b.y,
                ]}
                stroke="#222"
                strokeWidth={1.5 / p.camera.scale}
                dash={[10 / p.camera.scale, 6 / p.camera.scale]}
              />
            )}
            {guides.markers.map((m) => {
              const color = AXIS_COLORS[m.axis];
              const r = 8 / p.camera.scale;
              if (m.kind === 'infinity') {
                // 无穷远 VP：中心方向箭头，绝不画成边缘上的点
                const len = Math.min(viewRegion.w, viewRegion.h) * 0.16;
                return (
                  <Arrow
                    key={`vp-${m.axis}`}
                    points={[
                      m.point.x - m.direction!.x * len,
                      m.point.y - m.direction!.y * len,
                      m.point.x + m.direction!.x * len,
                      m.point.y + m.direction!.y * len,
                    ]}
                    stroke={color}
                    fill={color}
                    strokeWidth={2 / p.camera.scale}
                    pointerLength={12 / p.camera.scale}
                    pointerWidth={10 / p.camera.scale}
                  />
                );
              }
              return (
                <Group key={`vp-${m.axis}`}>
                  <Circle x={m.point.x} y={m.point.y} radius={r} stroke={color} strokeWidth={1.5 / p.camera.scale} />
                  <Line
                    points={[m.point.x - r - 4 / p.camera.scale, m.point.y, m.point.x + r + 4 / p.camera.scale, m.point.y]}
                    stroke={color}
                    strokeWidth={1.5 / p.camera.scale}
                  />
                  <Line
                    points={[m.point.x, m.point.y - r - 4 / p.camera.scale, m.point.x, m.point.y + r + 4 / p.camera.scale]}
                    stroke={color}
                    strokeWidth={1.5 / p.camera.scale}
                  />
                  {!m.inside && (
                    <Group>
                      <Circle x={m.point.x} y={m.point.y} radius={3 / p.camera.scale} fill={color} />
                    </Group>
                  )}
                </Group>
              );
            })}
          </Group>
        </Layer>
      )}

      {/* 画稿层 */}
      <Layer listening={false}>
        <Group x={p.camera.offsetX} y={p.camera.offsetY} scaleX={p.camera.scale} scaleY={p.camera.scale}>
          {p.strokes.map((s) => {
            const pts = p.snapEnabled ? constrained.get(s.id) ?? s.raw : s.raw;
            return (
              <Line
                key={s.id}
                points={pts.flatMap((q) => [q.x, q.y])}
                stroke={s.color}
                strokeWidth={s.width}
                lineCap="round"
                lineJoin="round"
                tension={0.15}
                bezier
              />
            );
          })}
        </Group>
      </Layer>

      {/* 裁切层（只在编辑时显示；不改变相机与笔画） */}
      <Layer listening={false}>
        <Group x={p.camera.offsetX} y={p.camera.offsetY} scaleX={p.camera.scale} scaleY={p.camera.scale}>
          {p.crop && <CropOverlay crop={p.crop} doc={{ w: p.width, h: p.height }} scale={p.camera.scale} />}
          {cropDraft && (
            <Rect
              x={cropDraft.x}
              y={cropDraft.y}
              width={cropDraft.w}
              height={cropDraft.h}
              stroke="#1d4ed8"
              strokeWidth={1.5 / p.camera.scale}
              dash={[6 / p.camera.scale, 4 / p.camera.scale]}
              fill="rgba(29,78,216,0.08)"
            />
          )}
        </Group>
      </Layer>
    </Stage>
  );
}

function CropOverlay({
  crop,
  doc,
  scale,
}: {
  crop: { x: number; y: number; w: number; h: number };
  doc: { w: number; h: number };
  scale: number;
}) {
  const sw = 1.5 / scale;
  return (
    <>
      <Rect x={0} y={0} width={doc.w} height={Math.max(0, crop.y)} fill="rgba(0,0,0,0.25)" />
      <Rect x={0} y={crop.y + crop.h} width={doc.w} height={Math.max(0, doc.h - crop.y - crop.h)} fill="rgba(0,0,0,0.25)" />
      <Rect x={0} y={crop.y} width={Math.max(0, crop.x)} height={crop.h} fill="rgba(0,0,0,0.25)" />
      <Rect x={crop.x + crop.w} y={crop.y} width={Math.max(0, doc.w - crop.x - crop.w)} height={crop.h} fill="rgba(0,0,0,0.25)" />
      <Rect
        x={crop.x}
        y={crop.y}
        width={crop.w}
        height={crop.h}
        stroke="#1d4ed8"
        strokeWidth={sw}
      />
    </>
  );
}
