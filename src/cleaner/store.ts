import { create } from 'zustand';

// Состояние режима «Замена титров» (детект чужих титров/вотермарков + перекрытие).
export type CoverMethod = 'delogo' | 'blur' | 'box';

export interface CleanerVideo {
  id: string;
  path: string;
  name: string;
}

interface CleanerState {
  videos: CleanerVideo[];
  addVideos: (paths: string[]) => void;
  removeVideo: (id: string) => void;

  detectTitles: boolean;
  setDetectTitles: (v: boolean) => void;
  detectWatermarks: boolean;
  setDetectWatermarks: (v: boolean) => void;

  coverMethod: CoverMethod;
  setCoverMethod: (m: CoverMethod) => void;
  boxColor: string;
  setBoxColor: (c: string) => void;

  outputDir: string | null;
  setOutputDir: (v: string | null) => void;
}

function fileName(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

export const useCleanerStore = create<CleanerState>((set) => ({
  videos: [],
  addVideos: (paths) =>
    set((s) => {
      const existing = new Set(s.videos.map((v) => v.id));
      const added = paths
        .filter((p) => !existing.has(p))
        .map<CleanerVideo>((p) => ({ id: p, path: p, name: fileName(p) }));
      return { videos: [...s.videos, ...added] };
    }),
  removeVideo: (id) => set((s) => ({ videos: s.videos.filter((v) => v.id !== id) })),

  detectTitles: true,
  setDetectTitles: (v) => set({ detectTitles: v }),
  detectWatermarks: true,
  setDetectWatermarks: (v) => set({ detectWatermarks: v }),

  coverMethod: 'blur',
  setCoverMethod: (m) => set({ coverMethod: m }),
  boxColor: '#000000',
  setBoxColor: (c) => set({ boxColor: c }),

  outputDir: null,
  setOutputDir: (v) => set({ outputDir: v }),
}));
