import { useEffect, useState } from 'react';
import { showToast } from '../store/toastStore';
import { useFunnelStore } from './store';
import { FUNNEL_LANGS, type FunnelItem, type FunnelStage } from './types';

const STAGE_LABEL: Record<FunnelStage, string> = {
  queued: 'В очереди',
  downloading: 'Скачивание',
  analyzing: 'AI-анализ',
  processing: 'Обработка',
  done: 'Готово',
  error: 'Ошибка',
};

const BRANCH_LABEL: Record<number, string> = {
  1: 'Уникализация',
  2: 'Сабы + голос',
  3: 'Голос',
  4: 'Плашка',
  5: 'Плашка + голос',
};

// Описание 5 веток для подсказки пользователю.
const BRANCH_HELP = [
  '1 — нет субтитров и голоса: только уникализация.',
  '2 — субтитры + голос: удаление сабов → дубляж → новые субтитры.',
  '3 — голос без субтитров: дубляж → новые субтитры.',
  '4 — текстовая плашка без голоса: удаление и замена плашки.',
  '5 — плашка + голос: дубляж → замена плашки → новые субтитры.',
];

// Модуль «Воронка»: ссылка → скачивание (yt-dlp) → AI-классификация (Gemini) →
// автоматическая обработка по одной из 5 веток → сохранение результата.
export default function FunnelApp() {
  const {
    url, setUrl, targetLanguages, toggleLanguage, uniqueize, setUniqueize,
    varyVoices, setVaryVoices, outputDir, setOutputDir, running, setRunning,
    items, applyProgress, reset,
  } = useFunnelStore();
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [hookEnabled, setHookEnabled] = useState(false);
  const [hookFolder, setHookFolder] = useState<string | null>(null);

  async function pickHookFolder() {
    const d = await window.electronAPI.selectDirectory();
    if (d) setHookFolder(d);
  }

  useEffect(() => {
    window.electronAPI.getSetting('defaultOutputDir').then((d) => d && !outputDir && setOutputDir(d as string));
    window.electronAPI.getSetting('funnel_default_target_languages').then((l) => {
      if (Array.isArray(l) && l.length) useFunnelStore.setState({ targetLanguages: l as string[] });
    });
    window.electronAPI.getOpenRouterKey().then((k) => setHasKey(!!k));
    const off = window.electronAPI.onFunnelProgress((ev) => applyProgress(ev));
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickFolder() {
    const d = await window.electronAPI.selectDirectory();
    if (d) {
      setOutputDir(d);
      window.electronAPI.setSetting('defaultOutputDir', d);
    }
  }

  async function start() {
    if (!url.trim() || !outputDir || running) return;
    if (!hasKey) {
      showToast('Не задан ключ Gemini API. Откройте Настройки.');
      return;
    }
    reset();
    setRunning(true);
    // Сохраняем выбор языков по умолчанию для будущих запусков.
    window.electronAPI.setSetting('funnel_default_target_languages', targetLanguages);
    const model = ((await window.electronAPI.getSetting('funnel_model')) as string) || 'google/gemini-3.5-flash';
    const asr = (((await window.electronAPI.getSetting('asr_provider')) as 'assemblyai' | 'whisper') || 'whisper');
    try {
      const r = await window.electronAPI.funnelStart({ url: url.trim(), targetLanguages, uniqueize, varyVoices, outputDir, model, asr, hooks: { enabled: hookEnabled, folder: hookFolder } });
      if ('error' in r) {
        showToast(`Ошибка: ${r.error}`);
      } else {
        showToast('Воронка завершена', {
          actionLabel: 'Открыть папку',
          onAction: () => window.electronAPI.openFolder(outputDir),
        });
        window.electronAPI.historyAdd({
          id: `funnel_${Date.now()}`,
          mode: 'cleaner',
          title: `Воронка • ${targetLanguages.join(',').toUpperCase()}`,
          createdAt: Date.now(),
          outputDir,
          files: [],
          settings: null,
        });
      }
    } finally {
      setRunning(false);
      setCancelling(false);
    }
  }

  async function cancel() {
    // Не сбрасываем running здесь — бэкенд завершит пайплайн и start() сам снимет флаг.
    setCancelling(true);
    await window.electronAPI.funnelCancel();
    showToast('Останавливаю обработку…');
  }

  const list = Object.values(items);
  const field: React.CSSProperties = {
    width: '100%', background: 'var(--bg-tertiary)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', borderRadius: 8, padding: '10px 12px', fontSize: 14,
  };
  const label: React.CSSProperties = { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 6, display: 'block' };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 860, margin: '0 auto', padding: '80px 24px 48px' }}>
        <h1 className="font-semibold" style={{ fontSize: 32, color: 'var(--text-primary)', marginBottom: 8 }}>
          Воронка
        </h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Ссылка → скачивание → AI-классификация (Gemini) → автоматическая обработка по одной из 5 веток → результат.
        </p>

        {hasKey === false && (
          <div style={{ marginBottom: 16, padding: 12, border: '1px solid var(--danger)', borderRadius: 8, fontSize: 13, color: 'var(--text-primary)' }}>
            Не задан ключ Gemini API. Добавьте его в «Настройках» — без него AI-классификация не работает.
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Ссылка на аккаунт или видео (TikTok / Instagram / YouTube …)</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            style={field}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={label}>Целевые языки дубляжа и субтитров</label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {FUNNEL_LANGS.map((l) => {
              const on = targetLanguages.includes(l.code);
              return (
                <button
                  key={l.code}
                  onClick={() => toggleLanguage(l.code)}
                  style={{
                    padding: '8px 16px', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                    background: on ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                    color: on ? '#0D0D0D' : 'var(--text-primary)',
                    border: '1px solid var(--border)', fontWeight: on ? 600 : 400,
                  }}
                >
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', marginBottom: 12 }}>
          <input type="checkbox" checked={uniqueize} onChange={(e) => setUniqueize(e.target.checked)} />
          Уникализировать результат (лёгкие вариации + очистка метаданных)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', marginBottom: 12 }}>
          <input type="checkbox" checked={varyVoices} onChange={(e) => setVaryVoices(e.target.checked)} />
          Разнообразить голоса дубляжа (случайный нейроголос для каждого видео)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer', marginBottom: hookEnabled ? 8 : 16 }}>
          <input type="checkbox" checked={hookEnabled} onChange={(e) => setHookEnabled(e.target.checked)} />
          Добавлять хук (интро-ролик) в начало каждого результата
        </label>
        {hookEnabled && (
          <div style={{ marginBottom: 16, paddingLeft: 26 }}>
            <button
              onClick={pickHookFolder}
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}
            >
              Папка с хуками
            </button>
            <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-secondary)', wordBreak: 'break-all' }}>
              {hookFolder || 'не выбрана — хук не добавится'}
            </span>
          </div>
        )}

        <div style={{ marginBottom: 20 }}>
          <label style={label}>Папка сохранения</label>
          <button
            onClick={pickFolder}
            style={{ ...field, textAlign: 'left', cursor: 'pointer', color: outputDir ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            {outputDir || 'Выбрать папку…'}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <button
            onClick={start}
            disabled={!url.trim() || !outputDir || running}
            className="btn-primary"
            style={{ padding: '12px 28px', fontSize: 15, opacity: !url.trim() || !outputDir || running ? 0.4 : 1 }}
          >
            {running ? 'Обработка…' : 'Скачать и запустить'}
          </button>
          {running && (
            <button
              onClick={cancel}
              disabled={cancelling}
              style={{ padding: '12px 24px', fontSize: 15, background: 'var(--bg-tertiary)', border: '1px solid var(--danger)', color: 'var(--danger)', borderRadius: 8, cursor: cancelling ? 'default' : 'pointer', opacity: cancelling ? 0.6 : 1 }}
            >
              {cancelling ? 'Останавливаю…' : '⏹ Стоп'}
            </button>
          )}
        </div>

        {/* Таблица очереди */}
        {list.length > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.4fr 1fr', gap: 8, padding: '10px 14px', background: 'var(--bg-secondary)', fontSize: 12, color: 'var(--text-secondary)', fontWeight: 600 }}>
              <span>Видео</span>
              <span>Ветка</span>
              <span>Этап</span>
              <span>Прогресс</span>
            </div>
            {list.map((it) => <QueueRow key={it.id} item={it} />)}
          </div>
        )}

        <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Ветки обработки:</div>
          {BRANCH_HELP.map((h) => <div key={h}>{h}</div>)}
          <p style={{ marginTop: 12 }}>
            Нужны: ключ Gemini API (Настройки) для классификации, ключ AssemblyAI для дубляжа,
            и компоненты Edge TTS / перевод / yt-dlp (мастер установки).
          </p>
        </div>
      </div>
    </div>
  );
}

// Строка очереди с прогресс-баром и кнопкой «показать в папке».
function QueueRow({ item }: { item: FunnelItem }) {
  const color =
    item.stage === 'error' ? 'var(--danger)' : item.stage === 'done' ? 'var(--accent-green)' : 'var(--text-primary)';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1.4fr 1fr', gap: 8, padding: '10px 14px', borderTop: '1px solid var(--border)', alignItems: 'center', fontSize: 13 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
        {item.name}
        {item.outputs.length > 0 && (
          <button
            onClick={() => window.electronAPI.showItemInFolder(item.outputs[item.outputs.length - 1])}
            style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--accent-green)', cursor: 'pointer', fontSize: 12 }}
            title="Показать в папке"
          >
            📁 {item.outputs.length}
          </button>
        )}
      </span>
      <span style={{ color: 'var(--text-secondary)' }}>{item.branch ? BRANCH_LABEL[item.branch] : '—'}</span>
      <span style={{ color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.error || item.stageLabel}>
        {item.error || item.stageLabel || STAGE_LABEL[item.stage]}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, height: 6, background: 'var(--bg-tertiary)', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${item.percent}%`, background: color, transition: 'width 0.3s ease' }} />
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 32, textAlign: 'right' }}>{Math.round(item.percent)}%</span>
      </div>
    </div>
  );
}
