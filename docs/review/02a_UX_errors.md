# UX-аудит текстов ошибок, падений, горячих клавиш и обновлений — Pulsar

Подотчёт UX-аудита (подручный по ошибкам main/Python → интерфейс). Все ссылки — файл:строка в `d:/T7/Beatleap Atom`.

## Главные выводы

1. **Канал показа ошибок — тост на 5 с без «Подробнее» и без копирования** (`src/store/toastStore.ts:29`). Для хвостов stderr ffmpeg/pip это фатально: прочитать и скопировать невозможно. Худший случай — `proExport.ts:168`: 800 символов английского лога исчезают через 5 с.
2. **Глобальных обработчиков падений нет**: ни `uncaughtException`, ни `unhandledRejection`, ни `dialog.showErrorBox`. При крэше рендерера — чёрное окно без надписи; при исключении в main — процесс молча умирает. Единственный ErrorBoundary (`src/pro/ProEditor.tsx:145-160`) показывает полный JS-stack.
3. **Ctrl+R перезагружает окно и теряет проект.** Меню приложения не задаётся (`Menu.setApplicationMenu` нет), действует дефолтное меню Electron с ролью `reload`, спрятанное `autoHideMenuBar` (`main.ts:111`). `App.tsx:93` вешает Ctrl+R на «перемешать» — акселератор меню срабатывает раньше. Живы также Ctrl+Shift+I, Ctrl+Shift+R, Ctrl+±. Лечится `Menu.setApplicationMenu(null)`.
4. **Alt+F4 закрывает без подтверждения, кнопка «Выход» — спрашивает** (`TopBar.tsx:42` `window.confirm`; `main.ts:234` `window-all-closed` → `app.quit()` без `before-quit`). Несимметрично; `window.confirm` — чужеродный системный диалог.
5. **Баннер обновления выбрасывает состояние ошибки** (`UpdateBanner.tsx:19` возвращает `null` при `error`): без сети — тишина; обрыв загрузки — «Загрузка обновления… 63%» замирает навсегда. `SettingsScreen.tsx:56`: «нет сети или dev-режим» — словарь разработчика.
6. **Молчащие места**: `CleanerApp.tsx:37` (ошибка автодетекции плашек → пустые зоны, пользователь думает, что видео чистое); `ProcessingScreen.tsx:71` (любой сбой обработки → `console.error` и переход в редактор); `pro/ProEditor.tsx:51,53`; `SettingsScreen.tsx:46,280`; `StudioHost.tsx:14`; `DubApp.tsx:57`.
7. **Английские отладочные строки в проде**: `bad dir`/`bad path` (`proExport.ts:74/123`, `imgopt.ts:66`), `no mode`/`unknown mode` (`upscale.py`), `cannot open video`/usage-строка CLI (`detect_overlays.py`), `worker gone`/`worker timeout` (`audio.ts:156-176`), `Python beat detection timeout (40s)` (`audio.ts:84`).
8. **ENOENT/EPERM как есть**: `metadata.ts:953/961` → «Ошибка чтения: ENOENT: no such file or directory, open 'C:\…'».
9. **Причина потеряна**: `setup.ts:178` «pip завершился с кодом N» — сюда попадает обрыв сети на 3 ГБ из 5, ретрая нет, хотя pip докачивает из кэша; `setup.ts:249` «winget завершился с кодом N» — отказ UAC и нет сети выглядят одинаково; `setup.ts:140` теряет русский диагноз загрузчиков моделей (`download_omnivoice.py:51`, `download_whisper.py:83` печатают `ERROR: …` и `sys.exit(1)`).
10. **Эталоны, на которые равняться**: `setup.ts:184-197` (NVIDIA/CPU — что ставим и сколько), `python/tts.py:326` (нет OmniVoice → маршрут действия), `python/translate.py:30` (единственный кейс с автодействием — кнопка установки), `dub.ts:358/387`, `funnel.ts:378`.

## Таблица: main-процесс и Python → пользователь

| Файл:строка | Цитата | Канал | Оценка | Предложение |
|---|---|---|---|---|
| `python.ts:120` | Python не найден. Установите его с python.org и перезапустите приложение. | toast/лог | понятно | добавить «Открыть мастер настройки» |
| `setup.ts:52` | Python не найден (на `child.on('error')`) | inline | врёт: Python найден, но не стартовал | «Python найден, но не запускается. Возможно, его блокирует антивирус.» |
| `setup.ts:66` | Python X найден, но проверка движков не отработала: + 200 симв. stderr | inline | технично | «…проверить компоненты не удалось. Показать подробности ▾» |
| `setup.ts:139` | Загрузчик модели недоступен: ${err.message} | лог мастера | ENOENT/EPERM | «Не удалось запустить загрузку модели. Проверьте, что Python установлен.» |
| `setup.ts:140` | Не удалось скачать модель … (код 1) | лог мастера | код бесполезен | «Модель не скачалась — обычно это обрыв связи. Повторить загрузку?» |
| `setup.ts:178` | pip завершился с кодом N | лог + toast | причина потеряна, ретрая нет | «Загрузка прервалась (нет связи). Скачано ~N ГБ, можно продолжить: [Повторить]» |
| `setup.ts:205` | Неизвестный движок: … | лог | внутренняя ошибка | «Внутренняя ошибка приложения. Сообщите разработчику.» |
| `setup.ts:249` | winget завершился с кодом N | лог | UAC/сеть неразличимы | «Установка Python не завершилась. Частая причина — отказ в правах администратора. [Скачать вручную]» |
| `audio.ts:75/84/101/156-176` | Python не найден / beat detection timeout (40s) / stderr librosa / worker gone | молчит (`ProEditor.tsx:51` `.catch(() => null)`) | англ., трейсбек | inline на таймлайне: «Биты не определены — нет Python»; «Анализ ритма занял больше 40 с и был прерван»; «Не удалось проанализировать аудио. Подробности ▾» |
| `cleaner.ts:163` | Python/детектор недоступен / deps: No module named cv2 | молчит (`CleanerApp.tsx:37`) | пользователь думает, что видео чистое | «Автопоиск плашек не работает: не установлен компонент распознавания. [Установить]» |
| `download.ts:152/155/158/163` | Не удалось запустить yt-dlp / таймаут 5 мин / Ошибка загрузки: последняя строка stderr / Файл скачан, но не найден | inline | англ. `getaddrinfo failed` без сети | распознавать нет-сети → «Нет подключения к интернету»; остальное под «Подробнее ▾» |
| `download.ts:300` | …Нужен вход: залогиньтесь в Instagram в Chrome/Edge/Firefox… | inline | хорошо | убрать приклеенный англ. хвост |
| `funnel.ts:199/212` | Ошибка загрузки: ${tail} | inline `nowrap` (`FunnelApp.tsx:271`) | обрезано до ~30 симв. | перенос строки или раскрывающийся блок |
| `funnel.ts:380`, `aivideo.ts:221`, `recorder.ts:358` | OpenRouter ${status}: ${json} | inline/toast | англ. JSON API | 401 → «Неверный ключ», 402 → «Кончились кредиты», 429 → «Подождите» |
| `funnel.ts:339/342/398` | отменено | inline красным | отмена как ошибка | не считать ошибкой |
| `ffmpegRender.ts:187` | FFmpeg завис (нет активности 90с). Последний вывод: + 500 симв. | `window.alert` (`ExportModal.tsx:91`) | stderr в модалке | «Обработка зависла и была прервана. [Подробности] [Сообщить]» |
| `ffmpegRender.ts:272` | Нет клипов для рендеринга | alert | жаргон | «Добавьте хотя бы один клип» |
| `proExport.ts:168` | err.slice(-800) или ffmpeg exit N | toast 5 с (`Viewer.tsx:105`) | худший случай | «Экспорт не удался. [Подробности]» |
| `recorder.ts:301` | err.slice(-500) или ffmpeg код N | toast | то же | «Не удалось сохранить MP4 — [Подробности]» |
| `recorder.ts:271/397`, `aivideo.ts:250`, `splitmerge.ts:184`, `templateRender.ts:126` | ffmpeg не найден | toast | пользователь не знает, что делать | «Видеодвижок повреждён — переустановите приложение» |
| `tts.ts:109/155/210` | stderr tts.py / OmniVoice: … · Edge TTS: … / tts.py недоступен | toast | трейсбек, имя скрипта, две ошибки в строку | «Озвучка не удалась. [Подробности]»; «…ни офлайн-, ни онлайн-движком» |
| `python/tts.py:329-331` | CUDA OOM (рус.) + англ. хвост; прочие `str(e)` — «Torch not compiled with CUDA enabled» | toast | англ. без действия | «Видеокарта недоступна — озвучка пойдёт на процессоре (медленнее)» + автопереключение |
| `whisper_asr.py:80/82`, `transcribe.ts:51-134` | Не установлен faster-whisper (pip install …) / upload failed: 401 / transcription timeout | toast | pip-команда и англ. | «Неверный ключ AssemblyAI», «Нет интернета», «Расшифровка заняла слишком долго» |
| `metadata.ts:524` | Warning: Not a valid JPG (looks more like a PNG) | toast «Не сохранено: …» | англ. exiftool | «Файл не подходит: он не JPEG, хотя расширение .jpg» |
| `metadata.ts:953/961` | ENOENT/EPERM/EBUSY как есть | toast «Ошибка чтения: …» | сырой код ОС | ENOENT → «Файл не найден», EPERM/EBUSY → «Файл занят другой программой» |
| `feedback.ts:40/61` | Telegram ${status} | toast | технично | «Сообщение не отправилось — нет связи» |
| `files.ts:194` | …'в видео нет аудиодорожки?' | toast | знак вопроса — приложение не уверено | «В этом видео нет звуковой дорожки» |
| `proExport.ts:74/123`, `imgopt.ts:66` | bad dir / bad path | toast/молчит | англ. отладка | «Недопустимая папка» |
| `upscale.py:96/105`, `detect_overlays.py:202-269`, `beat_detect.py:62/76` | no mode / cannot open video / usage / str(e) | молчит | англ. отладка, трейсбек | нормальные русские тексты; usage не показывать |

## Язык сообщений в Python

`tts.py`, `translate.py`, `whisper_asr.py`, `download_*.py` — осмысленный русский с маршрутом действия, ретраи по зеркалам. `detect_overlays.py`, `beat_detect.py`, `upscale.py` — английские отладочные строки и голый `str(e)`: ровно те скрипты, чьи ошибки в интерфейсе вообще не показываются, поэтому их никто не переводил.

## Каналы показа в renderer

- toast 5 с — подавляющее большинство (`AiVideoApp`, `DubApp`, `ImgOptApp`, `MetadataApp`, `PresetBar`, `ProEditor`, `Viewer`, `RecorderApp`, `RecorderEditor`, `SplitMergeApp`, `MusicPickerScreen`, `DownloadApp`, `PerformanceTab`). Ни у одного нет кнопки, копирования или «Подробнее».
- inline — `QueuePanel:87`, `DownloadApp:173`, `FunnelApp:271` (одна строка), `BatchPanel:247`, `CutoutScreen:436`, лог мастера `FirstRunSetup:288`.
- alert — только `ExportModal:91`.
- молчат — `CleanerApp:37`, `ProcessingScreen:71`, `ProEditor:51,53`, `UpdateBanner:19`, `SettingsScreen:46,280`, `StudioHost:14`, `DubApp:57`.

## Глобальные обработчики падений

Нет ни `uncaughtException`, ни `unhandledRejection`, ни `showErrorBox`. `main.ts:55-60` пишет `[CRASH]` в консоль, которую пользователь не видит; `main.ts:67-74` пробрасывает консоль окна туда же.

Рекомендация: `process.on('uncaughtException')` → `dialog.showErrorBox('Pulsar остановился', 'Произошёл сбой. [Скопировать отчёт]')`; на `render-process-gone` — перезагрузка окна с плашкой «Приложение восстановлено после сбоя»; в ErrorBoundary — stack под «Технические детали».

## Горячие клавиши и выход

- Меню не задано → дефолтное Electron с `reload` на Ctrl+R; `App.tsx:93` Ctrl+R = «перемешать» → окно перезагружается, проект теряется. Живы Ctrl+Shift+I, Ctrl+Shift+R, Ctrl+±. Лечение: `Menu.setApplicationMenu(null)` или своё меню без `reload`.
- `globalShortcut` только в записи экрана (`recorder.ts:537-538`: Ctrl+Alt+S стоп, Ctrl+Alt+P пауза) — в интерфейсе не подписаны.
- Ctrl+Q не работает; Alt+F4 закрывает без подтверждения (`main.ts:234`), кнопка «Выход» спрашивает через `window.confirm` (`TopBar.tsx:42`).
- Нигде нет экрана со списком клавиш; заявленные в PRODUCT.md хоткеи (`App.tsx:71-106`, `ProEditor.tsx:194-241`) — часть.

## Автообновление

`updater.ts`: `autoDownload = true`, проверка через 4 с и раз в час, обе с `.catch(() => {})`. Баннер (`UpdateBanner.tsx`): тексты по-русски и понятны, но нет «Что нового» и нельзя скрыть. `UpdateBanner.tsx:19` выбрасывает `error`: без сети — тишина, обрыв загрузки — замерший процент. Предложение: показывать «Не удалось скачать обновление: нет связи. [Повторить] [Скрыть]», сбрасывать процент, из настроек убрать «dev-режим».
