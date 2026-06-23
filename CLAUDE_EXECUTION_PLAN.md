# ПЛАН ВЫПОЛНЕНИЯ: Beatleap for Windows

Трекер статуса выполнения. ТЗ: `Техническое_Задание_Beatleap_for_Windows_*.pdf`.

## СТАТУС ВЫПОЛНЕНИЯ

- [x] Шаг 1: Инициализация проекта
- [x] Шаг 2: Дизайн-система, роутинг, State Management
- [x] Шаг 3: Экраны MediaPicker и MusicPicker
- [x] Шаг 4: Beat Detection (Python + IPC)
- [x] Шаг 5: Алгоритм нарезки и генерации монтажа
- [ ] Шаг 6: Главный экран редактора (Layout)
- [ ] Шаг 7: Вкладка TOOLS (все 7 инструментов)
- [ ] Шаг 8: Вкладка EDIT (9 эффектов)
- [ ] Шаг 9: Вкладка FILTERS + FFmpeg Pipeline
- [ ] Шаг 10: Экспорт, горячие клавиши, обработка ошибок
- [ ] Шаг 11: Финальная проверка по Acceptance Criteria

## Примечания

- **Шаг 1** завершён: структура Electron + React 18 + TypeScript + Tailwind CSS
  по дереву §3 ТЗ. `npm run dev` открывает тёмное окно (#0D0D0D), 1280×800,
  минимум 1024×600. Сборка (`tsc --noEmit`, `vite build`) проходит без ошибок.
  Bundler — Vite + vite-plugin-electron.
- **Шаг 2** завершён: палитра §4 (точные HEX) в Tailwind + CSS-переменных, шрифт
  Inter, классы `.btn-primary/.btn-secondary/.card/.panel`. Роутинг 5 экранов
  через Zustand (`currentScreen`). Полный `ProjectState` (§15) + 15 экшенов в
  `projectStore.ts`. Общие типы в `src/types.ts`. Typecheck/build/рендер — без ошибок.
- **Шаг 3** завершён: HomeScreen (§5.1, логотип/подзаголовок/«Начать»/«Продолжить
  проект»), MediaPickerScreen (§5.2: сетка 4 кол., выбор через диалог и DnD,
  зелёная галочка, длительность, лента выбранных 80×80 с № и ✕, drag-reorder,
  «Перемешать»/«По порядку»), MusicPickerScreen (§5.3: табы категорий, список
  72px, обложка 48px, превью play/pause, синяя точка, BEATLEAP/ФАЙЛЫ). Инфра:
  IPC-диалоги `selectVideos/selectAudio`, протокол `media://` для локальных файлов,
  библиотека `src/data/tracks.json` (20 треков). Миниатюры — первый кадр <video>
  без FFmpeg. Реальные MP3 в `assets/music/` пока отсутствуют (превью молчит до
  их добавления, как и предусмотрено ТЗ).
