# T-ML-026 (A): stop the claude-bridge autostart loop and any running bridge.js.
#
# Kills BOTH the cmd.exe restart loop (run-hidden.bat) and the node.exe child it
# spawned. Killing only node.exe is not enough -- the loop would just relaunch it
# 5 seconds later. Uses CIM CommandLine matching (same technique the trading-bot
# watchdog uses for its pythonw process-pair scans) so no extra dependency is
# needed to find the right processes.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\claude-bridge\stop-bridge.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\claude-bridge\stop-bridge.ps1 -RemoveTask
#
# -RemoveTask also unregisters the market-ledger-claude-bridge scheduled task, so it
# will not start again at next logon. Without it, the task stays registered and will
# relaunch the bridge next time you log on -- use that if you only want to stop it
# for the current session.

param(
    [switch]$RemoveTask
)

$patterns = @('claude-bridge\\run-hidden\.bat', 'claude-bridge\\bridge\.js')
$killed = 0

Get-CimInstance Win32_Process | Where-Object {
    $cl = $_.CommandLine
    if (-not $cl) { return $false }
    foreach ($p in $patterns) {
        if ($cl -match $p) { return $true }
    }
    return $false
} | ForEach-Object {
    Write-Host "Stopping PID $($_.ProcessId): $($_.CommandLine)"
    try {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
        $killed++
    } catch {
        Write-Warning "Failed to stop PID $($_.ProcessId): $($_.Exception.Message)"
    }
}

if ($killed -eq 0) {
    Write-Host "No running claude-bridge process found."
} else {
    Write-Host "Stopped $killed process(es)."
}

if ($RemoveTask) {
    schtasks /Delete /TN "market-ledger-claude-bridge" /F
    Write-Host "Removed scheduled task market-ledger-claude-bridge (will not auto-start at next logon)."
}
