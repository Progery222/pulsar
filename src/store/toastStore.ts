import { create } from 'zustand';

export interface ToastItem {
  id: number;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
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
  opts?: { actionLabel?: string; onAction?: () => void }
) {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  useToastStore.getState().push({ id, text, ...opts });
  setTimeout(() => useToastStore.getState().dismiss(id), 5000);
}
