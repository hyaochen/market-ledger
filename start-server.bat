@echo off
chcp 65001 >nul
title 進貨存管系統 - 伺服器
cd /d "%~dp0"

echo.
echo  ============================================
echo     進貨存管系統  啟動中
echo  ============================================
echo.
echo  [1/2] 執行資料庫備份...
echo.

call npm run backup:db

echo.
echo  [2/2] 啟動伺服器 (區網模式)...
echo.
echo  本機位址  : http://localhost:3000
echo  區網位址  : http://[本機IP]:3000
echo.
echo  關閉此視窗即可停止伺服器
echo  ============================================
echo.

call npm run start:lan

echo.
echo  伺服器已停止。
pause
