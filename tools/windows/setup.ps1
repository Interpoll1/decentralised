# Verify prerequisites and install local npm dependencies for Windows contributors.

[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$PauseOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

try {
  $repoRoot = Resolve-RepoRoot

  Invoke-InRepo -RepoRoot $repoRoot -ScriptBlock {
    Get-PackageManager -RepoRoot $repoRoot | Out-Null
    Assert-CommandAvailable -Name 'node' | Out-Null
    $npm = Get-NpmCommand

    Invoke-LoggedCommand -FilePath 'node' -ArgumentList @('-v')
    Invoke-LoggedCommand -FilePath $npm -ArgumentList @('-v')

    if ($SkipInstall) {
      Write-Host 'Skipping npm ci because -SkipInstall was provided.'
      return
    }

    Invoke-LoggedCommand -FilePath $npm -ArgumentList @('ci')
  }
} catch {
  Exit-WithError -ErrorRecord $_ -FailureSummary 'Windows setup failed.' -PauseOnFailure:$PauseOnFailure
}
