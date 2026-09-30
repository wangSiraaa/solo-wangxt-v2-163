import { useEffect, useRef, useState } from 'react';
import { StoreProvider } from './state/store';
import { EditorStage } from './components/EditorStage';
import { ReferenceBoxLayer } from './components/ReferenceBoxLayer';
import { ControlPanel } from './components/ControlPanel';
import { useProject } from './state/store';

function CanvasArea() {
  const project = useProject();
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1000, height: 700 });

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: Math.max(320, r.width), height: Math.max(320, r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="canvas-area" ref={ref}>
      <EditorStage width={size.width} height={size.height} />
      {project.showReferenceBox && (
        <ReferenceBoxLayer width={size.width} height={size.height} />
      )}
      <div className="statusbar">
        <span>缩放 {(project.camera.scale * 100).toFixed(0)}%</span>
        <span>笔画 {project.strokes.length}</span>
        <span>
          {project.snapEnabled ? '吸附开（raw 永久保留）' : '吸附关（仍显示原始笔画，约束数据未删除）'}
        </span>
        <span>{project.crop ? '已裁切（仅影响导出）' : '未裁切'}</span>
        <span className="hint-tip">Shift+拖拽 / 中键 平移 · 滚轮 缩放</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <div className="app">
        <header className="topbar">
          <strong>透视标尺工作室</strong>
          <span className="subtitle">
            齐次坐标消失点 · 无穷远方向不截边 · 相机与裁切分离 · 笔画保留 raw/约束两版
          </span>
        </header>
        <div className="main">
          <ControlPanel />
          <CanvasArea />
        </div>
      </div>
    </StoreProvider>
  );
}
