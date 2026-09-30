import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AxisId, CameraModel } from '../src/types';
import { buildGuide, cameraBasis, createPresetCamera } from '../src/geometry/perspective';

const W = 1200;
const H = 800;
const BOX_SIZE = 1;
const BOX_DISTANCE = 2.2;

/**
 * ReferenceBoxOverlay 同款顶点构造（无 WebGL 依赖的纯数学版本）。
 * 改这里时必须同步 src/three/ReferenceBox.ts：盒子在相机系中围绕相机前方固定
 * 中心构造，盒棱方向用世界轴在相机系中的方向（cameraBasis，旋转矩阵的行），
 * 滚转通过反向旋转场景实现等价的像面旋转。
 */
function boxCorners(model: CameraModel): THREE.Vector3[] {
  const basis = cameraBasis(model);
  const rCols: Record<AxisId, THREE.Vector3> = {
    x: new THREE.Vector3(basis.x.x, -basis.x.y, -basis.x.z),
    y: new THREE.Vector3(basis.y.x, -basis.y.y, -basis.y.z),
    z: new THREE.Vector3(basis.z.x, -basis.z.y, -basis.z.z),
  };
  const rollQ = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    -model.roll,
  );
  for (const key of ['x', 'y', 'z'] as AxisId[]) rCols[key].applyQuaternion(rollQ);

  const center = new THREE.Vector3(0, 0, -BOX_DISTANCE);
  const corners: THREE.Vector3[] = [];
  for (let ix = 0; ix < 2; ix++) {
    for (let iy = 0; iy < 2; iy++) {
      for (let iz = 0; iz < 2; iz++) {
        corners.push(
          center
            .clone()
            .addScaledVector(rCols.x, (ix - 0.5) * BOX_SIZE)
            .addScaledVector(rCols.y, (iy - 0.5) * BOX_SIZE)
            .addScaledVector(rCols.z, (iz - 0.5) * BOX_SIZE),
        );
      }
    }
  }
  return corners;
}

/** 顶点按 (ix,iy,iz) 展平，index = ix*4 + iy*2 + iz；同一轴的棱只改变对应下标。 */
const EDGES: Array<[number, number, AxisId]> = [
  [0, 4, 'x'], [1, 5, 'x'], [2, 6, 'x'], [3, 7, 'x'],
  [0, 2, 'y'], [1, 3, 'y'], [4, 6, 'y'], [5, 7, 'y'],
  [0, 1, 'z'], [2, 3, 'z'], [4, 5, 'z'], [6, 7, 'z'],
];

/**
 * 顶点已是 Three 相机系（y 上、z 朝后）坐标；换回数学相机系（y 下、z 前）
 * 后按针孔模型投到文档像素。滚转已烘焙进盒轴，此处不再施加。
 */
function projectToDoc(p: THREE.Vector3, model: CameraModel): { x: number; y: number } {
  const xp = p.x;
  const yp = -p.y;
  const zp = -p.z;
  return {
    x: model.principalX + (model.focal * xp) / zp,
    y: model.principalY + (model.focal * yp) / zp,
  };
}

describe('Three.js 参考盒与 2D 标尺对齐', () => {
  const cases: Array<{ name: string; make: () => CameraModel }> = [
    { name: '一点透视', make: () => createPresetCamera('one', W, H) },
    { name: '两点透视', make: () => createPresetCamera('two', W, H) },
    { name: '三点透视（高位地平线）', make: () => createPresetCamera('three', W, H) },
    {
      name: '极端 yaw 0.1°（X VP 在极远处）',
      make: () => ({ ...createPresetCamera('two', W, H), yaw: (0.1 * Math.PI) / 180 }),
    },
    {
      name: '滚转 + 俯仰',
      make: () => ({ ...createPresetCamera('two', W, H), roll: 0.25, pitch: -0.3 }),
    },
    {
      name: '非居中像主点',
      make: () => ({ ...createPresetCamera('three', W, H), principalX: 920, principalY: 180 }),
    },
  ];

  for (const c of cases) {
    it(`${c.name}：12 条盒棱所在直线（齐次）经过对应消失点`, () => {
      const model = c.make();
      const guide = buildGuide(model, W, H);
      const corners = boxCorners(model);

      for (const [ia, ib, axis] of EDGES) {
        const pa = projectToDoc(corners[ia], model);
        const pb = projectToDoc(corners[ib], model);
        const vp = guide.axes[axis].vanishingPoint;
        // 盒棱屏幕直线（齐次叉积）必须经过该轴消失点：
        // 有限 VP → 汇聚共点；无穷远 VP(w=0) → 严格平行。同一条判据覆盖两种情形。
        const line = new THREE.Vector3()
          .crossVectors(
            new THREE.Vector3(pa.x, pa.y, 1),
            new THREE.Vector3(pb.x, pb.y, 1),
          );
        const nl = Math.hypot(line.x, line.y) || 1;
        const residual = line.x * vp[0] + line.y * vp[1] + line.z * vp[2];
        const scale =
          Math.abs(vp[2]) > 1e-9 ? Math.hypot(vp[0] / vp[2], vp[1] / vp[2], 1) : 1;
        expect(Math.abs(residual) / nl / scale, `轴 ${axis} 未对齐`).toBeLessThan(1e-7);
      }
    });
  }

  it('一点透视：水平 X 与竖直 Y 盒棱在屏幕上严格水平/竖直（无穷远 VP）', () => {
    const model = createPresetCamera('one', W, H);
    const corners = boxCorners(model);
    for (const [ia, ib, axis] of EDGES) {
      if (axis === 'z') continue;
      const pa = projectToDoc(corners[ia], model);
      const pb = projectToDoc(corners[ib], model);
      if (axis === 'x') expect(pb.y).toBeCloseTo(pa.y, 7);
      if (axis === 'y') expect(pb.x).toBeCloseTo(pa.x, 7);
    }
  });
});
