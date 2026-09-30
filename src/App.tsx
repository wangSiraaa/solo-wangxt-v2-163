import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from './store';
import { Toolbar } from './components/Toolbar';
import { CameraPanel } from './components/CameraPanel';
import { LayersPanel } from './components/LayersPanel';
import { EditorStage } from './components/EditorStage';
import { ReferenceBoxCanvas } from './components/ReferenceBoxCanvas';
import { renderArtworkLayer, renderRulerLayer, canvasToPngBlob, downloadBlob, downloadJson } from './export/render';
import { verifyAllStrokes, verifyHorizon } from './geometry/verify';

export function App() {
  const { state, guide, actions, newProject } = useAppStore();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ width: 900, height: 700});

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setStageSize({ width: Math.floor(r.width), height: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layerVisibility = useMemo(() => {
    const m = new Map<string, boolean>();
    state.project.layers.forEach((l) => m.set(l.id, l.visible));
    return m;
  }, [state.project.layers]);

  const strokeCounts = useMemo(() => {
    const m = new Map<string, number>();
    state.project.strokes.forEach((s) => m.set(s.layerId, (m.get(s.layerId) ?? 0) + 1));
    return m;
  }, [state.project.strokes]);

  const issues = useMemo(
    () => verifyAllStrokes(state.project.strokes, guide),
    [state.project.strokes, guide],
  );
  const horizonOk = useMemo(() => verifyHorizon(guide), [guide]);

  const exportOptions = {
    includeBackground: true,
    annotateVanishingPoints: true,
  };

  const handleExportArt = async () => {
    const { canvas } = renderArtworkLayer({
      strokes: state.project.strokes,
      layers: state.project.layers,
      docWidth: state.project.width,
      docHeight: state.project.height,
      crop: state.project.crop,
      useConstrained: state.snappingEnabled,
      options: exportOptions,
    });
    downloadBlob(await canvasToPngBlob(canvas), `${state.project.name}-画稿.png`);
  };

  // 标尺导出永远是独立文件：画稿与标尺视觉上交叠，但几何与文件都分层。
  const handleExportRuler = async () => {
    const { canvas } = renderRulerLayer({
      guide,
      options: exportOptions,
      fitArtwork: false,
      docWidth: state.project.width,
      docHeight: state.project.height,
    });
    downloadBlob(await canvasToPngBlob(canvas), `${state.project.name}-标尺.png`);
  };

  const handleExportJson = () => {
    downloadJson(
      {
        format: 'perspective-ruler/v1',
        exportedAt: new Date().toISOString(),
        project: state.project,
        verification: {
          horizonOk,
          issues,
        },
      },
      `${state.project.name}.json`,
    );
  };

  return (
    <div className="app">
      <header className="app-header">
        <input
          className="project-name"
          value={state.project.name}
          onChange={(e) => actions.renameProject(e.target.value)}
        />
        <span className={`save-status ${state.saveStatus}`}>
          {state.saveStatus === 'saving' && '保存中…'}
          {state.saveStatus === 'saved' && '已保存到 IndexedDB'}
          {state.saveStatus === 'error' && '保存失败'}
          {state.saveStatus === 'idle' && ''}
        </span>
      </header>
      <Toolbar
        tool={state.tool}
        onToolChange={actions.setTool}
        color={state.color}
        onColorChange={actions.setColor}
        strokeWidth={state.strokeWidth}
        onStrokeWidthChange={actions.setStrokeWidth}
        snappingEnabled={state.snappingEnabled}
        onSnappingChange={actions.setSnapping}
        referenceBoxVisible={state.referenceBoxVisible}
        onReferenceBoxChange={actions.setReferenceBoxVisible}
        onClearCrop={() => actions.setCrop(null)}
        onExport={handleExportArt}
        onExportRuler={handleExportRuler}
        onExportJson={handleExportJson}
        onNewProject={newProject}
      />
      <div className="main">
        <aside className="sidebar">
          <CameraPanel
            camera={state.project.camera}
            guide={guide}
            docHeight={state.project.height}
            onModeChange={actions.setMode}
            onPatch={actions.patchCamera}
          />
          <LayersPanel
            layers={state.project.layers}
            activeLayerId={state.activeLayerId}
            strokeCounts={strokeCounts}
            onActiveChange={actions.setActiveLayer}
            onToggleVisible={(id, visible) => actions.patchLayer(id, { visible })}
            onToggleLocked={(id, locked) => actions.patchLayer(id, { locked })}
            onAdd={actions.addLayer}
            onRemove={actions.removeLayer}
          />
          <section className="panel verify-panel">
            <h2>几何校验</h2>
            <button
              className="resnap"
              onClick={actions.resnapStrokes}
              title="相机参数改变后，依据原始笔画重新计算约束（原始点不变）"
            >
              按当前标尺重新吸附所有笔画
            </button>
            <p className={horizonOk ? 'ok' : 'bad'}>
              {horizonOk ? '✓ 两个水平消失点均在地平线上' : '✗ 地平线校验失败'}
            </p>
            {issues.length === 0 ? (
              <p className="ok">✓ 已约束笔画全部汇向各自消失点（含无穷远平行）</p>
            ) : (
              <ul className="issue-list">
                {issues.map((i) => (
                  <li key={i.strokeId + i.kind} className="bad">
                    {i.message}
                  </li>
                ))}
              </ul>
            )}
            {state.project.crop && (
              <p className="hint">
                裁剪框：{Math.round(state.project.crop.width)}×{Math.round(state.project.crop.height)}
                （独立于相机，改透视不改变裁剪）
              </p>
            )}
          </section>
        </aside>
        <div className="stage-wrap" ref={wrapRef}>
          <EditorStage
            width={stageSize.width}
            height={stageSize.height}
            docWidth={state.project.width}
            docHeight={state.project.height}
            guide={guide}
            view={state.view}
            tool={state.tool}
            color={state.color}
            strokeWidth={state.strokeWidth}
            snappingEnabled={state.snappingEnabled}
            strokes={state.project.strokes}
            layerVisibility={layerVisibility}
            crop={state.project.crop}
            onViewChange={actions.setView}
            onCommitStroke={(points) =>
              actions.addStroke(state.tool === 'freehand' ? 'freehand' : 'segment', points)
            }
            onCommitCrop={actions.setCrop}
          />
          <ReferenceBoxCanvas
            visible={state.referenceBoxVisible}
            camera={state.project.camera}
            width={stageSize.width}
            height={stageSize.height}
          />
        </div>
      </div>
    </div>
  );
}
