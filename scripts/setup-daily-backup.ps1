<#
.SYNOPSIS
    設定每日自動備份資料庫
.DESCRIPTION
    以系統管理員身份執行：右鍵 PowerShell → 以系統管理員身份執行
#>

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$TaskName = "t_web-daily-backup"
$ProjectPath = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$NpmPath = (Get-Command npm -ErrorAction SilentlyContinue).Source

if (-not $NpmPath) {
    Write-Host "錯誤：找不到 npm，請確保 Node.js 已安裝並加入 PATH" -ForegroundColor Red
    exit 1
}

# 建立備份目錄
$BackupDir = "C:\db-backups\t_web"
if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
    Write-Host "已建立備份目錄：$BackupDir" -ForegroundColor Green
}

# 檢查是否已存在同名排程
$ExistingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($ExistingTask) {
    Write-Host "排程任務 '$TaskName' 已存在，將更新設定..." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

# 建立排程任務
$Action = New-ScheduledTaskAction -Execute "cmd.exe" `
    -Argument "/c cd /d `"$ProjectPath`" && npm run backup:db >> `"$BackupDir\backup.log`" 2>&1" `
    -WorkingDirectory $ProjectPath

# 每天凌晨 3:00 執行
$Trigger = New-ScheduledTaskTrigger -Daily -At 3:00AM

# 設定選項：即使使用者未登入也執行，錯過時儘快執行
$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries

# 使用目前使用者身份執行
$Principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U -RunLevel Limited

try {
    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $Action `
        -Trigger $Trigger `
        -Settings $Settings `
        -Principal $Principal `
        -Description "每日自動備份 t_web 資料庫到 C:\db-backups\t_web\" | Out-Null

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " 每日備份排程已設定完成！" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "排程名稱：$TaskName"
    Write-Host "執行時間：每天凌晨 3:00"
    Write-Host "備份位置：$BackupDir"
    Write-Host "日誌檔案：$BackupDir\backup.log"
    Write-Host ""
    Write-Host "可使用以下指令管理排程：" -ForegroundColor Yellow
    Write-Host "  查看狀態：Get-ScheduledTask -TaskName '$TaskName'"
    Write-Host "  手動執行：Start-ScheduledTask -TaskName '$TaskName'"
    Write-Host "  刪除排程：Unregister-ScheduledTask -TaskName '$TaskName'"
    Write-Host ""

    # 立即執行一次測試
    Write-Host "正在執行一次測試備份..." -ForegroundColor Yellow
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 5

    if (Test-Path "$BackupDir\backup.log") {
        Write-Host ""
        Write-Host "最新備份日誌：" -ForegroundColor Cyan
        Get-Content "$BackupDir\backup.log" -Tail 3
    }
}
catch {
    Write-Host "錯誤：無法建立排程任務" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "請以系統管理員身份執行此腳本！" -ForegroundColor Yellow
    exit 1
}
