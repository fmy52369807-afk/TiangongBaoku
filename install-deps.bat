@echo off
setlocal
cd /d "%~dp0server"

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Please install Node.js 18 or newer.
  pause
  exit /b 1
)

echo Installing server dependencies...
npm install
if errorlevel 1 (
  echo Dependency installation failed.
  pause
  exit /b 1
)

echo Dependencies installed.
pause
