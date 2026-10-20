@echo off
title Market Ledger - Starting...
cd /d "%~dp0"

echo.
echo  ============================================
echo   Market Ledger - Start
echo  ============================================
echo.

echo  [1/3] Running database backup...
echo.
call npm run backup:db

echo.
echo  [2/3] Building app image...
echo.
docker build -t t_web-market-ledger:latest .
if %errorlevel% neq 0 (
    echo  Build failed.
    echo.
    echo  ============================================
    echo.
    pause
    exit /b 1
)

echo.
echo  [3/3] Starting app and bot containers...
echo.
docker compose up -d market-ledger market-ledger-bot
if %errorlevel% neq 0 (
    echo  Failed to start. Check Docker is running.
    echo.
    echo  ============================================
    echo.
    pause
    exit /b 1
)

echo.
echo  ============================================
echo   Started successfully.
echo.
echo   App    : http://localhost:3000
echo   Bot    : Telegram bot (see .env)
echo   Tunnel : see TUNNEL_HOSTNAME_MAIN in .env
echo.
echo   Note: Cloudflare tunnel runs separately.
echo         Use stop.bat to stop the app.
echo  ============================================
echo.
pause
