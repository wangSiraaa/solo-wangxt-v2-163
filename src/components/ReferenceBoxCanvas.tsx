import { useEffect, useRef } from 'react';
import type { CameraModel } from '../types';
import { ReferenceBoxOverlay } from '../three/ReferenceBox';

interface ReferenceBoxCanvasProps {
  visible: boolean;
  camera: CameraModel;
  width: number;
  height: number;
}

/** Three.js 透明画布，与 Konva 舞台像素对齐叠加；显示与否不影响画稿数据。 */
export function ReferenceBoxCanvas({ visible, camera, width, height }: ReferenceBoxCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<ReferenceBoxOverlay | null>(null);

  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    const overlay = new ReferenceBoxOverlay(canvasRef.current, width, height);
    overlayRef.current = overlay;
    overlay.update(camera);
    return () => {
      overlay.dispose();
      overlayRef.current = null;
    };
    // 仅在显示开关或尺寸变化时创建；相机变化走下面的 effect。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, width, height]);

  useEffect(() => {
    overlayRef.current?.update(camera);
  }, [camera, visible]);

  if (!visible) return null;
  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        width,
        height,
      }}
    />
  );
}
