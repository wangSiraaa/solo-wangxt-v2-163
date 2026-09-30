import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type {
  Camera,
  CropRect,
  Point2,
  Project,
  Ruler,
} from '../types';
import { RULER_PRESETS } from '../lib/perspective/rulers';
import { classifyStroke, constrainStroke } from '../lib/geometry/snap';
import { fitCamera } from '../lib/viewport';
import { listProjects, loadProject, makeId, saveProject } from '../lib/storage/idb';

/**
 * 全局工程状态（React + TS 管理图层与开关）。
 * 约束点不存状态：由 strokes[i].raw + strokes[i].axes + ruler 用 useMemo 派生，
 * 因此切换 snapEnabled、改标尺都不会丢失原始笔画。
 */

const DOC_W = 1200;
const DOC_H = 800;

export type Tool = 'pen' | 'pan' | 'crop' | 'vp';

export interface State {
  project: Project;
  tool: Tool;
  toleranceDeg: number;
  color: string;
  width: number;
  saveState: 'idle' | 'saving' | 'saved' | 'error';
}

export type Action =
  | { type: 'applyPreset'; ruler: Ruler }
  | { type: 'setRuler'; ruler: Ruler }
  | { type: 'beginStroke'; id: string; point: Point2 }
  | { type: 'extendStroke'; point: Point2 }
  | { type: 'endStroke' }
  | { type: 'undoStroke' }
  | { type: 'clearStrokes' }
  | { type: 'deleteStroke'; id: string }
  | { type: 'setCamera'; camera: Camera }
  | { type: 'setCrop'; crop: CropRect | null }
  | { type: 'toggleSnap'; enabled: boolean }
  | { type: 'toggleRuler'; show: boolean }
  | { type: 'toggleReferenceBox'; show: boolean }
  | { type: 'setTool'; tool: Tool }
  | { type: 'setStyle'; color?: string; width?: number }
  | { type: 'setTolerance'; toleranceDeg: number }
  | { type: 'rename'; name: string }
  | { type: 'load'; project: Project }
  | { type: 'newProject' }
  | { type: 'markSaved' };

export function initialProject(): Project {
  return {
    id: makeId(),
    name: '未命名工程',
    width: DOC_W,
    height: DOC_H,
    ruler: RULER_PRESETS[0].build(DOC_W, DOC_H),
    strokes: [],
    camera: { scale: 1, offsetX: 0, offsetY: 0 },
    crop: null,
    snapEnabled: true,
    showRuler: true,
    showReferenceBox: false,
    updatedAt: Date.now(),
  };
}

/** 老版本存档补字段（向前兼容），保证 raw/axes 原样保留。 */
function migrate(p: Project): Project {
  const rotation = p.ruler.rotation ?? { pan: 0, tilt: 0 };
  return {
    ...p,
    ruler: { ...p.ruler, rotation },
    camera: p.camera ?? { scale: 1, offsetX: 0, offsetY: 0 },
    crop: p.crop ?? null,
    snapEnabled: p.snapEnabled ?? true,
    showRuler: p.showRuler ?? true,
    showReferenceBox: p.showReferenceBox ?? false,
  };
}

export function reducer(state: State, action: Action): State {
  const p = state.project;
  switch (action.type) {
    case 'applyPreset':
    case 'setRuler':
      return { ...state, project: { ...p, ruler: action.ruler, updatedAt: Date.now() } };

    case 'beginStroke':
      return {
        ...state,
        project: {
          ...p,
          strokes: [
            ...p.strokes,
            {
              id: action.id,
              color: state.color,
              width: state.width,
              raw: [action.point],
              axes: [],
              createdAt: Date.now(),
            },
          ],
          updatedAt: Date.now(),
        },
      };

    case 'extendStroke': {
      const strokes = [...p.strokes];
      const last = strokes[strokes.length - 1];
      if (!last) return state;
      const raw = [...last.raw, action.point];
      // 实时分类（不写约束点；约束永远派生）
      const axes = classifyStroke(raw, p.ruler, state.toleranceDeg);
      strokes[strokes.length - 1] = { ...last, raw, axes };
      return { ...state, project: { ...p, strokes, updatedAt: Date.now() } };
    }

    case 'endStroke': {
      // 丢弃过短的误画（单个点），但正常笔画的 raw/axes 全部保留
      const strokes = p.strokes.filter((s) => s.raw.length >= 2);
      return { ...state, project: { ...p, strokes, updatedAt: Date.now() } };
    }

    case 'undoStroke':
      return {
        ...state,
        project: { ...p, strokes: p.strokes.slice(0, -1), updatedAt: Date.now() },
      };

    case 'clearStrokes':
      return { ...state, project: { ...p, strokes: [], updatedAt: Date.now() } };

    case 'deleteStroke':
      return {
        ...state,
        project: {
          ...p,
          strokes: p.strokes.filter((s) => s.id !== action.id),
          updatedAt: Date.now(),
        },
      };

    case 'setCamera':
      return { ...state, project: { ...p, camera: action.camera } };

    case 'setCrop':
      return { ...state, project: { ...p, crop: action.crop, updatedAt: Date.now() } };

    case 'toggleSnap':
      return { ...state, project: { ...p, snapEnabled: action.enabled } };

    case 'toggleRuler':
      return { ...state, project: { ...p, showRuler: action.show } };

    case 'toggleReferenceBox':
      return { ...state, project: { ...p, showReferenceBox: action.show } };

    case 'setTool':
      return { ...state, tool: action.tool };

    case 'setStyle':
      return {
        ...state,
        color: action.color ?? state.color,
        width: action.width ?? state.width,
      };

    case 'setTolerance':
      return { ...state, toleranceDeg: action.toleranceDeg };

    case 'rename':
      return { ...state, project: { ...p, name: action.name } };

    case 'load':
      return { ...state, project: action.project };

    case 'newProject':
      return { ...state, project: initialProject() };

    case 'markSaved':
      return state.saveState === 'saving' ? { ...state, saveState: 'saved' } : state;

    default:
      return state;
  }
}

export interface Store {
  state: State;
  dispatch: React.Dispatch<Action>;
  /** strokeId -> 约束点（snap 关闭时也照样计算，只是不显示）。 */
  constrained: Map<string, Point2[]>;
}

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({
  children,
  initial,
  viewport,
}: {
  children: ReactNode;
  initial?: Project;
  viewport?: { width: number; height: number };
}) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    project: initial ?? initialProject(),
    tool: 'pen' as Tool,
    toleranceDeg: 12,
    color: '#111111',
    width: 3,
    saveState: 'idle' as const,
  }));

  // 未显式传入工程时，从 IndexedDB 恢复最近一个工程（无后端）
  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    listProjects()
      .then(async (metas) => {
        if (cancelled || metas.length === 0) return;
        const loaded = await loadProject(metas[0].id);
        if (!cancelled && loaded) dispatch({ type: 'load', project: migrate(loaded) });
      })
      .catch((e) => console.warn('读取本地工程失败', e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初始相机适配（与裁切无关；只影响观察）
  const fittedRef = useRef(false);
  useEffect(() => {
    if (!fittedRef.current && viewport && !initial) {
      fittedRef.current = true;
      dispatch({
        type: 'setCamera',
        camera: fitCamera(
          state.project.camera,
          { width: state.project.width, height: state.project.height },
          viewport,
        ),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewport?.width, viewport?.height]);

  // 约束点派生：纯 memo，不修改 strokes
  const constrained = useMemo(() => {
    const m = new Map<string, Point2[]>();
    for (const s of state.project.strokes) {
      m.set(s.id, constrainStroke(s.raw, s.axes, state.project.ruler));
    }
    return m;
  }, [state.project.strokes, state.project.ruler]);

  // 自动保存到 IndexedDB（防抖）。保存的是 raw + axes，不含派生约束点。
  const saveTimer = useRef<number | undefined>(undefined);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveProject(state.project).catch((e) => console.error('自动保存失败', e));
    }, 600);
  }, [state.project]);

  const value = useMemo(
    () => ({ state, dispatch, constrained }),
    [state, constrained],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore 必须在 StoreProvider 内使用');
  return ctx;
}

/** 供外部（如"打开工程"）使用的选择器便捷钩子。 */
export function useProject(): Project {
  return useStore().state.project;
}
