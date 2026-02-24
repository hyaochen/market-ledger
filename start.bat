@echo off
title Market Ledger - Starting...
cd /d "%~dp0"

echo.
echo  ============================================
echo   Market Ledger - Start All Services
echo  ============================================
echo.

echo  [1/3] Running database backup...
echo.
call npm run backup:db

echo.
echo  [2/3] Starting Cloudflare Tunnel (background)...
set CLOUDFLARED="C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist %CLOUDFLARED% set CLOUDFLARED=cloudflared
start "Market Ledger - Tunnel" /min %CLOUDFLARED% tunnel --config .\tunnel-config.yml --protocol http2 run
echo  Tunnel started in background.

echo.
echo  [3/3] Starting server (LAN mode)...
echo.
echo  Local  : http://localhost:3000
echo  Network: http://[your-ip]:3000
echo.
echo  Close this window to stop the server.
echo  ============================================
echo.

title Market Ledger - Running
call npm run start:lan

echo.
echo  Server stopped.
pause
