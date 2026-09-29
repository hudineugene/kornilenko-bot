# Запуск бота с единым журналом logs\bot.log и перезапуском после сбоя.
# Запуск: powershell -ExecutionPolicy Bypass -File start-bot.ps1
# Остановка: Ctrl+C в этом окне.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$logDirectory = Join-Path $PSScriptRoot 'logs'
$log = Join-Path $logDirectory 'bot.log'
New-Item -ItemType Directory -Force $logDirectory | Out-Null

if (Test-Path (Join-Path $PSScriptRoot 'bot.exe')) {
  $command = '"' + (Join-Path $PSScriptRoot 'bot.exe') + '"'
} else {
  $command = 'node "' + (Join-Path $PSScriptRoot 'bot.js') + '"'
}

$quickFailures = 0
while ($true) {
  $startedAt = Get-Date
  Add-Content -Encoding UTF8 $log ('[' + $startedAt.ToString('s') + '] Запуск: ' + $command)
  Write-Host ('Бот запущен, журнал: ' + $log)
  # Журнал ведёт сам бот: он пишет в logs\bot.log и сам переносит разросшийся
  # файл в bot.log.1. Перенаправлять вывод сюда нельзя — пока окно держит файл
  # открытым, Windows не даёт его ни переименовать, ни укоротить.
  cmd.exe /c $command
  $exitCode = $LASTEXITCODE
  Add-Content -Encoding UTF8 $log ('[' + (Get-Date).ToString('s') + '] Процесс завершился с кодом ' + $exitCode)
  if ($exitCode -eq 0) { break }

  # Повторный запуск не открывает браузер заново.
  $env:NO_AUTO_OPEN = '1'
  if (((Get-Date) - $startedAt).TotalSeconds -lt 15) { $quickFailures += 1 } else { $quickFailures = 0 }
  if ($quickFailures -ge 3) {
    Write-Host 'Бот трижды подряд завершился сразу после запуска (например, порт занят). Смотрите журнал:' $log
    exit 1
  }
  Write-Host ('Бот завершился с ошибкой (код ' + $exitCode + '), перезапуск через 5 секунд...')
  Start-Sleep -Seconds 5
}
