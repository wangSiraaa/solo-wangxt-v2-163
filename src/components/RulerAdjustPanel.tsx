import { useStore } from '../state/store';
import { rulerFromRotation } from '../lib/perspective/camera3d';

const DEG = 180 / Math.PI;

/**
 * 标尺相机参数微调。
 * - pan/tilt 跨越 0 / 90° 时 VP 自然在有限与无穷远之间切换（W 分量变化），
 *   UI 不做任何"截到边缘"处理；
 * - 主点 y 可拖到画框外（高位/低位地平线）。
 */
export function RulerAdjustPanel() {
  const { state, dispatch } = useStore();
  const { ruler, width: w, height: h } = state.project;
  const { pan, tilt } = ruler.rotation;

  function rebuild(patch: { pan?: number; tilt?: number; focal?: number; py?: number }) {
    const next = rulerFromRotation(
      ruler.kind,
      {
        pan: patch.pan ?? pan,
        tilt: patch.tilt ?? tilt,
      },
      patch.focal ?? ruler.focal,
      {
        x: ruler.principal.x,
        y: patch.py ?? ruler.principal.y,
      },
    );
    dispatch({ type: 'setRuler', ruler: next });
  }

  return (
    <div className="adjust">
      <div className="slider-row">
        <span>水平 yaw</span>
        <input
          type="range"
          min={-89}
          max={89}
          step={0.5}
          value={pan * DEG}
          onChange={(e) => rebuild({ pan: Number(e.target.value) / DEG })}
        />
        <span>{(pan * DEG).toFixed(1)}°</span>
      </div>
      <div className="slider-row">
        <span>俯仰 tilt</span>
        <input
          type="range"
          min={-89}
          max={89}
          step={0.5}
          value={tilt * DEG}
          onChange={(e) => rebuild({ tilt: Number(e.target.value) / DEG })}
          disabled={ruler.kind === 1}
        />
        <span>{(tilt * DEG).toFixed(1)}°</span>
      </div>
      <div className="slider-row">
        <span>焦距 f</span>
        <input
          type="range"
          min={Math.min(w, h) * 0.2}
          max={Math.min(w, h) * 6}
          step={1}
          value={ruler.focal}
          onChange={(e) => rebuild({ focal: Number(e.target.value) })}
        />
        <span>{Math.round(ruler.focal)}</span>
      </div>
      <div className="slider-row">
        <span>主点 y</span>
        <input
          type="range"
          min={-h * 0.2}
          max={h * 1.2}
          step={1}
          value={ruler.principal.y}
          onChange={(e) => rebuild({ py: Number(e.target.value) })}
        />
        <span>{Math.round(ruler.principal.y)}</span>
      </div>
      <div className="row">
        <button
          onClick={() =>
            dispatch({
              type: 'setRuler',
              ruler: rulerFromRotation(1, { pan: 0, tilt: 0 }, ruler.focal, ruler.principal),
            })
          }
          className={ruler.kind === 1 ? 'active' : ''}
        >
          一点
        </button>
        <button
          onClick={() =>
            dispatch({
              type: 'setRuler',
              ruler: rulerFromRotation(2, { pan: pan || 0.6, tilt: 0 }, ruler.focal, ruler.principal),
            })
          }
          className={ruler.kind === 2 ? 'active' : ''}
        >
          两点
        </button>
        <button
          onClick={() =>
            dispatch({
              type: 'setRuler',
              ruler: rulerFromRotation(
                3,
                { pan: pan || 0.7, tilt: tilt || -0.5 },
                ruler.focal,
                ruler.principal,
              ),
            })
          }
          className={ruler.kind === 3 ? 'active' : ''}
        >
          三点
        </button>
      </div>
    </div>
  );
}
