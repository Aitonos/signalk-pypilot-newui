# deploy.ps1 -- build + sync signalk-pypilot-newui to Tunatunes Pi over Tailscale.
#
# ASCII only. Every native call is followed by a $LASTEXITCODE check.
#
# IMPORTANT: All paths inside the script are ABSOLUTE (built off $here).
# Never rely on the caller's working directory - we may be invoked from a
# sibling repo's shell.
#
# Usage:
#   .\deploy.ps1                # build + rsync (no SK restart)
#   .\deploy.ps1 -SkipBuild     # sync only (public/* edits)
#   .\deploy.ps1 -Restart       # build + rsync + systemctl restart signalk

param(
    [switch]$SkipBuild,
    [switch]$Restart
)

$ErrorActionPreference = "Stop"

# --- Anchor everything to the script's own directory ---
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$piHost = "pi@100.127.222.27"
$piPath = "/home/pi/signalk-pypilot-newui"

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
        Write-Host "  Tailscale online?  NordVPN off?"
        exit 1
    }
}

# --- Read PLUGIN_REVISION from OUR src (absolute path) ---
$srcIndex = Join-Path $here "src\index.ts"
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
Write-Host "  from: $here" -ForegroundColor Magenta
Write-Host "================================================================" -ForegroundColor Magenta
Write-Host ""

# --- Pre-flight ---
Write-Host ">> Pre-flight: ping $piHost..." -ForegroundColor Cyan
Test-Connection -ComputerName "100.127.222.27" -Count 1 -Quiet -ErrorAction SilentlyContinue | Out-Null

# --- Build (in $here explicitly, do not trust cwd) ---
if (-not $SkipBuild) {
    Write-Host ">> npm run build (tsc) in $here..." -ForegroundColor Cyan
    Invoke-Native "npm run build" { npm --prefix "$here" run build }
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
    Write-Host ">> rsync not found -- falling back to scp." -ForegroundColor DarkYellow
}

# --- Prepare --rsh for MSYS rsync ---
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
Invoke-Native "ensure symlink" {
    ssh @sshOpts $piHost "if [ ! -L ~/.signalk/node_modules/signalk-pypilot-newui ]; then rm -rf ~/.signalk/node_modules/signalk-pypilot-newui; ln -s $piPath ~/.signalk/node_modules/signalk-pypilot-newui; echo 'symlink RECREATED'; else echo 'symlink OK'; fi"
}

# --- Sync files (all SOURCES rooted in $here so cwd is irrelevant) ---
# rsync (msys/cygwin) does NOT accept Windows drive-letter paths - the colon
# after C: is parsed as host:path. Convert to MSYS form: C:\foo\bar -> /c/foo/bar
function ConvertTo-MsysPath {
    param([string]$WinPath)
    $p = $WinPath -replace "\\", "/"
    if ($p -match '^([A-Za-z]):/(.*)$') {
        $drive = $matches[1].ToLower()
        return "/$drive/$($matches[2])"
    }
    return $p
}
$hereMsys = ConvertTo-MsysPath $here

# Sanity: refuse to deploy if this repo does not look like ours (typo protection).
$ourPkg = Join-Path $here "package.json"
if (-not (Test-Path $ourPkg)) {
    Write-Host "FAILED: $ourPkg does not exist. Wrong repo?" -ForegroundColor Red
    exit 1
}
$pkgJson = Get-Content $ourPkg -Raw
if ($pkgJson -notmatch '"name"\s*:\s*"signalk-pypilot-newui"') {
    Write-Host "FAILED: package.json name is not signalk-pypilot-newui. Refusing to deploy." -ForegroundColor Red
    exit 1
}

if ($useRsync) {
    Write-Host ">> rsync dist/..." -ForegroundColor Cyan
    Invoke-Native "rsync dist" { & $rsyncPath -az --delete --timeout=30 "--rsh=$sshFlat" "$hereMsys/dist/" "${piHost}:${piPath}/dist/" }

    Write-Host ">> rsync public/..." -ForegroundColor Cyan
    Invoke-Native "rsync public" { & $rsyncPath -az --delete --timeout=30 "--rsh=$sshFlat" "$hereMsys/public/" "${piHost}:${piPath}/public/" }

    Write-Host ">> rsync package.json + package-lock.json + README + CHANGELOG + NOTICE..." -ForegroundColor Cyan
    $extras = @("package.json", "package-lock.json", "README.md", "CHANGELOG.md", "NOTICE")
    $existing = @()
    foreach ($e in $extras) {
        $abs = Join-Path $here $e
        if (Test-Path $abs) { $existing += (ConvertTo-MsysPath $abs) }
    }
    Invoke-Native "rsync extras" { & $rsyncPath -az --timeout=30 "--rsh=$sshFlat" @existing "${piHost}:${piPath}/" }
} else {
    Write-Host ">> scp -r dist/..." -ForegroundColor Cyan
    Invoke-Native "scp -r dist" { scp @sshOpts -r (Join-Path $here "dist") "${piHost}:${piPath}/" }

    Write-Host ">> scp -r public/..." -ForegroundColor Cyan
    Invoke-Native "scp -r public" { scp @sshOpts -r (Join-Path $here "public") "${piHost}:${piPath}/" }

    Write-Host ">> scp extras..." -ForegroundColor Cyan
    $extras = @("package.json", "package-lock.json", "README.md", "CHANGELOG.md", "NOTICE")
    foreach ($e in $extras) {
        $abs = Join-Path $here $e
        if (Test-Path $abs) {
            Invoke-Native "scp $e" { scp @sshOpts $abs "${piHost}:${piPath}/" }
        }
    }
}

Write-Host ""
Write-Host "OK -- Synced to ${piHost}:${piPath}" -ForegroundColor Green

# --- Install prod deps on the Pi (idempotent) ---
Write-Host ">> Installing prod deps on Pi..." -ForegroundColor Cyan
Invoke-Native "remote npm install --omit=dev" {
    ssh @sshOpts $piHost "cd '$piPath' && npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5"
}

# --- Restart or remind ---
if ($Restart) {
    Write-Host ">> Restarting Signal K server..." -ForegroundColor Cyan
    Invoke-Native "systemctl restart signalk" { ssh @sshOpts $piHost "sudo systemctl restart signalk" }
    Write-Host "OK -- SK restarted (wait ~15 s before testing)" -ForegroundColor Green
    Write-Host ""
    Write-Host ">> Tailing signalk logs for pypilot-newui hits..." -ForegroundColor Cyan
    ssh @sshOpts $piHost "sleep 5 && journalctl -u signalk -n 40 --no-pager | grep -Ei 'pypilot-newui|error' | grep -v pushover | tail -20"
} else {
    Write-Host ""
    Write-Host "Next: .\deploy.ps1 -Restart" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Webapp URL:  http://100.127.222.27:3000/signalk-pypilot-newui/" -ForegroundColor Green
Write-Host "Admin URL:   http://100.127.222.27:3000/admin  (Plugin Config -> PyPilot New-UI + SK Paths)" -ForegroundColor Green
Write-Host ""
