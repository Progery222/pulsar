import { useToastStore } from '../store/toastStore';

// Контейнер toast-уведомлений (рендерится в корне App).
export default function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-center gap-3 rounded-card bg-bg-tertiary px-4 py-3 shadow-lg"
          style={{ border: '1px solid var(--border)' }}
        >
          <span className="text-text-primary" style={{ fontSize: 14 }}>
            {t.text}
          </span>
          {t.actionLabel && (
            <button
              className="font-semibold text-accent-green"
              style={{ fontSize: 13 }}
              onClick={() => {
                t.onAction?.();
                dismiss(t.id);
              }}
            >
              {t.actionLabel}
            </button>
          )}
          <button className="text-text-secondary hover:text-text-primary" onClick={() => dismiss(t.id)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
