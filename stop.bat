@echo off
title Market Ledger - Stopping...
cd /d "%~dp0"

echo.
echo  ============================================
echo   Market Ledger - Stop
echo  ============================================
echo.

echo  Stopping app and bot containers...
echo.
docker compose stop market-ledger market-ledger-bot

echo.
echo  ============================================
echo   App and bot stopped. Cloudflare tunnel still running.
echo   Run start.bat to restart.
echo  ============================================
echo.
pause
