# Scan tracked text files for high-confidence hard-coded secrets.

[CmdletBinding()]
param(
  [switch]$FailOnFinding,
  [switch]$IncludeDocs,
  [switch]$PauseOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\common.ps1"

$secretRules = @(
  @{
    Name = 'Private key block'
    Pattern = '-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----'
  },
  @{
    Name = 'Generic assignment secret'
    Pattern = '(?i)\b(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["'']([A-Za-z0-9_\-./+=]{24,})["'']'
  },
  @{
    Name = 'Bearer token'
    Pattern = '(?i)\bBearer\s+([A-Za-z0-9_\-./+=]{24,})'
  },
  @{
    Name = 'Google API key'
    Pattern = 'AIza[0-9A-Za-z_\-]{35}'
  },
  @{
    Name = 'GitHub token'
    Pattern = 'gh[opsu]_[A-Za-z0-9_]{36,}'
  },
  @{
    Name = 'Slack token'
    Pattern = 'xox[baprs]-[A-Za-z0-9-]{20,}'
  },
  @{
    Name = 'AWS access key'
    Pattern = 'AKIA[0-9A-Z]{16}'
  },
  @{
    Name = 'Possible JWT'
    Pattern = 'eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}'
  }
)

$skipPathPatterns = @(
  '(^|/)node_modules/',
  '(^|/)dist/',
  '(^|/)dist-ssr/',
  '(^|/)build/',
  '(^|/)coverage/',
  '(^|/)\.cache/',
  '(^|/)peer-data/',
  '(^|/)radata/',
  '(^|/)app/gun-relay-server/radata/',
  '(^|/)gun-relay-server/radata/',
  '(^|/)relay-server/data/',
  '(^|/)message-cache\.json$',
  '(^|/)storage\.txt$',
  '(^|/)package-lock\.json$',
  '(^|/)app\.zip$',
  '(^|/)shared-validation\.zip$'
)

$binaryExtensions = @(
  '.zip', '.7z', '.gz', '.tar', '.tgz', '.png', '.jpg', '.jpeg', '.gif',
  '.webp', '.ico', '.svgz', '.pdf', '.woff', '.woff2', '.ttf', '.eot',
  '.mp4', '.webm', '.mov', '.mp3', '.wav', '.wasm'
)

$docExtensions = @('.md', '.markdown', '.txt')

function ConvertTo-RepoSlashPath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  return ($Path -replace '\\', '/')
}

function Test-ScannablePath {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Path
  )

  $slashPath = ConvertTo-RepoSlashPath -Path $Path

  foreach ($pattern in $skipPathPatterns) {
    if ($slashPath -match $pattern) {
      return $false
    }
  }

  $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  if ($binaryExtensions -contains $extension) {
    return $false
  }

  if (-not $IncludeDocs -and (($docExtensions -contains $extension) -or $slashPath -match '(^|/)docs/')) {
    return $false
  }

  return $true
}

function Redact-SecretText {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Value
  )

  if ($Value.Length -le 8) {
    return '<redacted>'
  }

  $prefixLength = [Math]::Min(4, $Value.Length)
  $suffixLength = [Math]::Min(4, [Math]::Max(0, $Value.Length - $prefixLength))
  return $Value.Substring(0, $prefixLength) + '...' + $Value.Substring($Value.Length - $suffixLength)
}

function Get-RedactedLine {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Line,

    [Parameter(Mandatory = $true)]
    [System.Text.RegularExpressions.Match]$Match
  )

  $secret = if ($Match.Groups.Count -gt 1 -and $Match.Groups[1].Success) {
    $Match.Groups[1].Value
  } else {
    $Match.Value
  }

  return $Line.Replace($secret, (Redact-SecretText -Value $secret)).Trim()
}

try {
  $repoRoot = Resolve-RepoRoot

  Write-Host 'Scanning tracked files only (git ls-files). Untracked files are not included.'

  $findings = New-Object System.Collections.Generic.List[object]

  Invoke-InRepo -RepoRoot $repoRoot -ScriptBlock {
    Assert-CommandAvailable -Name 'git' | Out-Null

    $rawFiles = & git -c core.quotepath=false ls-files -z
    $exitCode = if ($LASTEXITCODE -is [int]) { [int]$LASTEXITCODE } else { 0 }
    if ($exitCode -ne 0) {
      throw (New-CommandFailedException -Message "git ls-files failed with exit code $exitCode" -ExitCode $exitCode)
    }

    $files = @($rawFiles -split "`0" | Where-Object { $_ })
    foreach ($file in $files) {
      if (-not (Test-ScannablePath -Path $file)) {
        continue
      }

      $absolutePath = Assert-RepoRelativePath -RepoRoot $repoRoot -RelativePath $file
      if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
        continue
      }

      try {
        $content = Get-Content -LiteralPath $absolutePath -Raw -ErrorAction Stop
      } catch {
        continue
      }

      if ($null -eq $content) {
        $content = ''
      }

      if ($content.IndexOf([char]0) -ge 0) {
        continue
      }

      $lines = $content -split "`r?`n"
      for ($lineNumber = 0; $lineNumber -lt $lines.Count; $lineNumber++) {
        $line = $lines[$lineNumber]
        foreach ($rule in $secretRules) {
          $matches = [regex]::Matches($line, [string]$rule.Pattern)
          foreach ($match in $matches) {
            $findings.Add([pscustomobject]@{
              Path = $file
              Line = $lineNumber + 1
              Rule = [string]$rule.Name
              Preview = Get-RedactedLine -Line $line -Match $match
            }) | Out-Null
          }
        }
      }
    }
  }

  if ($findings.Count -eq 0) {
    Write-Host 'No high-confidence hard-coded secrets found in tracked text files.'
    exit 0
  }

  [Console]::Error.WriteLine("Potential hard-coded secrets found: $($findings.Count)")
  foreach ($finding in $findings) {
    [Console]::Error.WriteLine("- $($finding.Path):$($finding.Line) [$($finding.Rule)] $($finding.Preview)")
  }

  if ($FailOnFinding) {
    throw (New-CommandFailedException -Message "Secret scan found $($findings.Count) potential secret(s)." -ExitCode 1)
  }

  Write-Host ''
  Write-Host 'Secret scan is report-only by default. Re-run with -FailOnFinding to make findings blocking.'
  exit 0
} catch {
  Exit-WithError -ErrorRecord $_ -FailureSummary 'Secret scan failed.' -PauseOnFailure:$PauseOnFailure
}
