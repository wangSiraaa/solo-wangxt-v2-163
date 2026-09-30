import type { CameraModel, PerspectiveGuide, PerspectiveMode } from '../types';
import { fromHomogeneous } from '../geometry/homogeneous';
import { focalFromVerticalFov, verticalFovFromFocal } from '../geometry/perspective';

interface CameraPanelProps {
  camera: CameraModel;
  guide: PerspectiveGuide;
  docHeight: number;
  onModeChange: (mode: PerspectiveMode) => void;
  onPatch: (patch: Partial<CameraModel>) => void;
}

const MODES: Array<{ id: PerspectiveMode; label: string }> = [
  { id: 'one', label: '一点透视' },
  { id: 'two', label: '两点透视' },
  { id: 'three', label: '三点透视' },
];

const rad2deg = (r: number) => (r * 180) / Math.PI;
const deg2rad = (d: number) => (d * Math.PI) / 180;

/** 相机参数面板：预设只给初值，所有角度/焦距都可连续调到极端透视。 */
export function CameraPanel({ camera, guide, docHeight, onModeChange, onPatch }: CameraPanelProps) {
  const fovY = rad2deg(verticalFovFromFocal(camera.focal, docHeight));
  // 地平线在像主点上方为「高位」（相机上仰 pitch<0）。
  const horizonY = camera.principalY - camera.focal * Math.tan(camera.pitch);
  const horizonLabel =
    horizonY < camera.principalY
      ? `高位（画面内 ${Math.round(horizonY)}px）`
      : `低位（画面内 ${Math.round(horizonY)}px）`;

  return (
    <section className="panel">
      <h2>透视标尺</h2>
      <div className="mode-row">
        {MODES.map((m) => (
          <button key={m.id} onClick={() => onModeChange(m.id)}>
            {m.label}
          </button>
        ))}
      </div>

      <Slider
        label={`偏航 yaw ${rad2deg(camera.yaw).toFixed(1)}°（90° 时 X 轴无穷远）`}
        min={-89.9}
        max={89.9}
        step={0.1}
        value={rad2deg(camera.yaw)}
        onChange={(v) => onPatch({ yaw: deg2rad(v) })}
      />
      <Slider
        label={`俯仰 pitch ${rad2deg(camera.pitch).toFixed(1)}° — 地平线：${horizonLabel}`}
        min={-89}
        max={89}
        step={0.1}
        value={rad2deg(camera.pitch)}
        onChange={(v) => onPatch({ pitch: deg2rad(v) })}
      />
      <Slider
        label={`滚转 roll ${rad2deg(camera.roll).toFixed(1)}°`}
        min={-45}
        max={45}
        step={0.1}
        value={rad2deg(camera.roll)}
        onChange={(v) => onPatch({ roll: deg2rad(v) })}
      />
      <Slider
        label={`垂直视场 ${fovY.toFixed(1)}°（焦距 ${camera.focal.toFixed(0)}px）`}
        min={5}
        max={170}
        step={1}
        value={fovY}
        onChange={(v) => onPatch({ focal: focalFromVerticalFov(deg2rad(v), docHeight) })}
      />
      <Slider
        label={`像主点 X ${camera.principalX.toFixed(0)}px`}
        min={-400}
        max={1600}
        step={1}
        value={camera.principalX}
        onChange={(v) => onPatch({ principalX: v })}
      />
      <Slider
        label={`像主点 Y ${camera.principalY.toFixed(0)}px`}
        min={-400}
        max={1200}
        step={1}
        value={camera.principalY}
        onChange={(v) => onPatch({ principalY: v })}
      />

      <div className="vp-list">
        <h3>消失点</h3>
        {Object.values(guide.axes).map((axis) => {
          const p = fromHomogeneous(axis.vanishingPoint);
          return (
            <div key={axis.id} className="vp-row">
              <span className="dot" style={{ background: axis.color }} />
              <span>{axis.label}：</span>
              {axis.isInfinite || !p ? (
                <strong>无穷远（平行方向）</strong>
              ) : (
                <span>
                  ({p.x.toFixed(1)}, {p.y.toFixed(1)})
                  {p.x < 0 || p.y < 0 || p.x > guide.width || p.y > guide.height ? ' · 画外' : ''}
                </span>
              )}
            </div>
          );
        })}
        <p className="hint">消失点可远在画布外；无穷远方向按平行线处理，不会截到边缘。</p>
      </div>
    </section>
  );
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
