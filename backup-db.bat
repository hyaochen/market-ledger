@echo off
chcp 65001 >nul
title 資料庫備份
cd /d "%~dp0"

echo.
echo  ============================================
echo     資料庫手動備份
echo  ============================================
echo.

call npm run backup:db

echo.
if %errorlevel% equ 0 (
    echo  備份完成！
    echo  備份位置：C:\db-backups\t_web\
) else (
    echo  備份過程發生問題，請查看上方錯誤訊息。
)

echo.
echo  ============================================
echo.
pause
