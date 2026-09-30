import { useStore } from '../state/store';
import { RULER_PRESETS, validateRuler } from '../lib/perspective/rulers';
import { downloadCanvas, exportLayers } from '../lib/export/exportLayers';
import { finite, toEuclidean, toDirection } from '../lib/geometry/homogeneous';
import { AXIS_COLORS, AXIS_NAMES } from '../types';
import { RulerAdjustPanel } from './RulerAdjustPanel';

/** 左侧工具栏与标尺/导出控制面板。 */
export function ControlPanel() {
  const { state, dispatch } = useStore();
  const { project: p, tool, toleranceDeg } = state;
  const rulerProblems = validateRuler(p.ruler);

  return (
    <aside className="panel">
      <section className="group">
        <h2>工程</h2>
        <input
          className="text-input"
          value={p.name}
          onChange={(e) => dispatch({ type: 'rename', name: e.target.value })}
        />
        <div className="row">
          <button onClick={() => dispatch({ type: 'newProject' })}>新建</button>
          <button onClick={() => dispatch({ type: 'clearStrokes' })}>清空笔画</button>
        </div>
        <div className="hint">自动保存到 IndexedDB · 无后端 · Ctrl/⌘+Z 撤销</div>
      </section>

      <section className="group">
        <h2>工具</h2>
        <div className="row">
          <button className={tool === 'pen' ? 'active' : ''} onClick={() => dispatch({ type: 'setTool', tool: 'pen' })}>
            画笔
          </button>
          <button className={tool === 'pan' ? 'active' : ''} onClick={() => dispatch({ type: 'setTool', tool: 'pan' })}>
            平移
          </button>
          <button className={tool === 'crop' ? 'active' : ''} onClick={() => dispatch({ type: 'setTool', tool: 'crop' })}>
            裁切
          </button>
        </div>
        <div className="row">
          <label>颜色</label>
          <input
            type="color"
            value={state.color}
            onChange={(e) => dispatch({ type: 'setStyle', color: e.target.value })}
          />
          <label>粗细</label>
          <input
            type="range"
            min={1}
            max={20}
            value={state.width}
            onChange={(e) => dispatch({ type: 'setStyle', width: Number(e.target.value) })}
          />
        </div>
      </section>

      <section className="group">
        <h2>透视标尺</h2>
        <div className="preset-grid">
          {RULER_PRESETS.map((preset) => (
            <button
              key={preset.id}
              title={preset.description}
              onClick={() =>
                dispatch({ type: 'applyPreset', ruler: preset.build(p.width, p.height) })
              }
            >
              {preset.label}
            </button>
          ))}
        </div>

        <RulerAdjustPanel />

        <label className="check">
          <input
            type="checkbox"
            checked={p.snapEnabled}
            onChange={(e) => dispatch({ type: 'toggleSnap', enabled: e.target.checked })}
          />
          方向吸附
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={p.showRuler}
            onChange={(e) => dispatch({ type: 'toggleRuler', show: e.target.checked })}
          />
          显示标尺层
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={p.showReferenceBox}
            onChange={(e) =>
              dispatch({ type: 'toggleReferenceBox', show: e.target.checked })
            }
          />
          Three.js 参考盒
        </label>

        <div className="slider-row">
          <span>吸附容差</span>
          <input
            type="range"
            min={1}
            max={45}
            value={toleranceDeg}
            onChange={(e) => dispatch({ type: 'setTolerance', toleranceDeg: Number(e.target.value) })}
          />
          <span>{toleranceDeg}°</span>
        </div>

        {rulerProblems.length > 0 && (
          <div className="warning">
            {rulerProblems.map((m) => (
              <div key={m}>⚠ {m}</div>
            ))}
          </div>
        )}

        <div className="vp-list">
          {p.ruler.axes.map((vp, i) => (
            <div className="vp-item" key={i}>
              <span className="dot" style={{ background: AXIS_COLORS[i] }} />
              <span>{AXIS_NAMES[i]}：</span>
              {finite(vp) ? (
                <span className="mono">
                  VP ({Math.round(toEuclidean(vp).x)}, {Math.round(toEuclidean(vp).y)})
                </span>
              ) : (
                <span className="mono">
                  ∞ 方向 ({toDirection(vp).x.toFixed(2)}, {toDirection(vp).y.toFixed(2)})
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="group">
        <h2>裁切（与相机分离）</h2>
        <div className="row">
          {p.crop ? (
            <>
              <span className="mono small">
                {Math.round(p.crop.x)}, {Math.round(p.crop.y)} · {Math.round(p.crop.w)}×
                {Math.round(p.crop.h)}
              </span>
              <button onClick={() => dispatch({ type: 'setCrop', crop: null })}>
                取消裁切
              </button>
            </>
          ) : (
            <span className="hint">选择"裁切"工具后在画布上拖框</span>
          )}
        </div>
      </section>

      <section className="group">
        <h2>分层导出</h2>
        <div className="row wrap">
          <button
            onClick={() => {
              const r = exportLayers(p, {
                version: 'constrained',
                useCrop: Boolean(p.crop),
                pixelRatio: 2,
                background: '#ffffff',
              });
              downloadCanvas(r.artwork, `${p.name}-画稿层.png`);
            }}
          >
            画稿层（约束后）
          </button>
          <button
            onClick={() => {
              const r = exportLayers(p, {
                version: 'raw',
                useCrop: Boolean(p.crop),
                pixelRatio: 2,
                background: '#ffffff',
              });
              downloadCanvas(r.artwork, `${p.name}-原始稿.png`);
            }}
          >
            画稿层（原始 raw）
          </button>
          <button
            onClick={() => {
              const r = exportLayers(p, {
                version: 'constrained',
                useCrop: Boolean(p.crop),
                pixelRatio: 2,
              });
              downloadCanvas(r.ruler, `${p.name}-标尺层.png`);
            }}
          >
            标尺层
          </button>
          <button
            onClick={() => {
              const r = exportLayers(p, {
                version: 'constrained',
                useCrop: Boolean(p.crop),
                colorByAxis: true,
                pixelRatio: 2,
                background: '#ffffff',
              });
              downloadCanvas(r.merged, `${p.name}-合并(按轴着色).png`);
            }}
          >
            合并（按轴着色）
          </button>
          <button
            onClick={() => {
              const r = exportLayers(p, {
                version: 'constrained',
                useCrop: Boolean(p.crop),
                pixelRatio: 2,
                background: '#ffffff',
              });
              downloadCanvas(r.merged, `${p.name}-合并.png`);
            }}
          >
            合并导出
          </button>
        </div>
      </section>
    </aside>
  );
}
