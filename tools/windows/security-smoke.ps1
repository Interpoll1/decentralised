# Run safe local security smoke checks and summarize all results.

[CmdletBinding()]
param(
  [ValidateSet('moderate', 'high', 'critical')]
  [string]$AuditLevel = 'high',

  [switch]$ProductionOnly,
  [switch]$SkipAudit,
  [switch]$SkipAdversarialTests,
  [switch]$SkipSecretScan,
  [switch]$FailOnSecretFinding,
  [switch]$AllowNoChecks,
  [switch]$PauseOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

function Invoke-SmokeCheck {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,

    [string[]]$ArgumentList = @()
  )

  Write-Host "== $Name =="
  try {
    Invoke-PowerShellScript -ScriptPath $ScriptPath -ArgumentList $ArgumentList | ForEach-Object {
      Write-Host $_
    }
    return [pscustomobject]@{
      Name = $Name
      ExitCode = 0
      Status = 'PASS'
    }
  } catch {
    $exitCode = Get-ErrorExitCode -ErrorRecord $_
    $commandLine = Get-ErrorCommandLine -ErrorRecord $_
    [Console]::Error.WriteLine('')
    [Console]::Error.WriteLine("FAILED: $Name failed.")
    if ($commandLine) {
      [Console]::Error.WriteLine("Command: $commandLine")
    } else {
      [Console]::Error.WriteLine("Reason: $($_.Exception.Message)")
    }
    [Console]::Error.WriteLine("Exit code: $exitCode")
    [Console]::Error.WriteLine('')

    return [pscustomobject]@{
      Name = $Name
      ExitCode = $exitCode
      Status = 'FAIL'
    }
  }
}

try {
  $repoRoot = Resolve-RepoRoot

  Invoke-InRepo -RepoRoot $repoRoot -ScriptBlock {
    Get-PackageManager -RepoRoot $repoRoot | Out-Null
    Get-NpmCommand | Out-Null
  }

  $results = @()

  if ($SkipAdversarialTests) {
    Write-Host '== Adversarial tests skipped =='
  } else {
    $results += Invoke-SmokeCheck -Name 'Adversarial tests' -ScriptPath (Join-Path $PSScriptRoot 'adversarial-test.ps1')
  }

  if ($SkipSecretScan) {
    Write-Host '== Secret scan skipped =='
  } else {
    $secretScanArgs = @()
    if ($FailOnSecretFinding) {
      $secretScanArgs += '-FailOnFinding'
    }
    $results += Invoke-SmokeCheck -Name 'Secret scan' -ScriptPath (Join-Path $PSScriptRoot 'secret-scan.ps1') -ArgumentList $secretScanArgs
  }

  if ($SkipAudit) {
    Write-Host '== Security audit skipped =='
  } else {
    $auditArgs = @('-AuditLevel', $AuditLevel)
    if ($ProductionOnly) {
      $auditArgs += '-ProductionOnly'
    }
    $results += Invoke-SmokeCheck -Name 'Dependency audit' -ScriptPath (Join-Path $PSScriptRoot 'security-audit.ps1') -ArgumentList $auditArgs
  }

  Write-Host ''
  Write-Host '== Security smoke summary =='
  if ($results.Count -eq 0) {
    Write-Host 'No checks were run.'
    if ($AllowNoChecks) {
      Write-Host 'No-op security smoke run allowed because -AllowNoChecks was provided.'
      exit 0
    }

    throw (New-CommandFailedException -Message 'Security smoke refused to pass because no checks were run. Re-run with -AllowNoChecks for an intentional no-op.' -ExitCode 1)
  }

  foreach ($result in $results) {
    Write-Host ("{0}: {1} (exit {2})" -f $result.Name, $result.Status, $result.ExitCode)
  }

  $failed = @($results | Where-Object { $_.ExitCode -ne 0 })
  if ($failed.Count -gt 0) {
    $firstExitCode = [int]$failed[0].ExitCode
    throw (New-CommandFailedException -Message "Security smoke failed. First failing check: $($failed[0].Name)." -ExitCode $firstExitCode)
  }

  exit 0
} catch {
  Exit-WithError -ErrorRecord $_ -FailureSummary 'Security smoke failed.' -PauseOnFailure:$PauseOnFailure
}
