# deploy.ps1 -- build + sync signalk-pypilot-newui to Tunatunes Pi over Tailscale.
#
# ASCII only (Windows PowerShell 5.1 reads .ps1 as Windows-1252 -- non-ASCII
# breaks the parser). Every native call is followed by a $LASTEXITCODE check.
#
# Usage:
#   .\deploy.ps1                # build + rsync (no SK restart)
#   .\deploy.ps1 -SkipBuild     # sync only (public/* edits)
#   .\deploy.ps1 -Restart       # build + rsync + systemctl restart signalk
#
# Prereqs:
#   - MSYS2 with rsync (path C:\msys64\usr\bin\rsync.exe expected).
#     Install once: winget install MSYS2.MSYS2
#                   & "C:\msys64\usr\bin\bash.exe" -lc "pacman -Sy --noconfirm rsync openssh"
#   - Symlink already made on the Pi (one-shot, manual):
#     ssh pi@100.127.222.27 'ln -s /home/pi/signalk-pypilot-newui ~/.signalk/node_modules/signalk-pypilot-newui'

param(
    [switch]$SkipBuild,
    [switch]$Restart
)

$ErrorActionPreference = "Stop"

$piHost = "pi@100.127.222.27"
$piPath = "/home/pi/signalk-pypilot-newui"

# SSH options for flaky boat 4G + Tailscale
$sshOpts = @(
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=5",
    "-o", "ServerAliveCountMax=3",
    "-o", "BatchMode=yes"
)

function Invoke-Native {
    param([string]$Description, [scriptblock]$Block)
    & $Block
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "FAILED: $Description (exit code $LASTEXITCODE)" -ForegroundColor Red
        Write-Host "Aborting deploy. Quick checks:" -ForegroundColor Yellow
        Write-Host "  ping 100.127.222.27"
        Write-Host "  ssh $piHost `"echo OK`""
        Write-Host "  Tailscale icon in tray -- verify Pi online"
        Write-Host "  If NordVPN is running: it routes 100.x.x.x through its tunnel and breaks Tailscale TCP. Disconnect NordVPN."
        exit 1
    }
}

# --- Read PLUGIN_REVISION so the user sees what is about to ship ---
$srcIndex = Join-Path (Get-Location) "src\index.ts"
$revShipping = "?"
if (Test-Path $srcIndex) {
    $revLine = Select-String -Path $srcIndex -Pattern 'PLUGIN_REVISION\s*=\s*"([^"]+)"' | Select-Object -First 1
    if ($revLine -and $revLine.Matches[0].Groups.Count -ge 2) {
        $revShipping = $revLine.Matches[0].Groups[1].Value
    }
}
Write-Host ""
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host "  ABOUT TO DEPLOY: $revShipping (signalk-pypilot-newui)" -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host ""

# --- Pre-flight: reachability ---
Write-Host ">> Pre-flight: ping $piHost..." -ForegroundColor Cyan
$pingOk = Test-Connection -ComputerName "100.127.222.27" -Count 1 -Quiet -ErrorAction SilentlyContinue
if (-not $pingOk) {
    Write-Host "WARN: ping to 100.127.222.27 failed. Continuing anyway (Tailscale may still route TCP even when ICMP is filtered)." -ForegroundColor Yellow
}

# --- Build ---
if (-not $SkipBuild) {
    Write-Host ">> npm run build (tsc)..." -ForegroundColor Cyan
    Invoke-Native "npm run build" { npm run build }
}

# --- Locate rsync ---
$rsyncCandidates = @(
    "C:\Program Files\Git\usr\bin\rsync.exe",
    "C:\Program Files (x86)\Git\usr\bin\rsync.exe",
    "C:\msys64\usr\bin\rsync.exe",
    "C:\tools\msys64\usr\bin\rsync.exe",
    "rsync"
)
$rsyncPath = $null
foreach ($cand in $rsyncCandidates) {
    if ($cand -eq "rsync") {
        $cmd = Get-Command rsync -ErrorAction SilentlyContinue
        if ($cmd) { $rsyncPath = $cmd.Source; break }
    } elseif (Test-Path $cand) {
        $rsyncPath = $cand; break
    }
}
$useRsync = $null -ne $rsyncPath

if ($useRsync) {
    Write-Host ">> rsync detected: $rsyncPath" -ForegroundColor Green
} else {
    Write-Host ">> rsync not found -- falling back to scp (transfers EVERYTHING each time)." -ForegroundColor DarkYellow
}

# --- Prepare --rsh for rsync (point MSYS ssh at Windows-side keys/known_hosts) ---
$sshFlat = $null
if ($useRsync) {
    $rsyncDir = Split-Path $rsyncPath
    $gitSshExe = $null
    if ($rsyncDir) {
        $cand = Join-Path $rsyncDir "ssh.exe"
        if (Test-Path $cand) { $gitSshExe = $cand }
    }
    if ($gitSshExe) {
        $sshForRsync = $gitSshExe -replace "\\", "/"
        $winKnownHosts = (Join-Path $env:USERPROFILE ".ssh\known_hosts") -replace "\\", "/"
        $winIdentity = $null
        foreach ($k in @("id_ed25519","id_rsa","id_ecdsa")) {
            $p = Join-Path $env:USERPROFILE ".ssh\$k"
            if (Test-Path $p) { $winIdentity = $p -replace "\\", "/"; break }
        }
        $idFlag = if ($winIdentity) { "-o IdentityFile=`"$winIdentity`" -o IdentitiesOnly=yes" } else { "" }
        $sshFlat = "`"$sshForRsync`" -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -o BatchMode=yes -o UserKnownHostsFile=`"$winKnownHosts`" -o StrictHostKeyChecking=accept-new $idFlag"
        Write-Host "   using ssh: $gitSshExe" -ForegroundColor DarkGray
        if ($winIdentity) { Write-Host "   identity : $winIdentity" -ForegroundColor DarkGray }
    } else {
        $sshFlat = "ssh -o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -o BatchMode=yes"
    }
}

# --- Ensure remote dir exists ---
Invoke-Native "mkdir remote" { ssh @sshOpts $piHost "mkdir -p '$piPath'" }

# --- Ensure the SK node_modules symlink is in place ---
# SK sometimes wipes it on restart if the plugin was installed via npm before
# (a stale registry entry, an internal npm reinstall, etc.). If missing we
# recreate it before restarting so the webapp keeps serving.
Invoke-Native "ensure symlink" {
    ssh @sshOpts $piHost "if [ ! -L ~/.signalk/node_modules/signalk-pypilot-newui ]; then rm -rf ~/.signalk/node_modules/signalk-pypilot-newui; ln -s $piPath ~/.signalk/node_modules/signalk-pypilot-newui; echo 'symlink RECREATED'; else echo 'symlink OK'; fi"
}

# --- Sync files ---
if ($useRsync) {
    Write-Host ">> rsync dist/..." -ForegroundColor Cyan
    Invoke-Native "rsync dist" { & $rsyncPath -az --delete --timeout=30 "--rsh=$sshFlat" "dist/" "${piHost}:${piPath}/dist/" }

    Write-Host ">> rsync public/..." -ForegroundColor Cyan
    Invoke-Native "rsync public" { & $rsyncPath -az --delete --timeout=30 "--rsh=$sshFlat" "public/" "${piHost}:${piPath}/public/" }

    Write-Host ">> rsync package.json + package-lock.json + README + CHANGELOG..." -ForegroundColor Cyan
    $extras = @("package.json", "package-lock.json", "README.md", "CHANGELOG.md")
    $existing = $extras | Where-Object { Test-Path $_ }
    Invoke-Native "rsync extras" { & $rsyncPath -az --timeout=30 "--rsh=$sshFlat" @existing "${piHost}:${piPath}/" }
} else {
    Write-Host ">> scp -r dist/..." -ForegroundColor Cyan
    Invoke-Native "scp -r dist" { scp @sshOpts -r dist "${piHost}:${piPath}/" }

    Write-Host ">> scp -r public/..." -ForegroundColor Cyan
    Invoke-Native "scp -r public" { scp @sshOpts -r public "${piHost}:${piPath}/" }

    Write-Host ">> scp package.json + lockfile + docs..." -ForegroundColor Cyan
    $extras = @("package.json", "package-lock.json", "README.md", "CHANGELOG.md")
    $existing = $extras | Where-Object { Test-Path $_ }
    Invoke-Native "scp extras" { scp @sshOpts @existing "${piHost}:${piPath}/" }
}

Write-Host ""
Write-Host "OK -- Synced to ${piHost}:${piPath}" -ForegroundColor Green

# --- Install prod deps on the Pi (idempotent -- npm skips if lockfile matches) ---
Write-Host ">> Installing prod deps on Pi (idempotent)..." -ForegroundColor Cyan
Invoke-Native "remote npm install --omit=dev" {
    ssh @sshOpts $piHost "cd '$piPath' && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5"
}

# --- Restart or remind ---
if ($Restart) {
    Write-Host ">> Restarting Signal K server..." -ForegroundColor Cyan
    Invoke-Native "systemctl restart signalk" { ssh @sshOpts $piHost "sudo systemctl restart signalk" }
    Write-Host "OK -- SK restarted (wait ~15 s before testing)" -ForegroundColor Green
    Write-Host ""
    Write-Host ">> Tailing signalk logs for pypilot-newui hits (5 s)..." -ForegroundColor Cyan
    ssh @sshOpts $piHost "sleep 5 && journalctl -u signalk -n 40 --no-pager | grep -Ei 'pypilot-newui|error' | tail -20"
} else {
    Write-Host ""
    Write-Host "Next: .\deploy.ps1 -Restart   (backend edits need SK restart to reload)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Webapp URL:  http://100.127.222.27:3000/signalk-pypilot-newui/" -ForegroundColor Green
Write-Host "Admin URL:   http://100.127.222.27:3000/admin  (Plugin Config -> PyPilot New-UI + SK Paths)" -ForegroundColor Green
Write-Host ""
