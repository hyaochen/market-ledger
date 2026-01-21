$ErrorActionPreference = "Stop"

# Define cloudflared path
$cloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cloudflaredPath)) {
    $cloudflaredPath = "cloudflared" # Fallback to PATH
}

Write-Host "Setting up Cloudflare Tunnel..." -ForegroundColor Cyan

# 1. Check Login
$certPath = "$env:USERPROFILE\.cloudflared\cert.pem"
if (-not (Test-Path $certPath)) {
    Write-Host "Please login to Cloudflare (Browser will open)..." -ForegroundColor Yellow
    & $cloudflaredPath tunnel login
    Write-Host "After login is complete, press Enter to continue..."
    Read-Host
}

# 2. Create Tunnel
$tunnelName = "market-app"
Write-Host "Creating tunnel: $tunnelName..." -ForegroundColor Cyan
try {
    $createResult = & $cloudflaredPath tunnel create $tunnelName 2>&1
    Write-Host "$createResult"
}
catch {
    Write-Host "Tunnel might already exist, attempting to retrieve info..." -ForegroundColor Yellow
}

# 3. Get Tunnel ID
$tunnels = & $cloudflaredPath tunnel list --output json | ConvertFrom-Json
$tunnel = $tunnels | Where-Object { $_.name -eq $tunnelName }

if (-not $tunnel) {
    Write-Error "Could not find tunnel $tunnelName. Please check previous errors."
}

$tunnelId = $tunnel.id
Write-Host "Tunnel ID: $tunnelId" -ForegroundColor Green

# 4. Route DNS
$domain = "hongjixuan-market-ledger.com"
Write-Host "Routing DNS for $domain..." -ForegroundColor Cyan
& $cloudflaredPath tunnel route dns $tunnelName $domain

# 5. Update Config File
Write-Host "Updating config file (tunnel-config.yml)..." -ForegroundColor Cyan
$configContent = Get-Content ".\tunnel-config.yml" -Raw
$configContent = $configContent -replace "<TUNNEL_UUID>", $tunnelId
$configContent | Set-Content ".\tunnel-config.yml"

Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "You can now run 'npm run tunnel' or '.\start-tunnel.ps1' to start the tunnel." -ForegroundColor Cyan
