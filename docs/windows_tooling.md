# Windows Tooling Summary

This repo now has a Windows-first validation and security-smoke toolchain under `tools/windows/`.

## Core helper

### `common.ps1`

Shared infrastructure used by every other script.

It handles:

- Repo-root detection from `tools/windows/`
- npm-only package-manager enforcement via `package-lock.json`
- Required command checks
- `node_modules` / local npm binary checks
- Command logging with exact command lines
- `Push-Location` / `Pop-Location` so scripts return you to your original directory
- Native exit-code preservation
- Readable final failure blocks
- Optional `-PauseOnFailure` support
- Safe repo-relative path checks for scanner-style scripts

This is the foundation that makes the other scripts behave consistently.

## Basic workflow scripts

### `setup.ps1`

Purpose: prepare/check the repo on Windows.

Runs:

```powershell
node -v
npm.cmd -v
npm.cmd ci
```

Options:

```powershell
.\tools\windows\setup.ps1
.\tools\windows\setup.ps1 -SkipInstall
.\tools\windows\setup.ps1 -PauseOnFailure
```

Current expected result: **passes**, but `npm ci` reports existing dependency warnings and audit vulnerabilities.

---

### `test.ps1`

Purpose: run the normal Vitest test suite.

Runs:

```powershell
npm.cmd run test
```

Options:

```powershell
.\tools\windows\test.ps1
.\tools\windows\test.ps1 -TestFilter "pow"
.\tools\windows\test.ps1 -Watch
.\tools\windows\test.ps1 -PauseOnFailure
```

Current expected result: **passes**. Reported result: **19 files / 299 tests**.

---

### `typecheck.ps1`

Purpose: run the strict TypeScript/Vue typecheck gate.

Runs:

```powershell
npm.cmd exec -- vue-tsc --noEmit -p tsconfig.json
```

Options:

```powershell
.\tools\windows\typecheck.ps1
.\tools\windows\typecheck.ps1 -PauseOnFailure
```

Current expected result: **fails** with existing repo errors.

---

### `security-audit.ps1`

Purpose: run `npm audit` as a dependency security gate.

Runs by default:

```powershell
npm.cmd audit --audit-level=high
```

Options:

```powershell
.\tools\windows\security-audit.ps1
.\tools\windows\security-audit.ps1 -AuditLevel moderate
.\tools\windows\security-audit.ps1 -AuditLevel critical
.\tools\windows\security-audit.ps1 -ProductionOnly
.\tools\windows\security-audit.ps1 -Json
.\tools\windows\security-audit.ps1 -PauseOnFailure
```

Current expected result: **fails** because the repo currently has real npm audit findings.

---

### `validate.ps1`

Purpose: one Windows PR-validation entrypoint.

Runs in order:

1. `typecheck.ps1`
2. `test.ps1`
3. `security-audit.ps1`
4. `npm run build`

Options:

```powershell
.\tools\windows\validate.ps1
.\tools\windows\validate.ps1 -SkipAudit
.\tools\windows\validate.ps1 -SkipBuild
.\tools\windows\validate.ps1 -TestFilter "pow"
.\tools\windows\validate.ps1 -PauseOnFailure
```

Current expected result: **fails closed at typecheck** before tests, audit, or build. That is correct because `typecheck.ps1` currently fails.

## Security/adversarial scripts

### `adversarial-test.ps1`

Purpose: run a focused security/adversarial Vitest subset without starting live services.

Default test filters:

```text
ws-validators.test.js
pow-challenge.test.js
security-utils.test.js
rate-limiter.test.js
bot-detector.test.js
spam-scorer.test.js
chainValidation.test.ts
eventService.test.ts
cryptoService.test.ts
config.test.ts
mnemonicHelper.test.ts
```

Options:

```powershell
.\tools\windows\adversarial-test.ps1
.\tools\windows\adversarial-test.ps1 -TestFilter "pow-challenge.test.js"
.\tools\windows\adversarial-test.ps1 -PauseOnFailure
```

Current expected result: **passes**. Reported result: **11 files / 213 tests**.

This is the “try to break protocol/security-relevant unit coverage” lane.

---

### `secret-scan.ps1`

Purpose: scan tracked text files for high-confidence hard-coded secrets without adding dependencies.

It scans `git ls-files`, skips generated/runtime/binary-ish paths, and looks for patterns like:

- Private key blocks
- Generic `api_key` / `secret` / `token` / `password` assignments
- Bearer tokens
- Google API keys
- GitHub tokens
- Slack tokens
- AWS access keys
- Possible JWTs

Options:

```powershell
.\tools\windows\secret-scan.ps1
.\tools\windows\secret-scan.ps1 -FailOnFinding
.\tools\windows\secret-scan.ps1 -IncludeDocs
.\tools\windows\secret-scan.ps1 -PauseOnFailure
```

Default behavior: scans tracked files only, **report-only**, exit `0`.

Current expected result: **passes with no high-confidence secrets found**.

---

### `security-smoke.ps1`

Purpose: aggregate the local security checks and keep going so you get a useful summary.

Runs:

1. `adversarial-test.ps1`
2. `secret-scan.ps1`
3. `security-audit.ps1`

Options:

```powershell
.\tools\windows\security-smoke.ps1
.\tools\windows\security-smoke.ps1 -SkipAudit
.\tools\windows\security-smoke.ps1 -SkipAdversarialTests
.\tools\windows\security-smoke.ps1 -SkipSecretScan
.\tools\windows\security-smoke.ps1 -AuditLevel critical
.\tools\windows\security-smoke.ps1 -ProductionOnly
.\tools\windows\security-smoke.ps1 -FailOnSecretFinding
.\tools\windows\security-smoke.ps1 -AllowNoChecks
.\tools\windows\security-smoke.ps1 -PauseOnFailure
```

Current expected result:

```text
adversarial tests: pass
secret scan: pass
dependency audit: fail
overall: fail with exit 1
```

And:

```powershell
.\tools\windows\security-smoke.ps1 -SkipAudit
```

should pass cleanly.

## What this gives you practically

You now have:

```text
setup.ps1              dependency install / Windows setup
test.ps1               normal unit test gate
typecheck.ps1          strict TS/Vue correctness gate
security-audit.ps1     npm dependency vulnerability gate
validate.ps1           PR-style validation gate
adversarial-test.ps1   focused protocol/security unit-test lane
secret-scan.ps1        local hard-coded secret scanner
security-smoke.ps1     combined local security smoke lane
common.ps1             shared script infrastructure
```

The repo’s current health is:

```text
Setup: passes
Tests: pass
Adversarial tests: pass
Secret scan: pass
Typecheck: fails on existing TS/Vue errors
Dependency audit: fails on existing vulnerabilities
Validate: fails at typecheck
Security smoke: fails at dependency audit
Security smoke -SkipAudit: passes
```

## Call Tree

```text
common.ps1
├─ shared by all scripts
│
├─ setup.ps1
│  ├─ node -v
│  ├─ npm.cmd -v
│  └─ npm.cmd ci
│
├─ test.ps1
│  └─ npm.cmd run test [-- filters]
│
├─ typecheck.ps1
│  └─ npm.cmd exec -- vue-tsc --noEmit -p tsconfig.json
│
├─ security-audit.ps1
│  └─ npm.cmd audit --audit-level=<moderate|high|critical>
│
├─ secret-scan.ps1
│  ├─ git ls-files -z
│  └─ PowerShell regex scan over tracked text files
│
├─ validate.ps1
│  ├─ typecheck.ps1
│  │  └─ npm.cmd exec -- vue-tsc --noEmit -p tsconfig.json
│  ├─ test.ps1
│  │  └─ npm.cmd run test [-- filters]
│  ├─ security-audit.ps1
│  │  └─ npm.cmd audit --audit-level=high
│  └─ npm.cmd run build
│
├─ adversarial-test.ps1
│  └─ test.ps1 -TestFilter <security/adversarial filters>
│     └─ npm.cmd run test -- <filters>
│
└─ security-smoke.ps1
   ├─ adversarial-test.ps1
   │  └─ test.ps1 -TestFilter <security/adversarial filters>
   │     └─ npm.cmd run test -- <filters>
   ├─ secret-scan.ps1
   │  ├─ git ls-files -z
   │  └─ regex scan
   └─ security-audit.ps1
      └─ npm.cmd audit --audit-level=high
```

## Details

```text
setup.ps1
  Get the repo ready.

test.ps1
  Do normal tests pass?

typecheck.ps1
  Is the TypeScript/Vue code type-correct?

security-audit.ps1
  Are npm dependencies free of high+ advisories?

validate.ps1
  Run the main PR gate.

adversarial-test.ps1
  Run security/protocol-focused tests.

secret-scan.ps1
  Look for hard-coded secrets.

security-smoke.ps1
  Run the local security lane and summarize everything.

common.ps1
  Shared infrastructure that makes all of the above consistent.
```
