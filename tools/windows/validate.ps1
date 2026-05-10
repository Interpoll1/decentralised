# Run the Windows PR validation workflow.

[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$SkipAudit,
  [string[]]$TestFilter = @(),
  [switch]$PauseOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

try {
  $repoRoot = Resolve-RepoRoot

  Invoke-InRepo -RepoRoot $repoRoot -ScriptBlock {
    Get-PackageManager -RepoRoot $repoRoot | Out-Null
    Get-NpmCommand | Out-Null
  }

  Write-Host '== Typecheck =='
  Invoke-PowerShellScript -ScriptPath (Join-Path $PSScriptRoot 'typecheck.ps1')

  Write-Host '== Tests =='
  $testArgs = @()
  if ($TestFilter.Count -gt 0) {
    $testArgs += '-TestFilter'
    $testArgs += $TestFilter
  }
  Invoke-PowerShellScript -ScriptPath (Join-Path $PSScriptRoot 'test.ps1') -ArgumentList $testArgs

  if ($SkipAudit) {
    Write-Host '== Security audit skipped =='
  } else {
    Write-Host '== Security audit =='
    Invoke-PowerShellScript -ScriptPath (Join-Path $PSScriptRoot 'security-audit.ps1')
  }

  if ($SkipBuild) {
    Write-Host '== Build skipped =='
  } else {
    Write-Host '== Build =='
    Invoke-InRepo -RepoRoot $repoRoot -ScriptBlock {
      $npm = Get-NpmCommand
      Invoke-LoggedCommand -FilePath $npm -ArgumentList @('run', 'build')
    }
  }
} catch {
  Exit-WithError -ErrorRecord $_ -FailureSummary 'Windows validation failed.' -PauseOnFailure:$PauseOnFailure
}
