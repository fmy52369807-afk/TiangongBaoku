@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Please install Node.js 18 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist "server\node_modules" (
  echo Dependencies are missing. Running install-deps.bat first...
  call "%~dp0install-deps.bat"
  if errorlevel 1 exit /b 1
)

echo Starting Yuedu server at http://127.0.0.1:3456
start "Yuedu Server" /D "%~dp0server" cmd /k node index.js
timeout /t 2 >nul
start "" "http://127.0.0.1:3456"
