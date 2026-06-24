Модели детекции для режима «Замена титров».

EAST (детекция текста, ~96 МБ) — не хранится в git (большой бинарник),
но нужен локально и попадает в сборку .exe (extraResources).

Скачать east.pb:
  curl -L -o east.pb "https://github.com/oyyd/frozen_east_text_detection.pb/raw/master/frozen_east_text_detection.pb"

Положить рядом: assets/models/east.pb

Если модели нет — детекция текста просто отключается (вотермарки через temporal работают).
Зависимости Python на машине: pip install opencv-python-headless numpy
