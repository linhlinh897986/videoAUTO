@echo off
setlocal ENABLEDELAYEDEXPANSION

REM Change to repo root (this script should be placed at repo root)
cd /d "%~dp0"

echo === Starting All-in-One (Backend + Frontend) ===

REM 1) Start Backend in a new window: install deps then run uvicorn
if exist Backend ( 
  start "Backend" cmd /k "cd /d Backend && python -m pip install --upgrade pip && python -m pip install -r requirements.txt && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
) else (
  echo [WARN] Backend folder not found. Skipping backend startup.
)

REM 2) Start Frontend in a new window: install deps then run dev server
if exist frontend ( 
  start "Frontend" cmd /k "cd /d frontend && npm install && npm run dev"
) else (
  echo [WARN] frontend folder not found. Skipping frontend startup.
)

echo === Launched. Check the two opened windows. ===
endlocal
