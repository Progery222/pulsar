import { useEffect, useRef, useState } from 'react';
import { showToast } from '../store/toastStore';

interface Item {
  url: string;
  status: 'queued' | 'downloading' | 'done' | 'error';
  percent: number;
  path?: string;
  error?: string;
}

// Режим «Скачать видео» — пакетная загрузка по ссылкам (TikTok/YouTube/Instagram/… через yt-dlp).
export default function DownloadApp() {
  const [text, setText] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const curRef = useRef(0);

  useEffect(() => {
    const off = window.electronAPI.onDownloadProgress((e) => {
      if (typeof e.percent === 'number') {
        const i = curRef.current;
        setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, percent: e.percent as number } : it)));
      }
    });
    return off;
  }, []);

  async function pickFolder() {
    const d = await window.electronAPI.selectDirectory();
    if (d) setFolder(d);
  }

  async function start() {
    const urls = text
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s));
    if (!urls.length) {
      showToast('Вставьте хотя бы одну ссылку (http/https)');
      return;
    }
    const init: Item[] = urls.map((url) => ({ url, status: 'queued', percent: 0 }));
    setItems(init);
    setBusy(true);
    for (let i = 0; i < urls.length; i++) {
      curRef.current = i;
      setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, status: 'downloading' } : it)));
      const r = await window.electronAPI.downloadVideo(urls[i], folder ?? undefined);
      setItems((prev) =>
        prev.map((it, idx) =>
          idx === i
            ? 'error' in r
              ? { ...it, status: 'error', error: r.error }
              : { ...it, status: 'done', percent: 100, path: r.path }
            : it
        )
      );
    }
    setBusy(false);
    setText('');
    showToast('Загрузка завершена');
  }

  const done = items.filter((i) => i.status === 'done').length;

  const field: React.CSSProperties = {
    width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', borderRadius: 8, padding: '10px 12px', fontSize: 14,
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '80px 24px 48px' }}>
        <h1 className="font-semibold" style={{ fontSize: 32, color: 'var(--text-primary)', marginBottom: 8 }}>
          Скачать видео
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Вставь одну или несколько ссылок (TikTok, YouTube, Instagram, Shorts, Reels…). Каждая
          с новой строки — скачаются по очереди в выбранную папку.
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'https://www.tiktok.com/...\nhttps://youtube.com/shorts/...\nhttps://instagram.com/reel/...'}
          rows={5}
          disabled={busy}
          style={{ ...field, resize: 'vertical', fontFamily: 'inherit', marginBottom: 12 }}
        />

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
          <button
            onClick={pickFolder}
            disabled={busy}
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer' }}
          >
            Папка сохранения
          </button>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
            {folder || 'по умолчанию: Загрузки\\Pulsar'}
          </span>
          <button
            onClick={start}
            disabled={busy || !text.trim()}
            className="btn-primary"
            style={{ padding: '10px 24px', fontSize: 14, opacity: busy || !text.trim() ? 0.5 : 1 }}
          >
            {busy ? 'Скачиваю…' : 'Скачать'}
          </button>
        </div>

        {items.length > 0 && (
          <>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>
              Готово {done} из {items.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((it, i) => (
                <div key={i} style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        fontSize: 13,
                        flex: 1,
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: it.status === 'error' ? 'var(--danger)' : 'var(--text-primary)',
                      }}
                    >
                      {it.url}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {it.status === 'downloading' ? `${Math.round(it.percent)}%` : it.status === 'done' ? '✓ готово' : it.status === 'error' ? 'ошибка' : 'в очереди'}
                    </span>
                    {it.status === 'done' && it.path && (
                      <button
                        onClick={() => window.electronAPI.showItemInFolder(it.path as string)}
                        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        Показать
                      </button>
                    )}
                  </div>
                  {(it.status === 'downloading' || it.status === 'done') && (
                    <div style={{ height: 4, background: 'var(--bg-secondary)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${it.percent}%`, background: 'var(--accent-green)', transition: 'width 0.2s ease' }} />
                    </div>
                  )}
                  {it.status === 'error' && it.error && (
                    <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 6 }}>{it.error}</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 20, lineHeight: 1.5 }}>
          Первая загрузка может занять время — при необходимости автоматически ставится yt-dlp
          (нужен Python). Качается лучшее доступное качество, склейка видео+аудио в MP4.
        </p>
      </div>
    </div>
  );
}
