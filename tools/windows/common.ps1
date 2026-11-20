# Shared helpers for Windows contributor scripts.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$global:InterPollLastCommandExitCode = 0

function Resolve-RepoRoot {
  [CmdletBinding()]
  param()

  $root = Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')
  $rootPath = $root.ProviderPath
  $packageJson = Join-Path $rootPath 'package.json'

  if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) {
    throw "Could not resolve repo root from '$PSScriptRoot'. Missing package.json at '$packageJson'."
  }

  return $rootPath
}

function Get-PackageManager {
  [CmdletBinding()]
  param(
    [string]$RepoRoot = (Resolve-RepoRoot)
  )

  $packageLock = Join-Path $RepoRoot 'package-lock.json'
  if (-not (Test-Path -LiteralPath $packageLock -PathType Leaf)) {
    throw 'This repo expects npm, but package-lock.json was not found.'
  }

  $unexpectedLockFiles = @(
    'pnpm-lock.yaml',
    'yarn.lock',
    'bun.lock',
    'bun.lockb',
    'npm-shrinkwrap.json'
  )

  $presentUnexpected = @(
    foreach ($lockFile in $unexpectedLockFiles) {
      if (Test-Path -LiteralPath (Join-Path $RepoRoot $lockFile) -PathType Leaf) {
        $lockFile
      }
    }
  )

  if ($presentUnexpected.Count -gt 0) {
    throw "Ambiguous package manager lockfiles found: $($presentUnexpected -join ', '). This script only supports npm for this repo."
  }

  $packageJsonPath = Join-Path $RepoRoot 'package.json'
  $packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
  $hasPackageManager = $packageJson.PSObject.Properties.Name -contains 'packageManager'

  if ($hasPackageManager -and $packageJson.packageManager -and ($packageJson.packageManager -notmatch '^npm@')) {
    throw "package.json declares packageManager '$($packageJson.packageManager)', but package-lock.json indicates npm."
  }

  return 'npm'
}

function Assert-CommandAvailable {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name
  )

  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) {
    throw "Required command '$Name' was not found on PATH."
  }

  return $command
}

function Get-NpmCommand {
  [CmdletBinding()]
  param()

  $npmCmd = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
  if ($npmCmd) {
    return 'npm.cmd'
  }

  Assert-CommandAvailable -Name 'npm' | Out-Null
  return 'npm'
}

function Assert-NodeModulesInstalled {
  [CmdletBinding()]
  param(
    [string]$RepoRoot = (Resolve-RepoRoot)
  )

  if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot 'node_modules') -PathType Container)) {
    throw "node_modules is missing. Run '.\tools\windows\setup.ps1' first."
  }
}

function Assert-LocalNpmBin {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Name,

    [string]$RepoRoot = (Resolve-RepoRoot)
  )

  $binDir = Join-Path $RepoRoot 'node_modules\.bin'
  $candidates = @(
    (Join-Path $binDir "$Name.cmd"),
    (Join-Path $binDir "$Name.ps1"),
    (Join-Path $binDir $Name)
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      return $candidate
    }
  }

  throw "Local npm binary '$Name' was not found under node_modules\.bin. Run '.\tools\windows\setup.ps1' first."
}

function Format-CommandLine {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [string[]]$ArgumentList = @()
  )

  $parts = @($FilePath) + $ArgumentList
  return (($parts | ForEach-Object {
    $part = [string]$_
    if ($part.Length -eq 0) {
      '""'
    } elseif ($part -match '[\s"]') {
      '"' + ($part -replace '"', '\"') + '"'
    } else {
      $part
    }
  }) -join ' ')
}

function New-CommandFailedException {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$Message,

    [Parameter(Mandatory = $true)]
    [int]$ExitCode,

    [string]$CommandLine = ''
  )

  $exception = [System.Exception]::new($Message)
  $exception.Data['ExitCode'] = $ExitCode
  if ($CommandLine) {
    $exception.Data['CommandLine'] = $CommandLine
  }
  return $exception
}

function Invoke-LoggedCommand {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,

    [string[]]$ArgumentList = @()
  )

  $commandLine = Format-CommandLine -FilePath $FilePath -ArgumentList $ArgumentList
  Write-Host ">> $commandLine"

  $global:InterPollLastCommandExitCode = 0
  & $FilePath @ArgumentList
  $exitCode = if ($LASTEXITCODE -is [int]) { [int]$LASTEXITCODE } else { 0 }

  if ($exitCode -ne 0) {
    $global:InterPollLastCommandExitCode = $exitCode
    throw (New-CommandFailedException -Message "Command failed with exit code ${exitCode}: $commandLine" -ExitCode $exitCode -CommandLine $commandLine)
  }
}

function Invoke-InRepo {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [scriptblock]$ScriptBlock
  )

  Push-Location -LiteralPath $RepoRoot
  try {
    & $ScriptBlock
  } finally {
    Pop-Location
  }
}

function Get-PowerShellExecutable {
  [CmdletBinding()]
  param()

  $pwsh = Get-Command pwsh -ErrorAction SilentlyContinue
  if ($pwsh) {
    return $pwsh.Source
  }

  $powershell = Get-Command powershell.exe -ErrorAction SilentlyContinue
  if ($powershell) {
    return $powershell.Source
  }

  throw 'Could not find pwsh or powershell.exe on PATH.'
}

function Invoke-PowerShellScript {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$ScriptPath,

    [string[]]$ArgumentList = @()
  )

  $powerShell = Get-PowerShellExecutable
  $args = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ScriptPath) + $ArgumentList
  Invoke-LoggedCommand -FilePath $powerShell -ArgumentList $args
}

function Get-GitStatusShort {
  [CmdletBinding()]
  param(
    [string]$RepoRoot = (Resolve-RepoRoot)
  )

  Invoke-InRepo -RepoRoot $RepoRoot -ScriptBlock {
    $output = & git status --short
    $exitCode = if ($LASTEXITCODE -is [int]) { [int]$LASTEXITCODE } else { 0 }
    if ($exitCode -ne 0) {
      throw (New-CommandFailedException -Message "git status --short failed with exit code $exitCode" -ExitCode $exitCode)
    }
    return @($output)
  }
}

function Assert-CleanTrackedState {
  [CmdletBinding()]
  param(
    [string]$RepoRoot = (Resolve-RepoRoot)
  )

  $status = @(Get-GitStatusShort -RepoRoot $RepoRoot)
  if ($status.Count -gt 0) {
    throw "Working tree is not clean:`n$($status -join [Environment]::NewLine)"
  }
}

function Assert-RepoRelativePath {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [string]$RepoRoot,

    [Parameter(Mandatory = $true)]
    [string]$RelativePath
  )

  $rootFull = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
  )
  $candidate = [System.IO.Path]::GetFullPath((Join-Path $rootFull $RelativePath))
  $comparison = [System.StringComparison]::OrdinalIgnoreCase
  $prefix = $rootFull + [System.IO.Path]::DirectorySeparatorChar

  if (($candidate -ne $rootFull) -and (-not $candidate.StartsWith($prefix, $comparison))) {
    throw "Path '$RelativePath' resolves outside the repo root."
  }

  return $candidate
}

function Get-ErrorExitCode {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [System.Management.Automation.ErrorRecord]$ErrorRecord
  )

  $exception = $ErrorRecord.Exception
  while ($exception) {
    if ($exception.Data.Contains('ExitCode')) {
      return [int]$exception.Data['ExitCode']
    }
    $exception = $exception.InnerException
  }

  if ($global:InterPollLastCommandExitCode -ne 0) {
    return [int]$global:InterPollLastCommandExitCode
  }

  return 1
}

function Get-ErrorCommandLine {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [System.Management.Automation.ErrorRecord]$ErrorRecord
  )

  $exception = $ErrorRecord.Exception
  while ($exception) {
    if ($exception.Data.Contains('CommandLine')) {
      return [string]$exception.Data['CommandLine']
    }
    $exception = $exception.InnerException
  }

  return ''
}

function Exit-WithError {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [System.Management.Automation.ErrorRecord]$ErrorRecord,

    [Parameter(Mandatory = $true)]
    [string]$FailureSummary,

    [switch]$PauseOnFailure
  )

  $exitCode = Get-ErrorExitCode -ErrorRecord $ErrorRecord
  $commandLine = Get-ErrorCommandLine -ErrorRecord $ErrorRecord

  [Console]::Error.WriteLine('')
  [Console]::Error.WriteLine("FAILED: $FailureSummary")
  if ($commandLine) {
    [Console]::Error.WriteLine("Command: $commandLine")
  } else {
    [Console]::Error.WriteLine("Reason: $($ErrorRecord.Exception.Message)")
  }
  [Console]::Error.WriteLine("Exit code: $exitCode")

  if ($PauseOnFailure) {
    [Console]::Error.WriteLine('')
    [Console]::Error.Write('Press Enter to exit...')
    [Console]::ReadLine() | Out-Null
  }

  exit $exitCode
}
