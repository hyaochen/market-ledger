@echo off
setlocal enabledelayedexpansion
title Market Ledger - Stop Server

echo.
echo  ============================================
echo   Market Ledger - Stop Server
echo  ============================================
echo.
echo  Searching for process on port 3000...
echo.

set FOUND=0

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING" 2^>nul') do (
    echo  Found PID: %%a - Terminating...
    taskkill /PID %%a /F
    set FOUND=1
)

if !FOUND!==0 (
    echo  No server found on port 3000.
) else (
    echo.
    echo  Server stopped successfully.
)

echo.
echo  ============================================
echo.
pause
