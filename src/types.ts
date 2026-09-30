/**
 * 全局领域类型。
 *
 * 约定：
 * - 所有二维几何（笔画、标尺、裁剪框）都在「文档坐标」中，原点在画布左上角，x 向右、y 向下。
 * - 相机参数（focal / yaw / pitch / roll）与视图（平移缩放）、导出裁剪完全解耦：
 *   修改相机只改变透视几何，不触碰已画笔画；平移缩放只改变屏幕查看方式。
 */

/** 三维方向/向量（相机坐标：x 右，y 下，z 前）。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 文档坐标下的二维点。 */
export interface Point2 {
  x: number;
  y: number;
}

/**
 * 二维齐次点 [u, v, w]：
 * - w ≠ 0 表示有限点 (u/w, v/w)；
 * - w = 0 表示无穷远点（方向），绘制时必须按方向处理，禁止夹取到画布边缘。
 */
export type HPoint = readonly [number, number, number];

/**
 * 二维齐次直线 (a, b, c)，方程 a·x + b·y + c = 0。
 * 两直线交点 = cross(l1, l2)；两点连线 = cross(p1, p2)。
 */
export type HLine = readonly [number, number, number];

/** 透视模式：决定初始相机参数；本质上由 yaw/pitch 连续控制。 */
export type PerspectiveMode = 'one' | 'two' | 'three';

/**
 * 针孔相机模型。
 * 以文档中心 (principalX, principalY) 为默认像主点，focal 为以文档像素计的焦距。
 * yaw（偏航，绕世界竖直轴；>0 相机向左转，X 消失点在画外左侧）、
 * pitch（俯仰；>0 俯视 → 地平线位于画面上方，即高位地平线，竖直消失点在画面下方）、
 * roll（滚转，像面内）均为弧度。
 */
export interface CameraModel {
  focal: number;
  yaw: number;
  pitch: number;
  roll: number;
  principalX: number;
  principalY: number;
}

export type AxisId = 'x' | 'y' | 'z';

/** 一条吸附参考方向（指向某坐标轴的消失点）。 */
export interface GuideAxis {
  id: AxisId;
  /** 世界空间中的单位方向（相机坐标系下的投影方向）。 */
  direction: Vec3;
  /** 文档齐次消失点；isInfinite 时为无穷远点（纯方向）。 */
  vanishingPoint: HPoint;
  isInfinite: boolean;
  color: string;
  label: string;
}

/** 从标尺派生出的一组完整几何信息。 */
export interface PerspectiveGuide {
  camera: CameraModel;
  axes: Record<AxisId, GuideAxis>;
  /** 地平线（水平面的消失线），齐次直线。 */
  horizon: HLine;
  width: number;
  height: number;
}

/** 可吸附的绘图工具。 */
export type StrokeTool = 'segment' | 'freehand';

export interface Stroke {
  id: string;
  layerId: string;
  tool: StrokeTool;
  color: string;
  strokeWidth: number;
  /** 原始输入点（文档坐标），永不修改 —— 关闭吸附后回到这些点。 */
  rawPoints: Point2[];
  /** 约束后的点；null 表示当前为未吸附状态（数据仍在，可重新约束）。 */
  constrainedPoints: Point2[] | null;
  /** 当前约束点所吸附的坐标轴；null 表示未吸附。 */
  snappedAxis: AxisId | null;
  createdAt: number;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** 是否为标尺层；标尺层与画稿层在导出时分离。 */
  isGuide: boolean;
}

/** 导出裁剪矩形（文档坐标）；独立于相机与视图。 */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Project {
  id: string;
  name: string;
  width: number;
  height: number;
  camera: CameraModel;
  layers: Layer[];
  strokes: Stroke[];
  crop: CropRect | null;
  updatedAt: number;
}

/** 屏幕视图状态：与相机、裁剪互不影响。 */
export interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}
