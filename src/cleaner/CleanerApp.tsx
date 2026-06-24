import { useState } from 'react';
import { useCleanerStore, type CoverMethod } from './store';
import { Block, Checkbox, Select } from '../vub/components/ui';
import { showToast } from '../store/toastStore';

function mediaUrl(p: string): string {
  return `media:///${encodeURIComponent(p)}`;
}

// Режим «Замена титров (AI)»: импорт пачки -> анализ (детект) -> перекрытие. Фаза 1: каркас.
export default function CleanerApp() {
  const {
    videos, addVideos, removeVideo,
    detectTitles, setDetectTitles, detectWatermarks, setDetectWatermarks,
    coverMethod, setCoverMethod, boxColor, setBoxColor,
    outputDir, setOutputDir,
  } = useCleanerStore();
  const [dragOver, setDragOver] = useState(false);

  async function pick() {
    const paths = await window.electronAPI.selectVideos();
    if (paths.length) addVideos(paths);
  }
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => (f as File & { path?: string }).path)
      .filter((p): p is string => !!p && /\.(mp4|mov|avi)$/i.test(p));
    if (paths.length) addVideos(paths);
  }
  async function pickFolder() {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) setOutputDir(dir);
  }
  function analyze() {
    showToast('Детектор ещё не установлен (Фаза 2). Нужна установка Python-пакетов.');
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '56px 40px 40px', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 className="font-semibold" style={{ fontSize: 24, marginBottom: 6 }}>Замена титров (AI)</h1>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 24 }}>
          Поиск чужих титров и водяных знаков в пачке роликов и автоматическое перекрытие.
        </p>

        {/* 1. Импорт */}
        <h2 className="font-semibold" style={{ fontSize: 16, marginBottom: 12 }}>1. Видео</h2>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={pick}
          style={{ border: `2px dashed ${dragOver ? 'var(--accent-green)' : 'var(--border)'}`, borderRadius: 8, padding: 32, textAlign: 'center', color: 'var(--text-secondary)', cursor: 'pointer', marginBottom: 12 }}
        >
          Перетащите ролики сюда или нажмите (MP4, MOV, AVI)
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {videos.map((v) => (
            <div key={v.id} style={{ height: 56, background: 'var(--bg-tertiary)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px' }}>
              <video src={mediaUrl(v.path)} muted style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4, background: '#000' }} />
              <span style={{ flex: 1, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
              <button onClick={() => removeVideo(v.id)} style={{ color: 'var(--text-secondary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>
          ))}
        </div>

        {/* 2. Первичная настройка */}
        <h2 className="font-semibold" style={{ fontSize: 16, marginBottom: 12 }}>2. Настройка</h2>
        <Block>
          <div style={{ fontSize: 14, marginBottom: 10, fontWeight: 600 }}>Что искать</div>
          <div style={{ display: 'flex', gap: 20 }}>
            <Checkbox checked={detectTitles} onChange={setDetectTitles} label="Титры / субтитры (текст)" />
            <Checkbox checked={detectWatermarks} onChange={setDetectWatermarks} label="Водяные знаки / логотипы" />
          </div>
        </Block>
        <Block>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14 }}>Способ перекрытия</span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {coverMethod === 'box' && (
                <input type="color" value={boxColor} onChange={(e) => setBoxColor(e.target.value.toUpperCase())} style={{ width: 40, height: 32, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 8 }} />
              )}
              <Select<CoverMethod>
                value={coverMethod}
                options={[
                  { value: 'delogo', label: 'Умное закрашивание (delogo)' },
                  { value: 'blur', label: 'Блюр зоны' },
                  { value: 'box', label: 'Сплошная плашка' },
                ]}
                onChange={setCoverMethod}
              />
            </div>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
            После перекрытия можно наложить ваши титры/подложку (настройки берутся из режима Уникализатор → Титры).
          </p>
        </Block>

        {/* 3. Папка + анализ */}
        <h2 className="font-semibold" style={{ fontSize: 16, margin: '24px 0 12px' }}>3. Сохранение и анализ</h2>
        <button onClick={pickFolder} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer' }}>
          Папка сохранения
        </button>
        {outputDir && <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>{outputDir}</p>}

        <div style={{ marginTop: 20 }}>
          <button
            onClick={analyze}
            disabled={!videos.length}
            className="btn-primary"
            style={{ padding: '10px 24px', fontSize: 14, opacity: videos.length ? 1 : 0.4 }}
          >
            Анализировать и перекрыть
          </button>
        </div>

        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
          Каркас режима готов. Детектор (PaddleOCR для текста + temporal для вотермарков) подключается на Фазе 2
          и требует разовой установки Python-пакетов.
        </p>
      </div>
    </div>
  );
}
