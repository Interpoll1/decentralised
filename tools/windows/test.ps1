# Run the Vitest unit test workflow on Windows.

[CmdletBinding()]
param(
  [string[]]$TestFilter = @(),
  [switch]$Watch,
  [switch]$PauseOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

try {
  $repoRoot = Resolve-RepoRoot

  Invoke-InRepo -RepoRoot $repoRoot -ScriptBlock {
    Get-PackageManager -RepoRoot $repoRoot | Out-Null
    $npm = Get-NpmCommand
    Assert-NodeModulesInstalled -RepoRoot $repoRoot
    Assert-LocalNpmBin -Name 'vitest' -RepoRoot $repoRoot | Out-Null

    $scriptName = if ($Watch) { 'test:watch' } else { 'test' }
    $args = @('run', $scriptName)

    if ($TestFilter.Count -gt 0) {
      $args += '--'
      $args += $TestFilter
    }

    Invoke-LoggedCommand -FilePath $npm -ArgumentList $args
  }
} catch {
  Exit-WithError -ErrorRecord $_ -FailureSummary 'Tests failed.' -PauseOnFailure:$PauseOnFailure
}
