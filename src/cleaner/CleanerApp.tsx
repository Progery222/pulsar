import { useEffect, useState } from 'react';
import { useCleanerStore, type CoverMethod } from './store';
import { useVubStore } from '../vub/store';
import { useUIStore } from '../store/uiStore';
import { Block, Checkbox, Select, Slider, Switch } from '../vub/components/ui';
import ZoneEditor from './ZoneEditor';

function mediaUrl(p: string): string {
  return `media:///${encodeURIComponent(p)}`;
}

// Режим «Замена титров (AI)»: импорт пачки -> анализ (детект) -> перекрытие. Фаза 1: каркас.
export default function CleanerApp() {
  const {
    videos, addVideos, removeVideo,
    detectTitles, setDetectTitles, detectWatermarks, setDetectWatermarks,
    dynamicTextOnly, setDynamicTextOnly,
    coverMethod, setCoverMethod, boxColor, setBoxColor, boxRadius, setBoxRadius, blurStrength, setBlurStrength, minConf, setMinConf,
    addTitles, setAddTitles, titlesAtZone, setTitlesAtZone, titleZoneIndex, setTitleZoneIndex,
    titleZonePick, setTitleZonePick,
    manualZones, setManualZones, zones, setZones, addZone, removeZone,
    outputDir, setOutputDir,
    isProcessing, setIsProcessing, progress, setProgress, updateProgress,
  } = useCleanerStore();
  const titles = useVubStore((s) => s.titles);
  const setAppMode = useUIStore((s) => s.setAppMode);
  const [dragOver, setDragOver] = useState(false);
  const [detecting, setDetecting] = useState(false);

  async function autoZones() {
    if (!videos.length) return;
    setDetecting(true);
    const r = await window.electronAPI.detectCleanerOne({ videoPath: videos[0].path, detectTitles, detectWatermarks, dynamicTextOnly });
    setDetecting(false);
    if (r.error) { setZones([]); return; }
    setZones((r.boxes || []).filter((b) => (b.conf ?? 1) >= minConf).map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h })));
  }

  useEffect(() => {
    const off = window.electronAPI.onCleanerProgress((p) => updateProgress(p.id, p));
    return off;
  }, [updateProgress]);

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
  async function analyze() {
    if (!videos.length || !outputDir || isProcessing) return;
    setProgress(videos.map((v) => ({ id: v.id, name: v.name, status: 'queued', percent: 0 })));
    setIsProcessing(true);
    try {
      await window.electronAPI.processCleaner({
        videos,
        detectTitles,
        detectWatermarks,
        dynamicTextOnly,
        coverMethod,
        boxColor,
        boxRadius,
        blurStrength,
        minConf,
        addTitles,
        titlesAtZone,
        titleZoneIndex,
        titleZonePick,
        titles: addTitles ? titles : undefined,
        manualZones,
        zones: manualZones ? zones : undefined,
        outputDir,
      });
      window.electronAPI.historyAdd({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        mode: 'cleaner',
        title: `Замена титров • ${videos.length} видео`,
        createdAt: Date.now(),
        outputDir,
        files: videos.map((v) => v.name),
        settings: null,
      });
    } finally {
      setIsProcessing(false);
    }
  }
  function cancel() {
    window.electronAPI.cancelCleaner();
    setIsProcessing(false);
  }

  const statusRu: Record<string, string> = {
    queued: 'В очереди', detecting: 'Анализ', processing: 'Перекрытие', done: 'Готово', error: 'Ошибка',
  };

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
          {detectTitles && (
            <div style={{ marginTop: 10 }}>
              <Checkbox checked={dynamicTextOnly} onChange={setDynamicTextOnly} label="Только меняющийся текст (субтитры) — игнорировать надписи на одежде/лого" />
            </div>
          )}
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
          {coverMethod === 'box' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Скругление плашки</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{boxRadius}px</span>
              </div>
              <Slider min={0} max={80} value={boxRadius} onChange={setBoxRadius} />
            </div>
          )}
          {coverMethod === 'blur' && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Сила блюра</span>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{blurStrength}</span>
              </div>
              <Slider min={4} max={60} value={blurStrength} onChange={setBlurStrength} />
            </div>
          )}
        </Block>

        <Block>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Switch checked={addTitles} onChange={setAddTitles} />
            <span style={{ fontSize: 14 }}>Наложить свои титры поверх (авто-субтитры)</span>
          </div>
          {addTitles && (
            <div style={{ marginTop: 12, marginBottom: 4 }}>
              <Checkbox checked={titlesAtZone} onChange={setTitlesAtZone} label="Ставить титры на месте найденной зоны (автоматически)" />
            </div>
          )}
          {addTitles && titlesAtZone && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8 }}>В какую зону ставить титры:</div>
              {manualZones && zones.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {zones.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setTitleZoneIndex(i)}
                      style={{
                        background: i === titleZoneIndex ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                        color: i === titleZoneIndex ? '#000' : 'var(--text-primary)',
                        border: '1px solid var(--border)', borderRadius: 8, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
                        fontWeight: i === titleZoneIndex ? 600 : 400,
                      }}
                    >
                      Зона {i + 1}
                    </button>
                  ))}
                </div>
              ) : (
                <Select<'largest' | 'lowest' | 'highest'>
                  value={titleZonePick}
                  options={[
                    { value: 'largest', label: 'Самая крупная' },
                    { value: 'lowest', label: 'Самая нижняя' },
                    { value: 'highest', label: 'Самая верхняя' },
                  ]}
                  onChange={setTitleZonePick}
                />
              )}
            </div>
          )}
          {addTitles && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '10px 0 0' }}>
              Речь распознаётся заново, титры берут стиль/караоке/подложку и API-ключ со вкладки{' '}
              <button onClick={() => setAppMode('vub')} style={{ background: 'none', border: 'none', color: 'var(--accent-green)', cursor: 'pointer', padding: 0, fontSize: 12, textDecoration: 'underline' }}>
                Уникализатор → Титры
              </button>
              . Текущий шрифт: {titles.font}, позиция Y: {titles.posYPct}%.
            </p>
          )}
        </Block>

        {/* Зоны */}
        <Block>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Switch checked={manualZones} onChange={setManualZones} />
            <span style={{ fontSize: 14 }}>Размечать зоны вручную (одни для всех роликов)</span>
          </div>
          {manualZones && (
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
              {videos[0] ? (
                <ZoneEditor
                  videoSrc={mediaUrl(videos[0].path)}
                  zones={zones}
                  onAdd={addZone}
                  onRemove={removeZone}
                  titleZoneIndex={addTitles && titlesAtZone ? titleZoneIndex : -1}
                />
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Загрузите видео, чтобы разметить зоны.</div>
              )}
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '0 0 10px' }}>
                  Рисуйте прямоугольники мышью поверх кадра. Удаление — крестик. Эти зоны применятся ко
                  всем роликам пачки (удобно, когда титры в одних местах).
                </p>
                <button
                  onClick={autoZones}
                  disabled={!videos.length || detecting}
                  style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer', opacity: detecting ? 0.5 : 1 }}
                >
                  {detecting ? 'Ищу…' : 'Найти автоматически (1-й ролик)'}
                </button>
                {zones.length > 0 && (
                  <button
                    onClick={() => setZones([])}
                    style={{ marginLeft: 10, background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}
                  >
                    Очистить ({zones.length})
                  </button>
                )}

              </div>
            </div>
          )}
        </Block>

        {/* 3. Папка + анализ */}
        <h2 className="font-semibold" style={{ fontSize: 16, margin: '24px 0 12px' }}>3. Сохранение и анализ</h2>
        <button onClick={pickFolder} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer' }}>
          Папка сохранения
        </button>
        {outputDir && <p style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>{outputDir}</p>}

        <div style={{ marginTop: 16, maxWidth: 340 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Порог уверенности</span>
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{Math.round(minConf * 100)}%</span>
          </div>
          <Slider min={0} max={90} step={5} value={Math.round(minConf * 100)} onChange={(v) => setMinConf(v / 100)} />
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', margin: '6px 0 0' }}>
            Выше порог — меньше ложных зон (но можно пропустить настоящие).
          </p>
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
          <button
            onClick={analyze}
            disabled={!videos.length || !outputDir || isProcessing}
            className="btn-primary"
            style={{ padding: '10px 24px', fontSize: 14, opacity: !videos.length || !outputDir || isProcessing ? 0.4 : 1 }}
          >
            {isProcessing ? 'Обработка…' : 'Анализировать и перекрыть'}
          </button>
          {isProcessing && (
            <button onClick={cancel} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 8, padding: '10px 24px', fontSize: 14, cursor: 'pointer' }}>
              Отмена
            </button>
          )}
        </div>

        {progress.length > 0 && (
          <table style={{ marginTop: 24, width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: 'var(--text-secondary)', textAlign: 'left' }}>
                <th style={{ padding: '8px 0', fontWeight: 600 }}>Файл</th>
                <th style={{ padding: '8px 0', fontWeight: 600, width: 130 }}>Статус</th>
                <th style={{ padding: '8px 0', fontWeight: 600, width: 160 }}>Прогресс</th>
              </tr>
            </thead>
            <tbody>
              {progress.map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 0', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</td>
                  <td style={{ padding: '8px 0', color: p.status === 'error' ? 'var(--danger)' : p.status === 'done' ? 'var(--accent-green)' : 'var(--text-secondary)' }}>
                    {statusRu[p.status] ?? p.status}{p.info ? ` · ${p.info}` : ''}
                  </td>
                  <td style={{ padding: '8px 0' }}>
                    <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${p.percent}%`, background: 'var(--accent-green)', transition: 'width 0.2s ease' }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
          Детект статичных оверлеев (вотермарки, постоянные титры) работает оффлайн. Динамичные субтитры
          (модель текста) и наложение своих титров — на следующем шаге.
        </p>
      </div>
    </div>
  );
}
