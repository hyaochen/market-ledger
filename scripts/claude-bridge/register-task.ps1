# T-ML-026 (A): register the market-ledger-claude-bridge scheduled task from the
# XML definition committed at scripts\tasks\market-ledger-claude-bridge.xml.
#
# Safe to re-run -- schtasks /F overwrites the existing registration in place.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\claude-bridge\register-task.ps1
#
# After registering, verify with:
#   schtasks /Run /TN "market-ledger-claude-bridge"
#   curl http://127.0.0.1:5055/health
# (should return {"ok":true,...} within a couple seconds, no window should appear)

$xmlPath = Join-Path $PSScriptRoot "..\tasks\market-ledger-claude-bridge.xml"
$xmlPath = (Resolve-Path $xmlPath).Path

schtasks /Create /TN "market-ledger-claude-bridge" /XML "$xmlPath" /F

if ($LASTEXITCODE -eq 0) {
    Write-Host "Registered scheduled task 'market-ledger-claude-bridge'."
    Write-Host "It will start claude-bridge automatically next time you log on to Windows."
    Write-Host "Test now with: schtasks /Run /TN market-ledger-claude-bridge"
} else {
    Write-Warning "schtasks /Create failed (exit $LASTEXITCODE). See output above."
}
