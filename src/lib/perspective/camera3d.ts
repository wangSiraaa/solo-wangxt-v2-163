import { matrix, multiply, type Matrix } from 'mathjs';
import * as THREE from 'three';
import type { AxisId, HPoint, Point2, Ruler } from '../../types';
import { hpoint, infinityPoint } from '../geometry/homogeneous';

/**
 * 由真实针孔相机旋转生成标尺，保证三个消失点对应互相垂直的世界方向。
 *
 * 相机基（世界坐标）：
 * - e0：屏幕右
 * - e1：屏幕下
 * - e2：视线方向（入屏）
 * 世界轴：w0 = X（水平右）、w1 = Y（纵深）、w2 = Z（竖直向下）。
 *
 * pan θ：绕世界竖直轴水平旋转；tilt φ：绕相机右轴俯仰（俯视/仰视）。
 * 世界轴 wj 的消失点 = principal + f * (m0j, m1j) / m2j，
 * M 是以 (e0, e1, e2) 为行基的旋转矩阵；m2j = 0 时该 VP 在无穷远。
 */

export interface CameraRotation {
  /** 水平旋转（弧度） */
  pan: number;
  /** 俯仰（弧度），φ>0 俯视 */
  tilt: number;
}

export interface CameraBasis {
  e0: [number, number, number];
  e1: [number, number, number];
  e2: [number, number, number];
}

export function basisFromRotation({ pan, tilt }: CameraRotation): CameraBasis {
  const cp = Math.cos(pan);
  const sp = Math.sin(pan);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  // pan 后
  const e0: [number, number, number] = [cp, sp, 0];
  const e2p: [number, number, number] = [-sp, cp, 0];
  const e1p: [number, number, number] = [0, 0, 1];
  // tilt：绕 e0 旋转（俯视时视线向下偏）
  const e1: [number, number, number] = [
    -st * e2p[0] + ct * e1p[0],
    -st * e2p[1] + ct * e1p[1],
    -st * e2p[2] + ct * e1p[2],
  ];
  const e2: [number, number, number] = [
    ct * e2p[0] + st * e1p[0],
    ct * e2p[1] + st * e1p[1],
    ct * e2p[2] + st * e1p[2],
  ];
  return { e0, e1, e2 };
}

/** 行基 = 相机基的 3×3 旋转矩阵（世界坐标 -> 相机坐标）。 */
export function rotationMatrix(b: CameraBasis): Matrix {
  return matrix([b.e0, b.e1, b.e2]);
}

const VP_EPS = 1e-9;

/** 世界轴 j 的消失点（齐次）：[f*m0j + px*m2j, f*m1j + py*m2j, m2j]。 */
function vanishingPointOfColumn(
  M: Matrix,
  j: AxisId,
  focal: number,
  principal: Point2,
): HPoint {
  const m = M.toArray() as number[][];
  const m2 = m[2][j];
  if (Math.abs(m2) < VP_EPS) {
    // 轴与画面平行 —— 消失点在无穷远，返回方向而不是边缘上的假点。
    return infinityPoint(m[0][j], m[1][j]);
  }
  return hpoint(
    principal.x + (focal * m[0][j]) / m2,
    principal.y + (focal * m[1][j]) / m2,
  );
}

export function rulerFromRotation(
  kind: 1 | 2 | 3,
  rot: CameraRotation,
  focal: number,
  principal: Point2,
): Ruler {
  const M = rotationMatrix(basisFromRotation(rot));
  const axes = [0, 1, 2].map((j) =>
    vanishingPointOfColumn(M, j as AxisId, focal, principal),
  ) as Ruler['axes'];

  // 一点透视：水平旋转归零，纵深 VP 落在主点。
  // 两点透视：tilt=0，竖直 VP 无穷远。
  // 三点透视：两个角度都非零。
  return {
    kind,
    axes,
    rotation: { pan: rot.pan, tilt: rot.tilt },
    focal,
    principal: { ...principal },
    horizonAxes: [0, 1],
    verticalAxis: 2,
  };
}

/** 世界点相对相机中心（相机位于 center）投影到文档坐标。 */
export function projectWorldPoint(
  P: [number, number, number],
  ruler: Ruler,
  basis: CameraBasis,
  center: [number, number, number] = [0, 0, 0],
): Point2 {
  const rel: [number, number, number] = [
    P[0] - center[0],
    P[1] - center[1],
    P[2] - center[2],
  ];
  const M = rotationMatrix(basis);
  const q = multiply(M, matrix(rel).resize([3, 1])).toArray() as number[][];
  const z = q[2][0];
  if (z <= 1e-9) {
    throw new Error('projectWorldPoint: 点在相机后方或视平面上');
  }
  return {
    x: ruler.principal.x + (ruler.focal * q[0][0]) / z,
    y: ruler.principal.y + (ruler.focal * q[1][0]) / z,
  };
}

/**
 * 世界坐标 (X, Y深度, Z向下) -> Three 坐标 (X, Y向上, Z深度)。
 */
export function toThreeVec(v: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(v[0], -v[2], v[1]);
}

/**
 * 同步到 Three.js 相机。
 * Three 约定：-Z 朝前、+Y 朝上；本模块：e2 入屏、e1 朝下。
 * 故 three 基 = (e0, -e1, -e2)，并经 (X,Z,Y) 坐标置换。
 */
export function applyToThreeCamera(
  camera: THREE.PerspectiveCamera,
  basis: CameraBasis,
  center: [number, number, number],
  docHeight: number,
  focal: number,
): void {
  const right = toThreeVec(basis.e0);
  const up = toThreeVec(basis.e1).negate();
  const back = toThreeVec(basis.e2).negate();
  const m = new THREE.Matrix4().makeBasis(right, up, back);
  camera.position.copy(toThreeVec(center));
  camera.quaternion.setFromRotationMatrix(m);
  camera.fov = (2 * Math.atan(docHeight / (2 * focal)) * 180) / Math.PI;
  camera.updateProjectionMatrix();
}

/**
 * 带主点偏移的针孔投影：当标尺主点不在屏幕矩形中心（高位地平线、
 * 视口平移/缩放后）时必须使用，否则参考盒棱不会对准消失点。
 *
 * @param focalScreen 焦距（屏幕像素，= focal*相机缩放）
 * @param principalScreen 主点的屏幕坐标
 * @param vw/vh 视口尺寸
 */
export function applyProjectionWithPrincipal(
  camera: THREE.PerspectiveCamera,
  focalScreen: number,
  principalScreen: { x: number; y: number },
  vw: number,
  vh: number,
  near = 1,
  far = 1e7,
): void {
  // OpenGL 风格透视矩阵（three 列主序），Three 的相机朝向 -Z
  const x = principalScreen.x;
  const y = principalScreen.y;
  const f = focalScreen;
  const n = near;
  const m = new THREE.Matrix4();
  m.set(
    (2 * f) / vw, 0, (vw - 2 * x) / vw, 0,
    0, (2 * f) / vh, -(vh - 2 * y) / vh, 0,
    0, 0, -(far + n) / (far - n), (-2 * far * n) / (far - n),
    0, 0, -1, 0,
  );
  camera.projectionMatrix.copy(m);
  camera.projectionMatrixInverse.copy(m).invert();
}

export function threeWorldPoint(
  P: [number, number, number],
): THREE.Vector3 {
  return toThreeVec(P);
}
