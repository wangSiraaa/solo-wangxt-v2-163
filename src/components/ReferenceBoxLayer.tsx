import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useProject } from '../state/store';
import {
  basisFromRotation,
  applyToThreeCamera,
  applyProjectionWithPrincipal,
  toThreeVec,
} from '../lib/perspective/camera3d';
import { worldToScreen } from '../lib/viewport';

/**
 * Three.js 可选参考盒。
 * 与 Konva 画稿共享同一屏幕矩形、同一针孔参数（pan/tilt/focal/principal），
 * 使盒的 12 条棱在屏幕上精确指向三个消失点。
 * 盒只做参考显示，不参与笔画编辑；裁剪、相机缩放都不改变它的世界几何，
 * 只通过投影位置与标尺对齐。
 */
export function ReferenceBoxLayer({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const project = useProject();
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const boxRef = useRef<THREE.LineSegments | null>(null);

  const basis = useMemo(
    () => basisFromRotation(project.ruler.rotation),
    [project.ruler.rotation],
  );

  // 参考盒放在视线前方、文档主点对应的深度处
  const boxCenter = useMemo<[number, number, number]>(() => {
    const d = project.ruler.focal * 1.1;
    return [d * basis.e2[0], d * basis.e2[1], d * basis.e2[2]];
  }, [basis, project.ruler.focal]);

  useEffect(() => {
    const mount = mountRef.current!;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.position = 'absolute';
    renderer.domElement.style.inset = '0';
    renderer.domElement.style.pointerEvents = 'none';
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, width / height, 1, 1e7);

    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(240, 240, 240)),
      new THREE.LineBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.85 }),
    );
    scene.add(box);

    rendererRef.current = renderer;
    cameraRef.current = camera;
    sceneRef.current = scene;
    boxRef.current = box;

    return () => {
      renderer.dispose();
      box.geometry.dispose();
      (box.material as THREE.Material).dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const renderer = rendererRef.current;
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    const box = boxRef.current;
    if (!renderer || !camera || !scene || !box) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    applyToThreeCamera(camera, basis, [0, 0, 0], project.height, project.ruler.focal);
    // 主点与焦距换算到当前屏幕（相机缩放/平移后仍与 Konva 标尺像素对齐）
    const principalScreen = worldToScreen(project.camera, project.ruler.principal);
    applyProjectionWithPrincipal(
      camera,
      project.ruler.focal * project.camera.scale,
      principalScreen,
      width,
      height,
    );
    box.position.copy(toThreeVec(boxCenter));
    renderer.render(scene, camera);
  }, [
    width,
    height,
    basis,
    boxCenter,
    project.height,
    project.ruler.focal,
    project.ruler.principal,
    project.camera,
  ]);

  return (
    <div
      ref={mountRef}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    />
  );
}
