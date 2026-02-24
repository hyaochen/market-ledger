@echo off
title Market Ledger - Stopping...
cd /d "%~dp0"

echo.
echo  ============================================
echo   Market Ledger - Stop All Services
echo  ============================================
echo.

echo  Stopping all containers...
echo.
docker compose down

echo.
if %errorlevel% equ 0 (
    echo  All services stopped.
) else (
    echo  No running containers found (or Docker error).
)

echo.
echo  ============================================
echo.
pause
