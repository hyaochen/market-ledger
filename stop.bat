@echo off
title Market Ledger - Stopping...
cd /d "%~dp0"

echo.
echo  ============================================
echo   Market Ledger - Stop
echo  ============================================
echo.

echo  Stopping app container...
echo.
docker compose stop market-ledger

echo.
echo  ============================================
echo   App stopped. Cloudflare tunnel still running.
echo   Run start.bat to restart.
echo  ============================================
echo.
pause
