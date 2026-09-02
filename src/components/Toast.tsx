import { useState } from 'react';
import { useToastStore, type ToastItem } from '../store/toastStore';

// Контейнер toast-уведомлений (рендерится в корне App).
export default function Toast() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className="flex items-start gap-3 rounded-card bg-bg-tertiary px-4 py-3 shadow-lg"
          style={{ border: `1px solid ${t.kind === 'error' ? 'var(--accent-orange, #ffa23a)' : 'var(--border)'}`, maxWidth: 520 }}
        >
          <div className="min-w-0 flex-1">
            <span className="text-text-primary" style={{ fontSize: 14 }}>
              {t.text}
            </span>
            {t.details && <Details toast={t} />}
          </div>
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
          <button className="text-text-secondary hover:text-text-primary" onClick={() => dismiss(t.id)} aria-label="Закрыть">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

// Технические подробности: свёрнуты, чтобы не пугать, но в одном клике —
// чтобы их можно было прочитать и скопировать в отчёт о проблеме.
function Details({ toast }: { toast: ToastItem }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1.5" style={{ fontSize: 12 }}>
      <button className="text-text-secondary hover:text-text-primary underline" onClick={() => setOpen((v) => !v)}>
        {open ? 'Скрыть подробности' : 'Подробнее'}
      </button>
      {open && (
        <>
          <pre
            className="mt-1.5 overflow-auto rounded bg-bg-primary p-2 text-text-secondary"
            style={{ maxHeight: 160, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 11 }}
          >
            {toast.details}
          </pre>
          <button
            className="mt-1 text-accent-green font-semibold"
            onClick={() => {
              void navigator.clipboard.writeText(`${toast.text}

${toast.details ?? ''}`).then(() => setCopied(true));
            }}
          >
            {copied ? 'Скопировано' : 'Скопировать'}
          </button>
        </>
      )}
    </div>
  );
}
