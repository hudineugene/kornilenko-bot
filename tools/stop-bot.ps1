# Мягкая остановка бота: посылаем Ctrl+C в его окно, как если бы нажали руками.
# Бот успевает сохранить данные, сообщить администратору и убрать отметку работы.
# Запуск: powershell -ExecutionPolicy Bypass -File tools\stop-bot.ps1
$ErrorActionPreference = 'Stop'

$wrapper = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like '*start-bot.ps1*' } |
  Select-Object -First 1
$target = if ($wrapper) { $wrapper.ProcessId } else { (Get-Process bot -ErrorAction SilentlyContinue | Select-Object -First 1).Id }
if (-not $target) { Write-Output 'Бот не запущен.'; exit 0 }

$signature = @'
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool AttachConsole(uint dwProcessId);
[DllImport("kernel32.dll", SetLastError = true)] public static extern bool FreeConsole();
[DllImport("kernel32.dll")] public static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);
[DllImport("kernel32.dll")] public static extern bool GenerateConsoleCtrlEvent(uint dwCtrlEvent, uint dwProcessGroupId);
'@
$api = Add-Type -MemberDefinition $signature -Name 'ConsoleCtrl' -Namespace 'BotStop' -PassThru

[void]$api::FreeConsole()
if (-not $api::AttachConsole([uint32]$target)) {
  Write-Output "Не удалось подключиться к окну процесса $target. Нажмите Ctrl+C в окне бота вручную."
  exit 1
}
[void]$api::SetConsoleCtrlHandler([IntPtr]::Zero, $true)
$sent = $api::GenerateConsoleCtrlEvent(0, 0)
Start-Sleep -Seconds 6
[void]$api::FreeConsole()
[void]$api::SetConsoleCtrlHandler([IntPtr]::Zero, $false)

if ($sent) { Write-Output "Ctrl+C отправлен процессу $target." } else { Write-Output 'Не удалось отправить Ctrl+C.' }
if (Get-Process bot -ErrorAction SilentlyContinue) { Write-Output 'bot.exe ещё работает.' } else { Write-Output 'bot.exe остановлен.' }
