# Один клик: коммит -> поднять версию -> пуш тега.
# GitHub Actions сам соберёт инсталлятор и опубликует релиз (см. .github/workflows/release.yml).
# Запуск:  .\release.ps1           (повышает patch: 1.0.0 -> 1.0.1)
#          .\release.ps1 minor     (1.0.0 -> 1.1.0)
param([string]$bump = "patch")
$ErrorActionPreference = "Stop"

# 1. Закоммитить текущие изменения, если есть.
git add -A
$changes = git status --porcelain
if ($changes) {
  git commit -m "update"
  Write-Host "Изменения закоммичены."
}

# 2. Поднять версию (создаёт коммит + тег vX.Y.Z).
npm version $bump

# 3. Запушить код и тег -> запустится сборка релиза в облаке.
git push --follow-tags

Write-Host ""
Write-Host "Готово. Сборка релиза идёт в облаке:" -ForegroundColor Green
Write-Host "  https://github.com/Progery222/pulsar/actions" -ForegroundColor Cyan
Write-Host "Когда зелёная галочка — релиз опубликован, друзья получат обновление." -ForegroundColor Green
