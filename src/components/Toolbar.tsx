import type { Tool } from '../store';

interface ToolbarProps {
  tool: Tool;
  onToolChange: (tool: Tool) => void;
  color: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  snappingEnabled: boolean;
  onSnappingChange: (enabled: boolean) => void;
  referenceBoxVisible: boolean;
  onReferenceBoxChange: (visible: boolean) => void;
  onClearCrop: () => void;
  onExport: () => void;
  onExportRuler: () => void;
  onExportJson: () => void;
  onNewProject: () => void;
}

const TOOLS: Array<{ id: Tool; label: string }> = [
  { id: 'segment', label: '直线' },
  { id: 'freehand', label: '自由笔画' },
  { id: 'pan', label: '平移' },
  { id: 'crop', label: '裁剪' },
];

export function Toolbar(props: ToolbarProps) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={props.tool === t.id ? 'active' : ''}
            onClick={() => props.onToolChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="toolbar-group">
        <label className="inline">
          颜色
          <input
            type="color"
            value={props.color}
            onChange={(e) => props.onColorChange(e.target.value)}
          />
        </label>
        <label className="inline">
          粗细 {props.strokeWidth.toFixed(1)}
          <input
            type="range"
            min={0.5}
            max={12}
            step={0.5}
            value={props.strokeWidth}
            onChange={(e) => props.onStrokeWidthChange(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="toolbar-group">
        <label className="inline toggle">
          <input
            type="checkbox"
            checked={props.snappingEnabled}
            onChange={(e) => props.onSnappingChange(e.target.checked)}
          />
          吸附
        </label>
        <label className="inline toggle">
          <input
            type="checkbox"
            checked={props.referenceBoxVisible}
            onChange={(e) => props.onReferenceBoxChange(e.target.checked)}
          />
          参考盒
        </label>
      </div>
      <div className="toolbar-group">
        <button onClick={props.onClearCrop}>清除裁剪</button>
        <button onClick={props.onExport}>导出画稿 PNG</button>
        <button onClick={props.onExportRuler}>导出标尺 PNG</button>
        <button onClick={props.onExportJson}>导出工程 JSON</button>
        <button onClick={props.onNewProject}>新建</button>
      </div>
    </div>
  );
}
