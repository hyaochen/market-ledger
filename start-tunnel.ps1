$cloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cloudflaredPath)) { $cloudflaredPath = "cloudflared" }

Write-Host "Starting Cloudflare Tunnel..." -ForegroundColor Green
# --config must be placed BEFORE the 'run' subcommand
& $cloudflaredPath tunnel --config .\tunnel-config.yml --protocol http2 run
