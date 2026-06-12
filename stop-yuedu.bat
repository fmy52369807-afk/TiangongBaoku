@echo off
setlocal
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3456" ^| findstr "LISTENING"') do (
  echo Stopping process %%a on port 3456...
  taskkill /PID %%a /F
)
echo Done.
pause
