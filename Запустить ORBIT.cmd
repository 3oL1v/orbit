@echo off
chcp 65001 >nul
cd /d "%~dp0orbit"
where node >nul 2>nul
if errorlevel 1 (
  echo Не найден Node.js. Установите Node.js и повторите запуск.
  pause
  exit /b 1
)
echo Откройте http://127.0.0.1:8766 в браузере.
echo Это окно должно оставаться открытым. Остановка: Ctrl+C.
node coordinator.js
pause
