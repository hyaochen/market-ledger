@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title 進貨存管系統 - 停止伺服器

echo.
echo  ============================================
echo     停止進貨存管系統伺服器
echo  ============================================
echo.
echo  搜尋 Port 3000 上的程式...
echo.

set FOUND=0

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING" 2^>nul') do (
    echo  找到 PID: %%a，正在停止...
    taskkill /PID %%a /F
    set FOUND=1
)

if !FOUND!==0 (
    echo  找不到執行中的伺服器（Port 3000 未被使用）。
) else (
    echo.
    echo  伺服器已停止。
)

echo.
echo  ============================================
echo.
pause
