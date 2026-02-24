@echo off
title Market Ledger - Backup
cd /d "%~dp0"

echo.
echo  ============================================
echo   Market Ledger - Database Backup
echo  ============================================
echo.

call npm run backup:db

echo.
if %errorlevel% equ 0 (
    echo  Backup complete!
    echo  Location: C:\db-backups\t_web\
) else (
    echo  Backup failed. Check messages above.
)

echo.
echo  ============================================
echo.
pause
