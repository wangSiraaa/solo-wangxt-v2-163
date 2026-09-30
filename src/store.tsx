import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import type {
  CameraModel,
  CropRect,
  Layer,
  PerspectiveMode,
  Point2,
  Project,
  Stroke,
  StrokeTool,
  ViewTransform,
} from './types';
import { addArtLayer, createProject } from './storage/project';
import { createPresetCamera } from './geometry/perspective';
import { buildGuide } from './geometry/perspective';
import { snapStroke } from './geometry/snapping';
import { uid } from './geometry/homogeneous';
import { getMeta, getProject, putProject, setMeta } from './storage/db';

export type Tool = 'segment' | 'freehand' | 'pan' | 'crop' | 'vanishing-point';

interface AppState {
  project: Project;
  view: ViewTransform;
  tool: Tool;
  color: string;
  strokeWidth: number;
  snappingEnabled: boolean;
  activeLayerId: string;
  referenceBoxVisible: boolean;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
}

type Action =
  | { type: 'set-project'; project: Project }
  | { type: 'patch-camera'; patch: Partial<CameraModel> }
  | { type: 'set-mode'; mode: PerspectiveMode }
  | { type: 'set-view'; view: ViewTransform }
  | { type: 'set-tool'; tool: Tool }
  | { type: 'set-color'; color: string }
  | { type: 'set-stroke-width'; width: number }
  | { type: 'toggle-snapping'; enabled: boolean }
  | { type: 'toggle-reference-box'; visible: boolean }
  | { type: 'set-active-layer'; id: string }
  | { type: 'add-layer' }
  | { type: 'patch-layer'; id: string; patch: Partial<Layer> }
  | { type: 'remove-layer'; id: string }
  | { type: 'add-stroke'; tool: StrokeTool; points: Point2[] }
  | { type: 'set-crop'; crop: CropRect | null }
  | { type: 'resnap-strokes' }
  | { type: 'rename-project'; name: string }
  | { type: 'set-save-status'; status: AppState['saveStatus'] };

const initialProject = createProject();
const ART_LAYER = initialProject.layers.find((l) => !l.isGuide)!.id;

const initialState: AppState = {
  project: initialProject,
  view: { scale: 1, offsetX: 0, offsetY: 0 },
  tool: 'segment',
  color: '#111111',
  strokeWidth: 2.5,
  snappingEnabled: true,
  activeLayerId: ART_LAYER,
  referenceBoxVisible: false,
  saveStatus: 'idle',
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'set-project':
      return {
        ...state,
        project: action.project,
        activeLayerId:
          action.project.layers.find((l) => !l.isGuide)?.id ?? state.activeLayerId,
      };
    case 'patch-camera':
      return {
        ...state,
        project: {
          ...state.project,
          camera: { ...state.project.camera, ...action.patch },
          updatedAt: Date.now(),
        },
      };
    case 'set-mode': {
      // 预设模式只改相机，保留像主点与焦距（相机与视图/裁剪解耦）。
      const preset = createPresetCamera(action.mode, state.project.width, state.project.height);
      return {
        ...state,
        project: {
          ...state.project,
          camera: {
            ...preset,
            focal: state.project.camera.focal,
            principalX: state.project.camera.principalX,
            principalY: state.project.camera.principalY,
          },
          updatedAt: Date.now(),
        },
      };
    }
    case 'set-view':
      return { ...state, view: action.view };
    case 'set-tool':
      return { ...state, tool: action.tool };
    case 'set-color':
      return { ...state, color: action.color };
    case 'set-stroke-width':
      return { ...state, strokeWidth: action.width };
    case 'toggle-snapping':
      // 只切开关：笔画的 raw / constrained 数据都保留，关闭后渲染 raw，不丢笔画。
      return { ...state, snappingEnabled: action.enabled };
    case 'toggle-reference-box':
      return { ...state, referenceBoxVisible: action.visible };
    case 'set-active-layer':
      return { ...state, activeLayerId: action.id };
    case 'add-layer': {
      const project = addArtLayer(state.project);
      return { ...state, project, activeLayerId: project.layers[project.layers.length - 1].id };
    }
    case 'patch-layer':
      return {
        ...state,
        project: {
          ...state.project,
          layers: state.project.layers.map((l) =>
            l.id === action.id ? { ...l, ...action.patch } : l,
          ),
          updatedAt: Date.now(),
        },
      };
    case 'remove-layer': {
      if (action.id === state.project.layers.find((l) => l.isGuide)?.id) return state;
      const layers = state.project.layers.filter((l) => l.id !== action.id);
      const strokes = state.project.strokes.filter((s) => s.layerId !== action.id);
      return {
        ...state,
        project: { ...state.project, layers, strokes, updatedAt: Date.now() },
        activeLayerId:
          state.activeLayerId === action.id
            ? layers.find((l) => !l.isGuide)?.id ?? state.activeLayerId
            : state.activeLayerId,
      };
    }
    case 'add-stroke': {
      const guide = buildGuide(state.project.camera, state.project.width, state.project.height);
      // 吸附在入栈时一次性计算；关闭吸附时仍存约束结果（若有），随时可切回。
      const snap = state.snappingEnabled
        ? snapStroke(action.points, action.tool, guide.axes)
        : null;
      const stroke: Stroke = {
        id: uid(),
        layerId: state.activeLayerId,
        tool: action.tool,
        color: state.color,
        strokeWidth: state.strokeWidth,
        rawPoints: action.points,
        constrainedPoints: snap?.constrained ?? null,
        snappedAxis: snap?.axis ?? null,
        createdAt: Date.now(),
      };
      return {
        ...state,
        project: {
          ...state.project,
          strokes: [...state.project.strokes, stroke],
          updatedAt: Date.now(),
        },
      };
    }
    case 'set-crop':
      return {
        ...state,
        project: { ...state.project, crop: action.crop, updatedAt: Date.now() },
      };
    case 'resnap-strokes': {
      // 相机变化后用原始点重新计算约束；吸附不到的笔画清除约束标记，
      // rawPoints 永不修改 —— 「保留原始与约束版本」在重算时同样成立。
      const guide = buildGuide(state.project.camera, state.project.width, state.project.height);
      const strokes = state.project.strokes.map((s) => {
        const snap = snapStroke(s.rawPoints, s.tool, guide.axes);
        return {
          ...s,
          constrainedPoints: snap?.constrained ?? null,
          snappedAxis: snap?.axis ?? null,
        };
      });
      return {
        ...state,
        project: { ...state.project, strokes, updatedAt: Date.now() },
      };
    }
    case 'rename-project':
      return {
        ...state,
        project: { ...state.project, name: action.name, updatedAt: Date.now() },
      };
    case 'set-save-status':
      return { ...state, saveStatus: action.status };
  }
}

const LAST_PROJECT_KEY = 'lastProjectId';
const SAVE_DEBOUNCE_MS = 600;

export function useAppStore() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const loadedRef = useRef(false);

  // 启动时恢复上次工程（IndexedDB，无后端）。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const lastId = await getMeta<string>(LAST_PROJECT_KEY);
      if (lastId) {
        const project = await getProject<Project>(lastId);
        if (project && !cancelled) dispatch({ type: 'set-project', project });
      }
      loadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 防抖自动保存：相机、笔画、裁剪、图层全部在同一份文档里。
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!loadedRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    dispatch({ type: 'set-save-status', status: 'saving' });
    saveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          await putProject(state.project);
          await setMeta(LAST_PROJECT_KEY, state.project.id);
          dispatch({ type: 'set-save-status', status: 'saved' });
        } catch {
          dispatch({ type: 'set-save-status', status: 'error' });
        }
      })();
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [state.project]);

  const guide = useMemo(
    () => buildGuide(state.project.camera, state.project.width, state.project.height),
    [state.project.camera, state.project.width, state.project.height],
  );

  const actions = useMemo(
    () => ({
      setProject: (project: Project) => dispatch({ type: 'set-project', project }),
      patchCamera: (patch: Partial<CameraModel>) => dispatch({ type: 'patch-camera', patch }),
      setMode: (mode: PerspectiveMode) => dispatch({ type: 'set-mode', mode }),
      setView: (view: ViewTransform) => dispatch({ type: 'set-view', view }),
      setTool: (tool: Tool) => dispatch({ type: 'set-tool', tool }),
      setColor: (color: string) => dispatch({ type: 'set-color', color }),
      setStrokeWidth: (width: number) => dispatch({ type: 'set-stroke-width', width }),
      setSnapping: (enabled: boolean) => dispatch({ type: 'toggle-snapping', enabled }),
      setReferenceBoxVisible: (visible: boolean) =>
        dispatch({ type: 'toggle-reference-box', visible }),
      setActiveLayer: (id: string) => dispatch({ type: 'set-active-layer', id }),
      addLayer: () => dispatch({ type: 'add-layer' }),
      patchLayer: (id: string, patch: Partial<Layer>) =>
        dispatch({ type: 'patch-layer', id, patch }),
      removeLayer: (id: string) => dispatch({ type: 'remove-layer', id }),
      addStroke: (tool: StrokeTool, points: Point2[]) =>
        dispatch({ type: 'add-stroke', tool, points }),
      setCrop: (crop: CropRect | null) => dispatch({ type: 'set-crop', crop }),
      resnapStrokes: () => dispatch({ type: 'resnap-strokes' }),
      renameProject: (name: string) => dispatch({ type: 'rename-project', name }),
    }),
    [],
  );

  // 测试与「新建」入口复用
  const newProject = useCallback(() => {
    dispatch({ type: 'set-project', project: createProject() });
  }, []);

  return { state, guide, actions, newProject };
}
