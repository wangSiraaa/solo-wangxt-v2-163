import type { Layer, Project } from '../types';
import { createPresetCamera } from '../geometry/perspective';
import { uid } from '../geometry/homogeneous';

const GUIDE_LAYER: Layer = {
  id: 'layer-guide',
  name: '透视标尺',
  visible: true,
  locked: true,
  isGuide: true,
};

const ART_LAYER: Layer = {
  id: 'layer-art',
  name: '画稿',
  visible: true,
  locked: false,
  isGuide: false,
};

export const DEFAULT_DOC_WIDTH = 1200;
export const DEFAULT_DOC_HEIGHT = 800;

export function createProject(name = '未命名工程'): Project {
  const width = DEFAULT_DOC_WIDTH;
  const height = DEFAULT_DOC_HEIGHT;
  const now = Date.now();
  return {
    id: uid(),
    name,
    width,
    height,
    camera: createPresetCamera('two', width, height),
    layers: [{ ...GUIDE_LAYER }, { ...ART_LAYER }],
    strokes: [],
    crop: null,
    updatedAt: now,
  };
}

export function addArtLayer(project: Project, name?: string): Project {
  const layer: Layer = {
    id: uid(),
    name: name ?? `画稿 ${project.layers.filter((l) => !l.isGuide).length + 1}`,
    visible: true,
    locked: false,
    isGuide: false,
  };
  return { ...project, layers: [...project.layers, layer], updatedAt: Date.now() };
}
