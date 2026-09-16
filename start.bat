@echo off
setlocal
title Threadkeep
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel%==0 goto have_node

where wsl >nul 2>nul
if %errorlevel%==0 (
  echo Starting through WSL...
  wsl -e bash -lc "cd \"$(wslpath '%~dp0')\" && bash ./start.sh"
  goto end
)

echo Node.js is not installed.
echo Install it from https://nodejs.org then double-click start.bat again.
pause
goto end

:have_node
if not exist "node_modules" (
  echo Installing the app. This only happens once...
  call npm install
  if %errorlevel% neq 0 (
    echo Install failed.
    pause
    goto end
  )
)

echo Starting Threadkeep...
call npm start
if %errorlevel% neq 0 pause
goto end

:end
endlocal
