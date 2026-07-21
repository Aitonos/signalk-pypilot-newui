# deploy.ps1 - build and push signalk-pypilot-newui to a Raspberry Pi.
#
# ASCII-only per PowerShell 5.1 constraints on this laptop (Windows-1252
# parser breaks on non-ASCII source characters). No em-dashes, no smart
# quotes, no emojis.
#
# Usage:
#   .\deploy.ps1                     (build + rsync, no SK restart)
#   .\deploy.ps1 -Restart            (build + rsync + sudo systemctl restart signalk)
#   .\deploy.ps1 -PiHost openplotter -PiUser pi -Restart
#
# Assumptions:
#   - The plugin is symlinked from ~/.signalk/node_modules/signalk-pypilot-newui
#     to ~/signalk-pypilot-newui on the Pi. If not, create the symlink once:
#       ln -s ~/signalk-pypilot-newui ~/.signalk/node_modules/signalk-pypilot-newui
#   - rsync + ssh installed on the laptop (msys2, git-bash, or built-in OpenSSH).

param(
    [switch]$Restart,
    [string]$PiHost = "100.127.222.27",
    [string]$PiUser = "pi",
    [string]$PiPath = "~/signalk-pypilot-newui",
    [switch]$SkipInstall
)

# Default PiHost is the Tunatunes Pi Tailscale IP - pi@openplotter does NOT
# resolve on the Windows laptop LAN (mDNS off / Tailscale only).

$ErrorActionPreference = "Stop"
$script:StepNo = 0

function Step {
    param([string]$msg)
    $script:StepNo++
    Write-Host ""
    Write-Host "[$script:StepNo] $msg" -ForegroundColor Cyan
}

function Check-ExitCode {
    param([string]$stage)
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: $stage failed with exit code $LASTEXITCODE" -ForegroundColor Red
        exit 1
    }
}

# --- 0. Location sanity check ---
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
if (-not (Test-Path "$here\package.json")) {
    Write-Host "ERROR: package.json not found. Run from the plugin root." -ForegroundColor Red
    exit 1
}

# --- 1. Install deps if node_modules missing ---
if (-not (Test-Path "$here\node_modules") -and -not $SkipInstall) {
    Step "npm install (first run)"
    npm install
    Check-ExitCode "npm install"
}

# --- 2. Build ---
Step "npm run build (tsc)"
npm run build
Check-ExitCode "npm run build"

# --- 3. Ping Pi first so a bad network fails fast ---
$target = "$PiUser@$PiHost"
Step "Pre-flight: ping $PiHost"
$pingOk = Test-Connection -ComputerName $PiHost -Count 1 -Quiet -ErrorAction SilentlyContinue
if (-not $pingOk) {
    Write-Host "WARN: ping to $PiHost failed - trying rsync anyway (mDNS/Tailscale can be one-directional)." -ForegroundColor Yellow
}

# --- 4. rsync source + dist + public ---
Step "rsync -> $target`:$PiPath"
# NOTE: rsync must handle Windows paths - use forward slashes and let ssh work.
# --delete-excluded: keep node_modules on the Pi (we do not want to send those).
$rsyncArgs = @(
    "-avz",
    "--delete",
    "--exclude=node_modules",
    "--exclude=.git",
    "--exclude=.vscode",
    "--exclude=*.log",
    "./",
    "$target`:$PiPath/"
)
& rsync @rsyncArgs
Check-ExitCode "rsync"

# --- 5. Install prod deps on the Pi if needed ---
Step "Install prod deps on Pi (if package.json changed)"
$installCmd = "cd $PiPath && npm install --omit=dev --no-audit --no-fund"
& ssh $target $installCmd
Check-ExitCode "remote npm install"

# --- 6. Restart SK if asked ---
if ($Restart) {
    Step "sudo systemctl restart signalk"
    & ssh $target "sudo systemctl restart signalk"
    Check-ExitCode "systemctl restart signalk"
    Start-Sleep -Seconds 3
    Step "Tail last 20 lines of signalk logs"
    & ssh $target "journalctl -u signalk -n 20 --no-pager"
}

Write-Host ""
Write-Host "OK - deployed. Webapp URL:" -ForegroundColor Green
Write-Host "  http://$PiHost`:3000/signalk-pypilot-newui/" -ForegroundColor Green
Write-Host ""
