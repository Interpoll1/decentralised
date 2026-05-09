# Run the focused local adversarial/security Vitest subset on Windows.

[CmdletBinding()]
param(
  [string[]]$TestFilter = @(),
  [switch]$PauseOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

$defaultFilters = @(
  'ws-validators.test.js',
  'pow-challenge.test.js',
  'security-utils.test.js',
  'rate-limiter.test.js',
  'bot-detector.test.js',
  'spam-scorer.test.js',
  'chainValidation.test.ts',
  'eventService.test.ts',
  'cryptoService.test.ts',
  'config.test.ts',
  'mnemonicHelper.test.ts'
)

function ConvertTo-PowerShellSingleQuotedLiteral {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  return "'" + ($Value -replace "'", "''") + "'"
}

try {
  $repoRoot = Resolve-RepoRoot
  $filters = if ($TestFilter.Count -gt 0) { $TestFilter } else { $defaultFilters }

  Invoke-InRepo -RepoRoot $repoRoot -ScriptBlock {
    Get-PackageManager -RepoRoot $repoRoot | Out-Null
    Get-NpmCommand | Out-Null
    Assert-NodeModulesInstalled -RepoRoot $repoRoot
    Assert-LocalNpmBin -Name 'vitest' -RepoRoot $repoRoot | Out-Null
  }

  Write-Host 'Running focused adversarial/security tests:'
  foreach ($filter in $filters) {
    Write-Host "  - $filter"
  }

  $testScriptPath = Join-Path $PSScriptRoot 'test.ps1'
  $filterLiteral = '@(' + (($filters | ForEach-Object {
    ConvertTo-PowerShellSingleQuotedLiteral -Value $_
  }) -join ', ') + ')'
  $command = '& ' + (ConvertTo-PowerShellSingleQuotedLiteral -Value $testScriptPath) + " -TestFilter $filterLiteral"
  $powerShell = Get-PowerShellExecutable
  Invoke-LoggedCommand -FilePath $powerShell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $command)
} catch {
  Exit-WithError -ErrorRecord $_ -FailureSummary 'Adversarial tests failed.' -PauseOnFailure:$PauseOnFailure
}
