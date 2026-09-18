# Сборка bot.exe (Node.js single executable application).
# Запуск: npm run build   или   powershell -ExecutionPolicy Bypass -File build.ps1
# Готовый файл кладётся в dist\bot.exe; рабочий bot.exe в корне не трогается.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Test-Path node_modules\esbuild)) {
  Write-Host 'Установка сборщика (npm ci)...'
  npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось установить зависимости для сборки' }
}

Write-Host 'Проверка синтаксиса и тесты...'
Get-ChildItem src\*.mjs | ForEach-Object {
  node --check $_.FullName
  if ($LASTEXITCODE -ne 0) { throw ($_.Name + ' содержит синтаксическую ошибку') }
}
node --test tests/*.test.js
if ($LASTEXITCODE -ne 0) { throw 'Тесты не прошли, сборка остановлена' }

New-Item -ItemType Directory -Force dist | Out-Null
# The modules in src\ become one file: a single executable can only run one script.
Write-Host 'Сборка модулей в один файл...'
npm.cmd run bundle --silent
if ($LASTEXITCODE -ne 0) { throw 'esbuild не смог собрать модули' }

Write-Host 'Подготовка SEA-блоба...'
node --experimental-sea-config sea-config.json
if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить SEA-блоб' }

Copy-Item (Get-Command node).Source dist\bot.exe -Force

Write-Host 'Встраивание приложения в bot.exe...'
npx.cmd --yes postject@1.0.0-alpha.6 dist\bot.exe NODE_SEA_BLOB dist\sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw 'postject завершился с ошибкой' }
Remove-Item dist\sea-prep.blob

Write-Host ('Готово: ' + (Resolve-Path dist\bot.exe))
Write-Host 'Чтобы обновить рабочую версию: остановите бота и замените bot.exe файлом из dist\.'
