import * as THREE from 'three';
import type { AxisId, CameraModel } from '../types';
import { cameraBasis, verticalFovFromFocal } from '../geometry/perspective';

/**
 * 可选的 Three.js 参考盒叠加层。
 *
 * 立方体顶点不依赖 Three 自带的相机旋转约定，而是直接用透视模块的
 * cameraBasis() 把立方体变换到相机坐标，再换算到 Three 相机系
 * （x 右、y 上、z 朝后）：(x3, y3, z3) = (x', -y'_down, -z'_front)。
 * 这样盒棱在屏幕上的汇聚方向与 2D 标尺消失点严格一致（有测试校验）。
 */
export class ReferenceBoxOverlay {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private box: THREE.LineSegments | null = null;
  private width: number;
  private height: number;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.width = width;
    this.height = height;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 100);
    this.camera.position.set(0, 0, 0);
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** 按相机模型重建参考盒。boxCenter/boxSize 以相机系前方深度给出。 */
  update(model: CameraModel, boxSize = 1, boxDistance = 2.2): void {
    if (this.box) {
      this.scene.remove(this.box);
      this.box.geometry.dispose();
      this.box = null;
    }

    const fovY = verticalFovFromFocal(model.focal, this.height);
    this.camera.fov = (fovY * 180) / Math.PI;
    this.camera.aspect = this.width / this.height;
    // 像主点偏离画面中心时，用 view offset 平移投影窗。
    this.camera.setViewOffset(
      this.width,
      this.height,
      model.principalX - this.width / 2,
      model.principalY - this.height / 2,
      this.width,
      this.height,
    );
    this.camera.updateProjectionMatrix();

    const basis = cameraBasis(model);
    const rCols: Record<AxisId, THREE.Vector3> = {
      x: new THREE.Vector3(basis.x.x, -basis.x.y, -basis.x.z),
      y: new THREE.Vector3(basis.y.x, -basis.y.y, -basis.y.z),
      z: new THREE.Vector3(basis.z.x, -basis.z.y, -basis.z.z),
    };
    // 文档系 y 向下的滚转对应 Three 系（y 向上）绕 z 的反向角。
    const rollQ = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1),
      -model.roll,
    );
    for (const key of ['x', 'y', 'z'] as AxisId[]) rCols[key].applyQuaternion(rollQ);

    const center = new THREE.Vector3(0, 0, -boxDistance);
    const corners: THREE.Vector3[] = [];
    for (let ix = 0; ix < 2; ix++) {
      for (let iy = 0; iy < 2; iy++) {
        for (let iz = 0; iz < 2; iz++) {
          const sx = ix - 0.5;
          const sy = iy - 0.5;
          const sz = iz - 0.5;
          const p = center
            .clone()
            .addScaledVector(rCols.x, sx * boxSize)
            .addScaledVector(rCols.y, sy * boxSize)
            .addScaledVector(rCols.z, sz * boxSize);
          corners.push(p);
        }
      }
    }

    const edges: Array<[number, number]> = [
      [0, 1], [2, 3], [4, 5], [6, 7],
      [0, 2], [1, 3], [4, 6], [5, 7],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    const positions: number[] = [];
    for (const [a, b] of edges) {
      positions.push(corners[a].x, corners[a].y, corners[a].z);
      positions.push(corners[b].x, corners[b].y, corners[b].z);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xffb224,
      transparent: true,
      opacity: 0.9,
    });
    this.box = new THREE.LineSegments(geom, mat);
    this.scene.add(this.box);
    this.render();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    if (this.box) this.box.geometry.dispose();
    this.renderer.dispose();
  }
}
