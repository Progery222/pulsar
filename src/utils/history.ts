import { useProjectStore, type ProjectState } from '../store/projectStore';

// Undo (Ctrl+Z, §13): снимок ключевых полей ProjectState перед каждым изменением.
type Snap = Partial<ProjectState>;

const KEYS: (keyof ProjectState)[] = [
  'generatedClips',
  'activeEffects',
  'activeFilter',
  'filterIntensity',
  'mood',
  'duration',
  'format',
  'fade',
  'segmentStart',
  'selectedTrack',
  'mediaFiles',
  'mediaOrder',
];

let past: Snap[] = [];
let restoring = false;
let inited = false;

function pick(s: ProjectState): Snap {
  const o: Snap = {};
  for (const k of KEYS) (o as Record<string, unknown>)[k] = s[k];
  return o;
}

function changed(a: ProjectState, b: ProjectState): boolean {
  return KEYS.some((k) => a[k] !== b[k]);
}

export function initHistory() {
  if (inited) return;
  inited = true;
  useProjectStore.subscribe((state, prev) => {
    if (restoring) return;
    if (changed(state, prev)) {
      past.push(pick(prev));
      if (past.length > 50) past.shift();
    }
  });
}

export function undo() {
  const snap = past.pop();
  if (!snap) return;
  restoring = true;
  useProjectStore.setState(snap);
  restoring = false;
}
