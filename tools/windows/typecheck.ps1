# Run the reproducible TypeScript/Vue typecheck gate.

[CmdletBinding()]
param(
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
    Assert-LocalNpmBin -Name 'vue-tsc' -RepoRoot $repoRoot | Out-Null

    Invoke-LoggedCommand -FilePath $npm -ArgumentList @('exec', '--', 'vue-tsc', '--noEmit', '-p', 'tsconfig.json')
  }
} catch {
  Exit-WithError -ErrorRecord $_ -FailureSummary 'Typecheck failed.' -PauseOnFailure:$PauseOnFailure
}
