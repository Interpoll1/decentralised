# HANDOFF — public engagement v1 integration (2026-09-26)

Plan: `~/.claude/plans/purrfect-skipping-treehouse.md`. Not committed.

## Done
- Phase 0 review: legacy Gun read issue is real, but live impact is nil (0 `v5` vote rows in MySQL, none in radata).
- `master` pushed: `d25116b..e56ba44`.
- Integration branch `integrate/public-engagement-v1` (`2bf0b66`), draft PR #47. Not merged, and must stay unmerged until the cutover.
- Relay patch re-pinned to the live VPS tree; the gun-relay file is a 3-way merge with the content firewall.
- Local staging: both patched relays on Node 24 with MySQL 8 in Docker (`ip-stage-mysql`, prod schema only).
  - Backend tests 38/38.
  - Client-relay integration test 4/4.
  - `staging-e2e.mjs`: 27/28 (the miss is the advisory Gun ack).
- Staging files: session scratchpad `…/6dd876e7…/scratchpad/{stage,vps-live,merge}`.

## Not done / blocked
- **Phase 3 cutover.** It needs `FTP_USER`/`FTP_PASS` for `deploy-ftp.sh`, and the frontend must go out in the same window as the relay restart. There is also no Android build tree (`android/app/build.gradle` is missing).
- **VPS backup/checkpoint:** see below.

## Cutover runbook (when the FTP credentials are available)
1. VPS backup:
   - Tar `relay-server`, `gun-relay`, `shared-validation` and `content-firewall.js` into `/root/interpoll-backups/<ts>-engagement-pre/`.
   - `mysqldump --single-transaction --quick interpoll gun_nodes post_views`.
2. Confirm nothing drifted: run `verify.mjs` against the live tree in `before` mode. It must pass; if it fails, stop.
3. Apply `backend.patch` on the VPS: `git apply` inside `/var/www/interpoll`, then run `verify.mjs` in `after` mode.
4. `node -e` import smoke test of `shared-validation/engagement.js` on the VPS.
5. `pm2 restart relay-server gun-relay`. Check:
   - `curl 127.0.0.1:8765/health` and `127.0.0.1:3001/health`
   - the table `engagement_actions_v1` exists
6. Immediately afterwards, from merged master: `FTP_USER=… FTP_PASS=… ./deploy-ftp.sh`.
7. Live smoke test: one vote, one view, and an unsigned POST must return 422.
8. **Rollback:** restore the tar, `pm2 restart relay-server gun-relay`, and redeploy the previous `dist`. Signed rows keep `type`, so the old code still reads them.
