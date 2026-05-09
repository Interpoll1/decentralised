# Run npm dependency audit as a fail-closed security gate.

[CmdletBinding()]
param(
  [ValidateSet('moderate', 'high', 'critical')]
  [string]$AuditLevel = 'high',

  [switch]$ProductionOnly,
  [switch]$Json,

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

    $args = @('audit', "--audit-level=$AuditLevel")
    if ($ProductionOnly) {
      $args += '--omit=dev'
    }
    if ($Json) {
      $args += '--json'
    }

    Invoke-LoggedCommand -FilePath $npm -ArgumentList $args
  }
} catch {
  Exit-WithError -ErrorRecord $_ -FailureSummary 'Security audit failed.' -PauseOnFailure:$PauseOnFailure
}
