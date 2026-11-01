@echo off
setlocal
cd /d "%~dp0"
title Syntaz Setup
rem Uses Node.js if this PC has it; otherwise gets its own copy (no installer, no admin) the first time.
where node >nul 2>nul && goto run
if exist "%LOCALAPPDATA%\Syntaz\node\node.exe" goto run
if exist "%ProgramFiles%\nodejs\node.exe" goto run
echo Getting Syntaz ready (the first time only, about a minute)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\windows\get-node.ps1" >nul
if errorlevel 1 goto failed
:run
start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0setup\windows\launch.ps1"
exit /b 0
:failed
echo.
echo Syntaz couldn't download what it needs. Check your internet connection and double-click this file again.
pause
exit /b 1
