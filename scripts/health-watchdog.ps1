# T-ML-030 range B: host-side watchdog for market-ledger.
#
# Why this exists: the 2026-08-11 incident (SqliteError 522) went unnoticed for
# 35 hours because the login page is static and always returns HTTP 200 -- any
# monitor that only checks HTTP status was fooled. This script polls the DB-backed
# /api/health endpoint instead, and auto-restarts the containers when it stays
# down, so a stale SQLite file handle (Windows bind mount + WAL, see bugs-log.md
# 2026-08-11) gets caught and fixed automatically instead of silently for hours.
#
# T-ML-031 addition: the web check alone only catches the case where BOTH
# containers happened to be down together (true on 2026-08-10/11 by coincidence).
# If only the bot's DB connection ever fails while web stays healthy, the old
# version of this script would stay silent forever -- and the bot (Telegram) is
# the primary channel the owner's mother uses to record entries, so a bot-only
# outage is exactly as user-facing as a web-only one. This version additionally
# reads the bot container's own Docker healthcheck status (see docker-compose.yml
# market-ledger-bot healthcheck + bot/heartbeat.ts for why that healthcheck is a
# heartbeat-file freshness check and not a live DB query). Both signals feed the
# SAME consecutive-failure counter and throttle below -- deliberately not widened,
# per task spec.
#
# Designed to be invoked periodically (every 10 minutes) by Windows Task Scheduler,
# NOT to run as a long-lived loop itself -- each invocation is a single
# check-and-maybe-act cycle. State (consecutive failure count, last restart time)
# persists between invocations in a small JSON file so the "N consecutive
# failures" and "throttle restarts" rules work across separate script runs.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\health-watchdog.ps1
#
# Registered via scripts\tasks\market-ledger-health-watchdog.xml (schtasks import),
# same no-admin-required LogonTrigger + InteractiveToken pattern as
# scripts\tasks\market-ledger-claude-bridge.xml.

$ErrorActionPreference = "Stop"

# ---- config ----
$HealthUrl = "http://127.0.0.1:3000/api/health"
$BotContainerName = "market-ledger-bot"   # T-ML-031: checked via `docker inspect --format {{.State.Health.Status}}`
$FailThreshold = 3          # consecutive failures required before restarting (unchanged by T-ML-031)
$ThrottleMinutes = 30        # minimum gap between automatic restarts (unchanged by T-ML-031)
$Containers = @("market-ledger", "market-ledger-bot")
$AttentionPath = "C:\Users\a0927\vault\ops\attention.md"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $RepoRoot "logs"
$LogFile = Join-Path $LogDir "health-watchdog.log"
$StateFile = Join-Path $LogDir "health-watchdog-state.json"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-Log {
    param([string]$Message)
    $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    try {
        Add-Content -Path $LogFile -Value $line -Encoding utf8
    } catch {
        # logging must never break the main flow
    }
    Write-Host $line
}

function Get-State {
    if (Test-Path $StateFile) {
        try {
            $raw = Get-Content -Path $StateFile -Raw -ErrorAction Stop
            $parsed = $raw | ConvertFrom-Json -ErrorAction Stop
            return [PSCustomObject]@{
                ConsecutiveFailures = [int]$parsed.ConsecutiveFailures
                LastRestartUtc      = $parsed.LastRestartUtc
            }
        } catch {
            Write-Log "WARN: state file unreadable, starting fresh ($($_.Exception.Message))"
        }
    }
    return [PSCustomObject]@{
        ConsecutiveFailures = 0
        LastRestartUtc      = $null
    }
}

function Save-State {
    param($State)
    try {
        $State | ConvertTo-Json | Set-Content -Path $StateFile -Encoding utf8
    } catch {
        Write-Log "WARN: could not save state file: $($_.Exception.Message)"
    }
}

function Test-HealthEndpoint {
    try {
        $resp = Invoke-WebRequest -Uri $HealthUrl -TimeoutSec 10 -UseBasicParsing -ErrorAction Stop
        return ($resp.StatusCode -eq 200)
    } catch {
        return $false
    }
}

# T-ML-031: reads the bot container's own Docker healthcheck status (a heartbeat-file
# freshness check, see docker-compose.yml + bot/heartbeat.ts -- NOT a live DB query,
# so this function itself never touches dev.db, directly or indirectly). Returns the
# raw status string ("healthy" / "unhealthy" / "starting") or "error" if `docker
# inspect` itself fails (container missing, Docker not running, etc.) -- "error" is
# deliberately never treated as healthy by the caller.
function Get-BotHealthStatus {
    try {
        $output = & docker inspect $BotContainerName --format "{{.State.Health.Status}}" 2>&1
        if ($LASTEXITCODE -ne 0) {
            return "error"
        }
        $status = ($output | Out-String).Trim()
        if ([string]::IsNullOrWhiteSpace($status)) {
            return "error"
        }
        return $status
    } catch {
        return "error"
    }
}

# Only ASCII text is used to find the insertion point (no literal Chinese in this
# .ps1 file -- PowerShell 5.1 mangles non-ASCII source into ParserError garbage
# when written by some tools; the vault heading is "## Active(...)" in Chinese but
# the ASCII prefix "## Active" alone is unique in attention.md and is enough to
# anchor on safely).
function Add-AttentionEntry {
    param([string]$Body)

    if (-not (Test-Path $AttentionPath)) {
        Write-Log "WARN: attention.md not found at $AttentionPath, skipping notification"
        return
    }

    try {
        $bytes = [System.IO.File]::ReadAllBytes($AttentionPath)
        $hasBom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
        $encoding = New-Object System.Text.UTF8Encoding($hasBom)
        $content = $encoding.GetString($bytes)

        $marker = "## Active"
        $idx = $content.IndexOf($marker)
        if ($idx -lt 0) {
            Write-Log "WARN: could not find '## Active' heading in attention.md, skipping notification"
            return
        }

        # Insert right after the heading line (find the end of that line).
        $lineEnd = $content.IndexOf("`n", $idx)
        if ($lineEnd -lt 0) { $lineEnd = $content.Length - 1 }
        $insertAt = $lineEnd + 1

        $newContent = $content.Substring(0, $insertAt) + "`r`n" + $Body + "`r`n" + $content.Substring($insertAt)

        [System.IO.File]::WriteAllText($AttentionPath, $newContent, $encoding)
        Write-Log "Wrote entry to attention.md"
    } catch {
        Write-Log "WARN: failed to update attention.md: $($_.Exception.Message)"
    }
}

function Invoke-ContainerRestart {
    param([string[]]$Names)

    Write-Log "Restarting containers: $($Names -join ', ')"
    try {
        $output = & docker restart @Names 2>&1
        $exitCode = $LASTEXITCODE
        Write-Log "docker restart exit code $exitCode : $output"
        return ($exitCode -eq 0)
    } catch {
        Write-Log "ERROR: docker restart threw: $($_.Exception.Message)"
        return $false
    }
}

# ---- main ----
$state = Get-State

# T-ML-031: combined check -- overall healthy only if BOTH the web /api/health
# endpoint AND the bot container's own healthcheck status report healthy. Either one
# failing counts as an overall failure and feeds the SAME $state.ConsecutiveFailures
# counter below (no separate threshold per check -- deliberately not widened, see
# task spec / header comment).
$webHealthy = Test-HealthEndpoint
$botStatus = Get-BotHealthStatus
$botHealthy = ($botStatus -eq "healthy")
$healthy = $webHealthy -and $botHealthy

if ($healthy) {
    if ($state.ConsecutiveFailures -gt 0) {
        Write-Log "Health check OK (web=up bot=healthy), resetting failure count from $($state.ConsecutiveFailures)"
    }
    $state.ConsecutiveFailures = 0
    Save-State $state
    exit 0
}

$state.ConsecutiveFailures += 1
$webWord = if ($webHealthy) { "up" } else { "DOWN" }
Write-Log "Health check FAILED (web=$webWord [$HealthUrl] bot=$botStatus [$BotContainerName]), consecutive failures: $($state.ConsecutiveFailures)"

if ($state.ConsecutiveFailures -lt $FailThreshold) {
    Save-State $state
    exit 0
}

# Threshold reached -- check restart throttle before acting.
$nowUtc = (Get-Date).ToUniversalTime()
if ($state.LastRestartUtc) {
    try {
        $lastRestart = [DateTime]::Parse($state.LastRestartUtc, $null, [System.Globalization.DateTimeStyles]::RoundtripKind)
        $minutesSince = ($nowUtc - $lastRestart).TotalMinutes
        if ($minutesSince -lt $ThrottleMinutes) {
            Write-Log ("Threshold reached ({0} consecutive failures) but throttled -- last restart {1:N1} min ago, need {2} min. Skipping restart." -f $state.ConsecutiveFailures, $minutesSince, $ThrottleMinutes)
            Save-State $state
            exit 0
        }
    } catch {
        Write-Log "WARN: could not parse LastRestartUtc '$($state.LastRestartUtc)', proceeding as if no prior restart"
    }
}

Write-Log "Threshold reached ($($state.ConsecutiveFailures) consecutive failures). Restarting containers now."
$restartOk = Invoke-ContainerRestart -Names $Containers

$state.LastRestartUtc = $nowUtc.ToString("o")
$state.ConsecutiveFailures = 0
Save-State $state

$statusWord = if ($restartOk) { "AUTO_RESTARTED" } else { "AUTO_RESTART_FAILED" }
$entry = @"
### AUTO $((Get-Date -Format "yyyy-MM-dd HH:mm")) | market-ledger | health-watchdog auto-restart triggered

- Status: $statusWord (unattended, triggered by scripts\health-watchdog.ps1)
- Detected: $FailThreshold consecutive combined-health failures before $((Get-Date -Format "yyyy-MM-dd HH:mm:ss")) (web=$webWord bot=$botStatus at time of trigger; either check failing counts toward the same threshold)
- Action: docker restart market-ledger market-ledger-bot
- Detail log: C:\Users\a0927\Desktop\t_web\logs\health-watchdog.log
"@

Add-AttentionEntry -Body $entry
