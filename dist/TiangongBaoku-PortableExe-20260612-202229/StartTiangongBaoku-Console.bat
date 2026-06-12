@echo off
setlocal
cd /d "%~dp0server"
"%~dp0runtime\node.exe" index.js
pause
