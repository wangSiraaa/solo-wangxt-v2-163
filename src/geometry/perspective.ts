import type {
  AxisId,
  CameraModel,
  GuideAxis,
  HLine,
  HPoint,
  PerspectiveGuide,
  PerspectiveMode,
  Point2,
  Vec3,
} from '../types';
import {
  cross3,
  EPSILON,
  fromHomogeneous,
  lineIntersection,
  lineThrough,
  normalizeHLine,
  normalizeHPoint,
  toHomogeneous,
} from './homogeneous';

const AXIS_META: Record<AxisId, { color: string; label: string }> = {
  x: { color: '#e5484d', label: 'X 轴' },
  y: { color: '#30a46c', label: 'Y 轴（竖直）' },
  z: { color: '#3e63dd', label: 'Z 轴' },
};

export function createDefaultCamera(width: number, height: number): CameraModel {
  // 两点透视作为初始：yaw 35°、无俯仰、无滚转，水平消失点分居两侧。
  const fov = (50 * Math.PI) / 180;
  return {
    focal: focalFromVerticalFov(fov, height),
    yaw: (35 * Math.PI) / 180,
    pitch: 0,
    roll: 0,
    principalX: width / 2,
    principalY: height / 2,
  };
}

/** 一点 / 两点 / 三点透视的相机预设（画布中心为像主点）。 */
export function createPresetCamera(
  mode: PerspectiveMode,
  width: number,
  height: number,
): CameraModel {
  const fov = (50 * Math.PI) / 180;
  const base: CameraModel = {
    focal: focalFromVerticalFov(fov, height),
    yaw: 0,
    pitch: 0,
    roll: 0,
    principalX: width / 2,
    principalY: height / 2,
  };
  switch (mode) {
    case 'one':
      return { ...base, yaw: 0, pitch: 0 };
    case 'two':
      return { ...base, yaw: (35 * Math.PI) / 180, pitch: 0 };
    case 'three':
      // 俯视 20°：高位地平线，竖直消失点在画面下方远处。
      return { ...base, yaw: (35 * Math.PI) / 180, pitch: (20 * Math.PI) / 180 };
  }
}

export function focalFromVerticalFov(fovY: number, height: number): number {
  return height / 2 / Math.tan(fovY / 2);
}

export function verticalFovFromFocal(focal: number, height: number): number {
  return 2 * Math.atan(height / 2 / focal);
}

/**
 * 世界坐标轴在相机坐标系（x 右、y 下、z 前）下的单位方向。
 *
 * 相机姿态旋转矩阵 R（列 = 相机轴在世界系中的方向）为：
 *   [ cosφ    0     -sinφ ]
 *   [ sinθsinφ cosθ sinθcosφ]
 *   [ cosθsinφ -sinθ cosθcosφ]
 * 世界方向在相机系中的坐标是 R 的行，本函数返回的正是三个世界基向量对应的行：
 * - pitch>0 相机俯视地面 → 地平线位于画面上方（高位地平线），竖直消失点在画面下方；
 * - yaw>0 相机左转 → X 消失点在画外左侧；
 * - yaw=0 时 X 轴平行于画面（z 分量为 0）→ X 消失点在无穷远。
 */
export function cameraBasis(camera: CameraModel): Record<AxisId, Vec3> {
  const { yaw: f, pitch: t } = camera;
  const cf = Math.cos(f);
  const sf = Math.sin(f);
  const ct = Math.cos(t);
  const st = Math.sin(t);
  return {
    x: { x: cf, y: 0, z: -sf },
    y: { x: st * sf, y: ct, z: st * cf },
    z: { x: ct * sf, y: -st, z: ct * cf },
  };
}

/**
 * 把相机坐标系下的方向投影为文档齐次消失点。
 *
 * 像面（y 向上）坐标为 f·x'/z'、f·y'/z'，再经 roll 旋转、平移到像主点。
 * 全程保留齐次分母 z'：z'≈0 时该方向平行于画面，消失点在无穷远，
 * 返回 w=0 的纯方向 —— 上层必须按平行直线处理，严禁把它夹到画布边缘。
 */
export function projectDirection(direction: Vec3, camera: CameraModel): HPoint {
  const { focal: f, roll: r, principalX: px, principalY: py } = camera;
  const { x: dx, y: dy, z: dz } = direction;
  const cr = Math.cos(r);
  const sr = Math.sin(r);

  if (Math.abs(dz) <= EPSILON) {
    // 无穷远消失点：像面方向 (f·dx, f·dy) 经 roll 旋转。
    return normalizeHPoint([cr * dx - sr * dy, sr * dx + cr * dy, 0]);
  }
  return normalizeHPoint([
    px * dz + f * (cr * dx - sr * dy),
    py * dz + f * (sr * dx + cr * dy),
    dz,
  ]);
}

/**
 * 地平线：两个水平轴向消失点的连线（齐次叉积）。
 * 对一点透视（X 轴无穷远）与滚转情形同样成立 —— 不做「水平线 y=常数」之类的特判，
 * 因为俯仰 + 滚转时地平线是斜线。
 */
export function horizonLine(vpX: HPoint, vpZ: HPoint): HLine {
  const line = lineThrough(vpX, vpZ);
  if (Math.hypot(line[0], line[1]) <= EPSILON) {
    // 两消失点退化重合（正常相机参数不会发生），防御性返回无效直线。
    return [0, 0, 0] as const;
  }
  return line;
}

/** 由相机与画布尺寸构造完整标尺。 */
export function buildGuide(
  camera: CameraModel,
  width: number,
  height: number,
): PerspectiveGuide {
  const basis = cameraBasis(camera);
  const makeAxis = (id: AxisId): GuideAxis => {
    const vp = projectDirection(basis[id], camera);
    const infinite = Math.abs(vp[2]) <= EPSILON;
    return {
      id,
      direction: basis[id],
      vanishingPoint: vp,
      isInfinite: infinite,
      color: AXIS_META[id].color,
      label: AXIS_META[id].label,
    };
  };
  const axes: Record<AxisId, GuideAxis> = {
    x: makeAxis('x'),
    y: makeAxis('y'),
    z: makeAxis('z'),
  };
  return {
    camera,
    axes,
    horizon: horizonLine(axes.x.vanishingPoint, axes.z.vanishingPoint),
    width,
    height,
  };
}

/**
 * 从消失点向矩形四周边界均匀发射参考线，返回与矩形相交后的弦段。
 *
 * 关键不变量：
 * - 有限 VP 即使远在画布外（高位地平线 / 极端焦距），连线仍真实穿过 VP；
 * - 无穷远 VP（w=0）生成严格平行的直线族，方向取齐次 (u,v)；
 * - 任何情况下都不会把 VP 坐标截断到画布边缘当有限点使用。
 */
export function guideFanSegments(
  guide: PerspectiveGuide,
  seedsPerSide = 12,
): Array<{ axis: AxisId; a: Point2; b: Point2; isHorizon?: boolean }> {
  const { width, height } = guide;
  const seeds = boundarySeeds(width, height, seedsPerSide);
  const result: Array<{ axis: AxisId; a: Point2; b: Point2; isHorizon?: boolean }> = [];

  (Object.keys(guide.axes) as AxisId[]).forEach((id) => {
    const vp = guide.axes[id].vanishingPoint;
    const seen: HLine[] = [];
    for (const seed of seeds) {
      const line = normalizeHLine(cross3(vp, toHomogeneous(seed)));
      if (Math.hypot(line[0], line[1]) <= EPSILON) continue; // seed 与有限 VP 重合
      if (seen.some((l) => linesEquivalent(l, line))) continue;
      seen.push(line);

      const chord = lineThroughRect(line, width, height);
      if (chord) result.push({ axis: id, a: chord[0], b: chord[1] });
    }
  });

  // 地平线单独按整条裁剪（它不经过任何单独的消失点）。
  const h = normalizeHLine(guide.horizon);
  if (Math.hypot(h[0], h[1]) > EPSILON) {
    const chord = lineThroughRect(h, width, height);
    if (chord) {
      result.push({ axis: 'x', a: chord[0], b: chord[1], isHorizon: true });
    }
  }

  return result;
}

/** 直线与矩形的相交弦；直线不合法或不相交时返回 null（全直线射线式裁剪）。 */
export function lineThroughRect(
  line: HLine,
  width: number,
  height: number,
): [Point2, Point2] | null {
  const [a, b, c] = line;
  if (Math.hypot(a, b) <= EPSILON) return null;
  // 原点到直线的垂足作为线上一点，方向为法向量旋转 90°。
  const p0: Point2 = { x: -a * c, y: -b * c };
  const dir = { x: -b, y: a };
  // 参数区间取整条直线 t∈[-T,T]，T 足以覆盖任何「画外极远 VP」垂足。
  const T = Math.abs(c) + Math.hypot(width, height) + Math.hypot(p0.x, p0.y) + 1;
  return clipLineToRect(p0, dir, -T, T, width, height);
}

/** p0 + t·dir，t∈[t0,t1] 对矩形的 Liang–Barsky 裁剪。 */
function clipLineToRect(
  p0: Point2,
  dir: Point2,
  t0In: number,
  t1In: number,
  width: number,
  height: number,
): [Point2, Point2] | null {
  let t0 = t0In;
  let t1 = t1In;
  const p = [-dir.x, dir.x, -dir.y, dir.y];
  const q = [p0.x, width - p0.x, p0.y, height - p0.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) <= EPSILON) {
      if (q[i] < 0) return null; // 与边界平行且在外侧
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return null;
      t0 = Math.max(t0, r);
    } else {
      if (r < t0) return null;
      t1 = Math.min(t1, r);
    }
  }
  return [
    { x: p0.x + t0 * dir.x, y: p0.y + t0 * dir.y },
    { x: p0.x + t1 * dir.x, y: p0.y + t1 * dir.y },
  ];
}

function boundarySeeds(width: number, height: number, perSide: number): Point2[] {
  const pts: Point2[] = [];
  for (let i = 0; i < perSide; i++) {
    const t = i / perSide;
    pts.push({ x: width * t, y: 0 });
    pts.push({ x: width * t, y: height });
    pts.push({ x: 0, y: height * t });
    pts.push({ x: width, y: height * t });
  }
  pts.push({ x: width, y: height });
  return pts;
}

function linesEquivalent(l1: HLine, l2: HLine, tol = 1e-6): boolean {
  return (
    Math.abs(l1[0] - l2[0]) <= tol &&
    Math.abs(l1[1] - l2[1]) <= tol &&
    Math.abs(l1[2] - l2[2]) <= tol
  );
}

/** 两有限/无穷远点在像面上对应的直线交点（标尺交互用）。 */
export function intersectGuideLines(
  p1: HPoint,
  q1: HPoint,
  p2: HPoint,
  q2: HPoint,
): HPoint {
  return lineIntersection(lineThrough(p1, q1), lineThrough(p2, q2));
}

/** 工具函数：求有限点版消失点（面板显示用，无穷远返回 null）。 */
export function finiteVanishingPoint(vp: HPoint): Point2 | null {
  return fromHomogeneous(vp);
}
