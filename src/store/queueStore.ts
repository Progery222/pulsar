import { create } from 'zustand';

export type JobMode = 'editor' | 'vub' | 'cleaner';
export type JobStatus = 'queued' | 'detecting' | 'processing' | 'done' | 'error';

export interface Job {
  id: string;
  mode: JobMode;
  name: string;
  status: JobStatus;
  percent: number;
  error?: string;
}

interface QueueState {
  jobs: Job[];
  addJobs: (jobs: Job[]) => void;
  updateJob: (id: string, patch: Partial<Job>) => void;
  removeJob: (id: string) => void;
  clearFinished: () => void;
  activeCount: () => number;
}

// Глобальная очередь задач: живёт на уровне App, поэтому прогресс виден даже после
// переключения режима (фоновая обработка в main-процессе продолжается независимо от UI).
export const useQueueStore = create<QueueState>((set, get) => ({
  jobs: [],
  addJobs: (incoming) =>
    set((s) => {
      const map = new Map(s.jobs.map((j) => [j.id, j]));
      for (const j of incoming) map.set(j.id, j);
      return { jobs: Array.from(map.values()) };
    }),
  updateJob: (id, patch) =>
    set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)) })),
  removeJob: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),
  clearFinished: () => set((s) => ({ jobs: s.jobs.filter((j) => j.status !== 'done' && j.status !== 'error') })),
  activeCount: () => get().jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length,
}));
