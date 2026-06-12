@echo off
setlocal
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456" ^| findstr "LISTENING"') do (
  echo Stopping Tiangong Baoku process %%a...
  taskkill /PID %%a /F
)
echo Done.
pause
