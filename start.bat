@echo off
title Market Ledger - Starting...
cd /d "%~dp0"

echo.
echo  ============================================
echo   Market Ledger - Start (Docker)
echo  ============================================
echo.

echo  [1/2] Running database backup...
echo.
call npm run backup:db

echo.
echo  [2/2] Starting containers (background)...
echo.
docker compose up -d --build

echo.
if %errorlevel% equ 0 (
    echo  All services started successfully.
    echo.
    echo  App    : http://localhost:3000
    echo  Tunnel : running in background
    echo.
    echo  Use stop.bat to shut everything down.
) else (
    echo  Failed to start. Check Docker is running.
)

echo.
echo  ============================================
echo.
pause
