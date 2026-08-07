@echo off
rem T-ML-026 (A): auto-restart wrapper for claude-bridge.
rem
rem Launched ONLY via run-hidden.vbs (WScript.Shell.Run windowStyle=0) so no console
rem window ever appears. node.exe is a console-subsystem binary -- unlike Python there
rem is no "nodew.exe" equivalent, so hiding has to happen at the launcher level
rem (see run-hidden.vbs), not inside this script or inside bridge.js.
rem
rem If bridge.js exits for any reason (crash, port conflict, npm/node error), this
rem loop waits 5s and restarts it. That is the "restart on failure" resilience the
rem task requires -- deliberately NOT relying on Task Scheduler's own
rem RestartOnFailure setting, because Task Scheduler only supervises its own direct
rem child (wscript.exe), which exits successfully in well under a second regardless
rem of whether the detached node.exe it spawned later crashes.
rem
rem Do not run this file directly by double-clicking if you want it hidden -- it will
rem show a console window like any other .bat. Double-clicking is fine for manual
rem debugging (matches "npm run claude-bridge" foreground behavior, just via this
rem wrapper instead), Ctrl+C still stops it same as before.
setlocal
chcp 65001 >nul
cd /d "%~dp0..\.."
if not exist logs mkdir logs

:loop
echo [%date% %time%] starting claude-bridge >> logs\claude-bridge.log
node scripts\claude-bridge\bridge.js >> logs\claude-bridge.log 2>&1
echo [%date% %time%] claude-bridge exited (code %errorlevel%), restarting in 5s >> logs\claude-bridge.log
timeout /t 5 /nobreak >nul
goto loop
