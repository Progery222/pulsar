import { useState } from 'react';
import { useProStore } from '../store/proStore';
import { DEFAULT_CROP, DEFAULT_TRANSFORM } from './proTypes';
import { fileName } from '../utils/media';

// Левая панель (§2 ТЗ): Media (бин источников) / Inspector (параметры клипа).

export default function LeftPanel() {
  const [tab, setTab] = useState<'media' | 'inspector'>('inspector');
  return (
    <div className="flex h-full w-full flex-col" style={{ background: 'var(--bg-secondary)' }}>
      <div className="flex" style={{ borderBottom: '1px solid var(--border)' }}>
        <TabBtn active={tab === 'media'} onClick={() => setTab('media')}>Media</TabBtn>
        <TabBtn active={tab === 'inspector'} onClick={() => setTab('inspector')}>Inspector</TabBtn>
      </div>
      <div className="flex flex-1 flex-col" style={{ minHeight: 0, overflow: 'auto' }}>
        {tab === 'media' ? <MediaTab /> : <InspectorTab />}
      </div>
    </div>
  );
}

function MediaTab() {
  const clips = useProStore((s) => s.doc.clips);
  const sources = Array.from(new Set(clips.map((c) => c.sourceFile)));
  if (!sources.length) {
    return <Empty text="Источников пока нет. Импортируйте медиа кнопкой ＋ у дорожки на таймлайне." />;
  }
  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      {sources.map((src) => (
        <div key={src} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', background: 'var(--bg-tertiary)', borderRadius: 8, fontSize: 12.5, color: 'var(--text-primary)' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fileName(src)}</span>
        </div>
      ))}
    </div>
  );
}

function InspectorTab() {
  const selected = useProStore((s) => s.selectedClipIds);
  const clip = useProStore((s) => s.doc.clips.find((c) => selected.includes(c.id)) ?? null);
  const updateTransform = useProStore((s) => s.updateClipTransform);
  const updateCrop = useProStore((s) => s.updateClipCrop);
  const toggleLock = useProStore((s) => s.toggleClipLock);

  if (!clip) return <Empty text="Выделите клип на таймлайне, чтобы редактировать его параметры." />;

  const t = { ...DEFAULT_TRANSFORM, ...clip.transform };
  const cr = { ...DEFAULT_CROP, ...clip.crop };

  return (
    <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <button
        onClick={() => toggleLock(clip.id)}
        title="Закрепить клип — Auto-Cut не перезапишет его"
        style={{
          alignSelf: 'flex-start',
          fontSize: 12,
          padding: '4px 12px',
          borderRadius: 6,
          cursor: 'pointer',
          color: clip.locked ? 'var(--bg-primary)' : 'var(--text-primary)',
          background: clip.locked ? 'var(--accent-green)' : 'var(--bg-tertiary)',
          border: '1px solid var(--border)',
        }}
      >
        {clip.locked ? '🔒 Закреплён' : '🔓 Закрепить'}
      </button>
      <Section title="Transform">
        <Row><NumField label="Position X" value={t.x} step={1} onChange={(v) => updateTransform(clip.id, { x: v })} /></Row>
        <Row><NumField label="Position Y" value={t.y} step={1} onChange={(v) => updateTransform(clip.id, { y: v })} /></Row>
        <Row><NumField label="Scale %" value={Math.round(t.scale * 100)} step={1} onChange={(v) => updateTransform(clip.id, { scale: Math.max(0.05, v / 100) })} /></Row>
        <Row><NumField label="Rotation°" value={Math.round(t.rotation)} step={1} onChange={(v) => updateTransform(clip.id, { rotation: v })} /></Row>
        <ResetBtn onClick={() => updateTransform(clip.id, DEFAULT_TRANSFORM)} />
      </Section>
      <Section title="Crop">
        <Row><NumField label="Top %" value={Math.round(cr.top * 100)} step={1} onChange={(v) => updateCrop(clip.id, { top: v / 100 })} /></Row>
        <Row><NumField label="Bottom %" value={Math.round(cr.bottom * 100)} step={1} onChange={(v) => updateCrop(clip.id, { bottom: v / 100 })} /></Row>
        <Row><NumField label="Left %" value={Math.round(cr.left * 100)} step={1} onChange={(v) => updateCrop(clip.id, { left: v / 100 })} /></Row>
        <Row><NumField label="Right %" value={Math.round(cr.right * 100)} step={1} onChange={(v) => updateCrop(clip.id, { right: v / 100 })} /></Row>
        <ResetBtn onClick={() => updateCrop(clip.id, DEFAULT_CROP)} />
      </Section>
    </div>
  );
}

// ─── UI ──────────────────────────────────────────────────────────────────────

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        padding: '8px 14px',
        fontSize: 13,
        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        borderBottom: active ? '2px solid var(--accent-green)' : '2px solid transparent',
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--text-secondary)', marginBottom: 8 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div>{children}</div>;
}

function NumField({ label, value, step, onChange }: { label: string; value: number; step: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, color: 'var(--text-secondary)' }}>
      <span>{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 88, padding: '4px 6px', fontSize: 12.5, background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)' }}
      />
    </label>
  );
}

function ResetBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ marginTop: 4, alignSelf: 'flex-start', fontSize: 11.5, color: 'var(--text-secondary)', background: 'var(--bg-tertiary)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 10px', cursor: 'pointer' }}>
      Сбросить
    </button>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="flex flex-1 items-center justify-center" style={{ padding: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
      {text}
    </div>
  );
}
