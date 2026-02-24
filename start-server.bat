@echo off
title Market Ledger - Server
cd /d "%~dp0"

echo.
echo  ============================================
echo   Market Ledger - Starting Server
echo  ============================================
echo.
echo  [1/2] Running database backup...
echo.

call npm run backup:db

echo.
echo  [2/2] Starting server (LAN mode)...
echo.
echo  Local  : http://localhost:3000
echo  Network: http://[your-ip]:3000
echo.
echo  Close this window to stop the server.
echo  ============================================
echo.

call npm run start:lan

echo.
echo  Server stopped.
pause
