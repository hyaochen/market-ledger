@echo off
title Market Ledger - Cloudflare Tunnel
cd /d "%~dp0"

echo.
echo  ============================================
echo   Market Ledger - Cloudflare Tunnel
echo  ============================================
echo.

set CLOUDFLARED="C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist %CLOUDFLARED% set CLOUDFLARED=cloudflared

echo  Starting Cloudflare Tunnel...
echo  Close this window to stop the tunnel.
echo  ============================================
echo.

%CLOUDFLARED% tunnel --config .\tunnel-config.yml --protocol http2 run

echo.
echo  Tunnel stopped.
pause
