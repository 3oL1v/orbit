@echo off
chcp 65001 >nul
cd /d "%~dp0orbit"
where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите Node.js и повторите запуск.
  pause
  exit /b 1
)
rem Исполнитель запускает Codex и Claude Code на этом компьютере по вашим входам и отвечает облачной бирже.
rem Пароль вводится скрыто и нигде не сохраняется.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$u=Read-Host 'Адрес биржи (https://...up.railway.app)'; $s=Read-Host 'Пароль биржи' -AsSecureString; $env:ORBIT_URL=$u; $env:ORBIT_TOKEN=[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)); node worker.js"
pause
