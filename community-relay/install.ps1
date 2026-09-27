# -----------------------------------------------------------------------------
# InterPoll community relay - Windows installer
#
#   irm https://interpoll.endless.sbs/install.ps1 | iex      (PowerShell as Administrator)
#
# Installs Node.js LTS (winget) if missing, downloads the relay into
# %ProgramData%\InterPollRelay, registers a startup Scheduled Task, opens the
# firewall port and prints the relay URL. Re-running upgrades in place.
#
# Uninstall:
#   Unregister-ScheduledTask InterPollRelay -Confirm:$false
#   Remove-NetFirewallRule -DisplayName 'InterPoll Relay'
#   Remove-Item -Recurse "$env:ProgramData\InterPollRelay"
# -----------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$Base     = if ($env:INTERPOLL_BASE) { $env:INTERPOLL_BASE } else { 'https://interpoll.endless.sbs' }
$Port     = if ($env:RELAY_PORT) { [int]$env:RELAY_PORT } else { 8765 }
$Upstream = if ($null -ne $env:UPSTREAM_PEERS) { $env:UPSTREAM_PEERS } else { 'https://interpoll2.endless.sbs/gun' }
$Dir      = Join-Path $env:ProgramData 'InterPollRelay'
$TaskName = 'InterPollRelay'

function Info($m) { Write-Host "[interpoll] $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "[interpoll] $m" -ForegroundColor Green }
function Die($m)  { Write-Host "[interpoll] $m" -ForegroundColor Red; throw $m }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { Die 'Run PowerShell as Administrator and try again.' }

# --- Node.js -----------------------------------------------------------------
function Get-NodeMajor {
  $n = Get-Command node -ErrorAction SilentlyContinue
  if (-not $n) { return 0 }
  return [int]((& node -p "process.versions.node.split('.')[0]") 2>$null)
}
if ((Get-NodeMajor) -lt 18) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { Die 'Install Node.js 20+ from https://nodejs.org and re-run.' }
  Info 'Installing Node.js LTS via winget...'
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  if ((Get-NodeMajor) -lt 18) { Die 'Node.js install did not complete - open a new PowerShell window and re-run.' }
}
$NodeExe = (Get-Command node).Source
$NpmCmd  = Join-Path (Split-Path $NodeExe) 'npm.cmd'
Ok "Node.js $(& node -v) found"

# --- Files -------------------------------------------------------------------
Info "Installing relay into $Dir"
New-Item -ItemType Directory -Force -Path (Join-Path $Dir 'radata') | Out-Null
Invoke-WebRequest "$Base/relay-kit/relay.js"     -OutFile (Join-Path $Dir 'relay.js')     -UseBasicParsing
Invoke-WebRequest "$Base/relay-kit/package.json" -OutFile (Join-Path $Dir 'package.json') -UseBasicParsing

$runner = @"
@echo off
cd /d "$Dir"
set PORT=$Port
set GUN_DATA_DIR=$Dir\radata
set UPSTREAM_PEERS=$Upstream
"$NodeExe" relay.js >> "$Dir\relay.log" 2>&1
"@
Set-Content -Path (Join-Path $Dir 'run-relay.cmd') -Value $runner -Encoding ASCII

Info 'Installing dependencies...'
Push-Location $Dir
try { & $NpmCmd install --omit=dev --no-audit --no-fund --loglevel=error | Out-Null } finally { Pop-Location }
if ($LASTEXITCODE -ne 0) { Die 'npm install failed' }
Ok 'Dependencies installed'

# --- Startup task ------------------------------------------------------------
Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
$action    = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$Dir\run-relay.cmd`"" -WorkingDirectory $Dir
$trigger   = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) `
               -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings `
  -Description 'InterPoll community Gun relay' | Out-Null
Start-ScheduledTask -TaskName $TaskName

if (-not (Get-NetFirewallRule -DisplayName 'InterPoll Relay' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'InterPoll Relay' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Private,Domain | Out-Null
  Ok "Opened TCP $Port in Windows Firewall (private networks)"
}

# --- Health check ------------------------------------------------------------
Info 'Waiting for the relay to come up...'
$up = $false
for ($i = 0; $i -lt 30 -and -not $up; $i++) {
  try { Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2 | Out-Null; $up = $true } catch { Start-Sleep 1 }
}
if (-not $up) { Die "Relay did not start. See $Dir\relay.log" }
Ok 'Relay is running'

$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -First 1).IPAddress
if (-not $ip) { $ip = '127.0.0.1' }

Write-Host ''
Write-Host '------------------------------------------------------------'
Ok 'InterPoll relay is live on your network:'
Write-Host ''
Write-Host "    http://${ip}:$Port/gun" -ForegroundColor Green
Write-Host ''
Write-Host '  Add it in the app: Settings > Network > Relay Configuration'
Write-Host "  Logs: $Dir\relay.log"
Write-Host "  To reach it from the internet, forward TCP $Port on your router to $ip."
Write-Host '------------------------------------------------------------'
