import type { TitlesStyle } from './types';

// Пресет стиля титров — снимок оформления (без enabled/language).
export type TitleStyleProps = Omit<TitlesStyle, 'enabled' | 'language'>;

export interface TitlePreset {
  id: string;
  name: string;
  builtin?: boolean;
  style: TitleStyleProps;
}

// Встроенные пресеты популярных стилей субтитров.
export const BUILTIN_TITLE_PRESETS: TitlePreset[] = [
  {
    id: 'tiktok',
    name: 'TikTok',
    builtin: true,
    style: {
      font: 'Montserrat', fontSize: 44, baseColor: '#FFFFFF', highlightColor: '#C6FF00',
      outline: 0, posXPct: 50, posYPct: 72, karaoke: true, uppercase: true, bold: true,
      maxWordsPerLine: 4, bg: { enabled: false, color: '#000000', opacity: 55, widthPct: 60, heightPct: 14, radius: 14 },
    },
  },
  {
    id: 'minimal',
    name: 'Минимал',
    builtin: true,
    style: {
      font: 'Montserrat', fontSize: 34, baseColor: '#FFFFFF', highlightColor: '#FFFFFF',
      outline: 0, posXPct: 50, posYPct: 85, karaoke: false, uppercase: false, bold: false,
      maxWordsPerLine: 5, bg: { enabled: true, color: '#000000', opacity: 45, widthPct: 60, heightPct: 14, radius: 14 },
    },
  },
  {
    id: 'bold-yellow',
    name: 'Жёлтый акцент',
    builtin: true,
    style: {
      font: 'Oswald', fontSize: 46, baseColor: '#FFFFFF', highlightColor: '#FFE600',
      outline: 0, posXPct: 50, posYPct: 80, karaoke: true, uppercase: true, bold: true,
      maxWordsPerLine: 3, bg: { enabled: false, color: '#000000', opacity: 55, widthPct: 60, heightPct: 14, radius: 14 },
    },
  },
  {
    id: 'outlined',
    name: 'С обводкой',
    builtin: true,
    style: {
      font: 'Russo One', fontSize: 40, baseColor: '#FFFFFF', highlightColor: '#C6FF00',
      outline: 4, posXPct: 50, posYPct: 78, karaoke: true, uppercase: true, bold: true,
      maxWordsPerLine: 4, bg: { enabled: false, color: '#000000', opacity: 55, widthPct: 60, heightPct: 14, radius: 14 },
    },
  },
];

// Извлечь снимок стиля из полного TitlesStyle (для «Сохранить как пресет»).
export function styleFromTitles(t: TitlesStyle): TitleStyleProps {
  const { enabled: _e, language: _l, ...rest } = t;
  return { ...rest, bg: { ...t.bg } };
}
