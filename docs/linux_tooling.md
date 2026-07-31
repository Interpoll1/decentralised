# Linux Tooling

Linux Bash entrypoints live in `tools/linux/*.sh` and mirror the functional developer and CI workflows of the Windows tooling.

## Prerequisites

- Bash
- Node.js
- npm
- git
- GNU grep with PCRE support (`grep -P`) for `secret-scan.sh`
- GNU coreutils `realpath` for repo-relative scanner path checks
- Optional: ShellCheck

These scripts are intended for Ubuntu/Debian-style Linux environments and CI images such as `ubuntu-latest`. Minimal BusyBox/Alpine-style images may need additional packages for GNU `grep -P` and `realpath`.

## One-Time Setup

From the repo root:

```bash
chmod +x tools/linux/*.sh
./tools/linux/setup.sh
```

## Usage

```bash
./tools/linux/setup.sh
./tools/linux/setup.sh --skip-install

./tools/linux/typecheck.sh

./tools/linux/test.sh
./tools/linux/test.sh --test-filter pow-challenge.test.js
./tools/linux/test.sh --watch

./tools/linux/security-audit.sh
./tools/linux/security-audit.sh --audit-level critical
./tools/linux/security-audit.sh --production-only
./tools/linux/security-audit.sh --json

./tools/linux/validate.sh
./tools/linux/validate.sh --skip-audit --skip-build
./tools/linux/validate.sh --test-filter pow --test-filter chain

./tools/linux/adversarial-test.sh
./tools/linux/adversarial-test.sh --test-filter config.test.ts

./tools/linux/secret-scan.sh
./tools/linux/secret-scan.sh --fail-on-finding
./tools/linux/secret-scan.sh --include-docs

./tools/linux/security-smoke.sh
./tools/linux/security-smoke.sh --skip-audit
./tools/linux/security-smoke.sh --audit-level critical --fail-on-secret-finding
./tools/linux/security-smoke.sh --skip-adversarial-tests --skip-secret-scan --skip-audit --allow-no-checks
```

Every entry script supports `--help` and `-h`. 

`--pause-on-failure` is available as an explicit interactive opt-in; it is off by default for CI.

## CI Tips

- Run `./tools/linux/setup.sh` once before validation jobs that need installed dependencies.
- Use `./tools/linux/validate.sh` as the normal PR gate.
- Use `./tools/linux/security-smoke.sh --skip-audit` when dependency audit findings are tracked separately.
- Use `./tools/linux/security-smoke.sh --fail-on-secret-finding` when secret findings should block CI.
- Keep `--allow-no-checks` only for intentionally empty smoke runs.