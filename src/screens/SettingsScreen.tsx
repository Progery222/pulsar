import { useEffect, useState } from 'react';
import { showToast } from '../store/toastStore';
import { useUIStore } from '../store/uiStore';

type GpuMode = 'auto' | 'gpu' | 'cpu';

const GPU_LABELS: Record<GpuMode, string> = { auto: 'Авто', gpu: 'GPU', cpu: 'CPU' };

// Экран настроек (доступен со стартового окна). Здесь же — API-ключ AssemblyAI.
export default function SettingsScreen() {
  const setShowSetup = useUIStore((s) => s.setShowSetup);
  const [apiKey, setApiKey] = useState('');
  const [savedKey, setSavedKey] = useState(false);
  const [gpuMode, setGpuMode] = useState<GpuMode>('auto');
  const [outputDir, setOutputDir] = useState<string>('');

  useEffect(() => {
    window.electronAPI.getVubApiKey().then((k) => setApiKey(k || ''));
    window.electronAPI.getGpuMode().then(setGpuMode);
    window.electronAPI.getSetting('defaultOutputDir').then((d) => setOutputDir((d as string) || ''));
  }, []);

  async function saveKey() {
    await window.electronAPI.setVubApiKey(apiKey.trim());
    setSavedKey(true);
    setTimeout(() => setSavedKey(false), 1500);
  }

  function changeGpu(m: GpuMode) {
    setGpuMode(m);
    window.electronAPI.setGpuMode(m);
  }

  async function pickFolder() {
    const dir = await window.electronAPI.selectDirectory();
    if (dir) {
      setOutputDir(dir);
      await window.electronAPI.setSetting('defaultOutputDir', dir);
      showToast('Папка по умолчанию сохранена');
    }
  }

  const input: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    borderRadius: 8,
    padding: '10px 12px',
    fontSize: 14,
  };
  const section: React.CSSProperties = { marginBottom: 28 };
  const label: React.CSSProperties = { fontSize: 14, fontWeight: 600, marginBottom: 8, display: 'block' };
  const hint: React.CSSProperties = { fontSize: 12, color: 'var(--text-secondary)', margin: '8px 0 0' };

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: 'var(--bg-primary)' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '80px 24px 48px' }}>
        <h1 className="font-semibold" style={{ fontSize: 32, color: 'var(--text-primary)', marginBottom: 32 }}>
          Настройки
        </h1>

        {/* API-ключ AssemblyAI (распознавание речи для титров) */}
        <div style={section}>
          <label style={label}>Ключ API AssemblyAI</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Вставьте ключ для автотитров"
            style={input}
          />
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 }}>
            <button onClick={saveKey} className="btn-primary" style={{ padding: '8px 20px', fontSize: 13 }}>
              Сохранить ключ
            </button>
            {savedKey && <span style={{ fontSize: 13, color: 'var(--accent-green)' }}>Сохранено ✓</span>}
          </div>
          <p style={hint}>
            Нужен для распознавания речи и автоматических субтитров в режимах «Уникализатор» и «Замена титров».
            Ключ шифруется и хранится только на этом компьютере.
          </p>
        </div>

        {/* Кодирование (GPU) */}
        <div style={section}>
          <label style={label}>Кодирование видео</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['auto', 'gpu', 'cpu'] as const).map((m) => (
              <button
                key={m}
                onClick={() => changeGpu(m)}
                style={{
                  flex: 1,
                  background: gpuMode === m ? 'var(--accent-green)' : 'var(--bg-tertiary)',
                  color: gpuMode === m ? '#0D0D0D' : 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 0',
                  fontSize: 13,
                  fontWeight: gpuMode === m ? 600 : 400,
                  cursor: 'pointer',
                }}
              >
                {GPU_LABELS[m]}
              </button>
            ))}
          </div>
          <p style={hint}>
            Авто — использовать видеокарту (NVIDIA/Intel/AMD) при наличии, иначе процессор. GPU ускоряет рендер в разы.
          </p>
        </div>

        {/* Движки озвучки */}
        <div style={section}>
          <label style={label}>Движки озвучки (TTS)</label>
          <button
            onClick={() => setShowSetup(true)}
            className="btn-primary"
            style={{ padding: '8px 20px', fontSize: 13 }}
          >
            Установка / проверка движков
          </button>
          <p style={hint}>Проверить наличие Python и скачать движок синтеза речи (XTTS / Silero / Kokoro).</p>
        </div>

        {/* Папка сохранения по умолчанию */}
        <div style={section}>
          <label style={label}>Папка сохранения по умолчанию</label>
          <button
            onClick={pickFolder}
            style={{ ...input, textAlign: 'left', cursor: 'pointer', color: outputDir ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          >
            {outputDir || 'Выбрать папку…'}
          </button>
          <p style={hint}>Будет предлагаться по умолчанию при экспорте и пакетной обработке.</p>
        </div>
      </div>
    </div>
  );
}
