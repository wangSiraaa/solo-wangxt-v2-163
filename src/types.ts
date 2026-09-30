// 共享类型定义 —— 纯数据，不含任何运行时依赖，可被 Konva / Three / 持久层共用。

/** 二维欧氏点（文档/世界坐标）。 */
export interface Point2 {
  x: number;
  y: number;
}

/**
 * 齐次点 [X, Y, W]：
 * - W 不为 0 时归一化为 (X/W, Y/W) 的有限点；
 * - W = 0 时表示无穷远点（方向），即"平行于画面"的消失方向。
 * 无穷远点绝不允许被归一化或截断到画布边缘。
 */
export type HPoint = readonly [number, number, number];

export type AxisId = 0 | 1 | 2;

/** 一点 / 两点 / 三点透视。 */
export type PerspectiveKind = 1 | 2 | 3;

export interface Ruler {
  kind: PerspectiveKind;
  /**
   * 三个轴方向的消失点（齐次）。
   * - axes[0], axes[1]：水平方向 X / Y（两点、三点透视下为有限 VP，一点透视下其中之一为无穷远）
   * - axes[2]：竖直方向 Z（三点透视下为有限 VP，一点/两点透视下为无穷远正下方）
   * 未被当前 kind 使用的槽位用无穷远点占位。
   */
  axes: [HPoint, HPoint, HPoint];
  /**
   * 生成这些 VP 的相机旋转（弧度）。由预设/编辑器调整写入，
   * Three.js 参考盒直接用它构造相机，避免从 VP（含无穷远）反推方向时的歧义。
   */
  rotation: { pan: number; tilt: number };
  /** 相机焦距（像素，文档坐标），供 Three.js 参考盒反推相机。 */
  focal: number;
  /** 相机主点（画面坐标系，y 向下）。 */
  principal: Point2;
  /** 地平面（地平线）经过的轴索引；三点透视取两个水平轴。 */
  horizonAxes: [AxisId, AxisId];
  /** 竖向轴索引（仅用于语义标注）。 */
  verticalAxis: AxisId;
}

/** 一段笔画归属：吸附到某轴，或保持自由（null）。 */
export type SegmentAxis = AxisId | null;

export interface Stroke {
  id: string;
  color: string;
  width: number;
  /** 原始采样点，永远保留，不被约束覆盖。 */
  raw: Point2[];
  /**
   * 与 raw 段一一对应的轴归属（第 i 段 = raw[i] -> raw[i+1]）。
   * 关闭吸附只是不显示 constrained，不删除任何数据。
   */
  axes: SegmentAxis[];
  createdAt: number;
}

/** 视口相机：平移 + 缩放。与文档裁切 crop 完全独立。 */
export interface Camera {
  /** 文档坐标 -> 屏幕坐标：screen = world * scale + offset。 */
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** 文档裁切矩形（文档坐标）；null 表示未裁切。和相机无关。 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Project {
  id: string;
  name: string;
  /** 文档（画板）逻辑尺寸。 */
  width: number;
  height: number;
  ruler: Ruler;
  strokes: Stroke[];
  camera: Camera;
  crop: CropRect | null;
  snapEnabled: boolean;
  showRuler: boolean;
  showReferenceBox: boolean;
  updatedAt: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  updatedAt: number;
}

export const AXIS_COLORS = ['#e63946', '#2a9d8f', '#f4a261'] as const;
export const AXIS_NAMES = ['X 轴', 'Y 轴', 'Z 轴'] as const;
