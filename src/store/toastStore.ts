import { create } from 'zustand';

export interface ToastItem {
  id: number;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Ошибка: не исчезает сама, показывает «Подробнее» и «Скопировать». */
  kind?: 'info' | 'error';
  /** Технические подробности (stderr, трейсбек) — под раскрытием, не в лицо. */
  details?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: ToastItem) => void;
  dismiss: (id: number) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => set((s) => ({ toasts: [...s.toasts, toast] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Показать toast-уведомление (§11, §14). Автоскрытие через 5 секунд.
export function showToast(
  text: string,
  opts?: { actionLabel?: string; onAction?: () => void; kind?: 'info' | 'error'; details?: string }
) {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  useToastStore.getState().push({ id, text, ...opts });
  // Ошибка висит, пока её не закроют: пять секунд на хвост stderr — это
  // «прочитать невозможно, скопировать тоже». Информационные гаснут сами.
  if (opts?.kind !== 'error') setTimeout(() => useToastStore.getState().dismiss(id), 5000);
}

/** Ошибка с техническими подробностями под раскрытием. */
export function showError(text: string, details?: string) {
  showToast(text, { kind: 'error', details: details?.trim() || undefined });
}
