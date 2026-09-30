import type { Layer } from '../types';

interface LayersPanelProps {
  layers: Layer[];
  activeLayerId: string;
  strokeCounts: Map<string, number>;
  onActiveChange: (id: string) => void;
  onToggleVisible: (id: string, visible: boolean) => void;
  onToggleLocked: (id: string, locked: boolean) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}

export function LayersPanel(props: LayersPanelProps) {
  return (
    <section className="panel">
      <h2>
        图层
        <button className="small" onClick={props.onAdd}>
          + 新画稿层
        </button>
      </h2>
      <ul className="layer-list">
        {[...props.layers].reverse().map((layer) => (
          <li
            key={layer.id}
            className={layer.id === props.activeLayerId ? 'active' : ''}
            onClick={() => !layer.locked && props.onActiveChange(layer.id)}
          >
            <input
              type="checkbox"
              checked={layer.visible}
              onChange={(e) => props.onToggleVisible(layer.id, e.target.checked)}
              title="可见性"
            />
            <span className="layer-name">
              {layer.isGuide ? '📐 ' : '✏️ '}
              {layer.name}
              <em>{props.strokeCounts.get(layer.id) ?? 0}</em>
            </span>
            <button
              className="mini"
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleLocked(layer.id, !layer.locked);
              }}
              title={layer.locked ? '解锁' : '锁定'}
            >
              {layer.locked ? '🔒' : '🔓'}
            </button>
            {!layer.isGuide && (
              <button
                className="mini danger"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onRemove(layer.id);
                }}
                title="删除图层"
              >
                🗑
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
