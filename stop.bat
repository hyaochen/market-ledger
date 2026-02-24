@echo off
setlocal enabledelayedexpansion
title Market Ledger - Stop All

echo.
echo  ============================================
echo   Market Ledger - Stop All Services
echo  ============================================
echo.

echo  [1/2] Stopping server (port 3000)...
set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING" 2^>nul') do (
    taskkill /PID %%a /F >nul 2>&1
    set FOUND=1
)
if !FOUND!==0 (
    echo  Server was not running.
) else (
    echo  Server stopped.
)

echo.
echo  [2/2] Stopping Cloudflare Tunnel...
taskkill /IM cloudflared.exe /F >nul 2>&1
if %errorlevel% equ 0 (
    echo  Tunnel stopped.
) else (
    echo  Tunnel was not running.
)

echo.
echo  All services stopped.
echo  ============================================
echo.
pause
