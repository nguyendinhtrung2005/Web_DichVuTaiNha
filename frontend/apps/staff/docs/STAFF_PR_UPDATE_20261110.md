# Draft PR #12: Staff update plan (2026-11-10)

This update is prepared on pr/staff-demo-ready-20261106. The base remains integration/uc9-uc12 at 72be976d0cce009c54c2503608689b3c8987873d; the previous PR head is 48f3c30ee8076a8de3b8363c443db2886ed9c4dd. No source branch history, Auth/Order/Customer/Admin changes or Database/ERD documents are transferred.

## Persistent Login: exact 17-file disposition

The incremental manifest lists each of the 17 source paths and its decision. Fifteen Staff runtime/test/contract paths are included. The two local Integration QA harnesses, qa/integration/refresh-staff.mjs and qa/integration/session.browser.mjs, remain local: importing them alone would miss trial-only dependencies; importing the trial environment would exceed this Staff PR scope. No trial configuration, credentials, logs, database content or browser profiles are included.

Staff session handling has improved: Frontend inspections share one flight; explicit fixed GET adapters retry at most once after a proven token expiry. Fresh-token failures and 403 are not retried. Status/notification mutations and AI calls are not replayed automatically. Auth/BFF renewal defaults remain off. The QA session is still about 15 minutes; a 30-day session is not active and needs Auth owner approval.

## Other selected Staff changes

- Scoped date/service job filters; unsupported area/required-staff filters remain unavailable.
- Team observations are distinct from booking state; snapshot mismatch degrades only the team card and keeps an authorized assignment detail readable, without exposing peer identities.
- New start/finish commands stay fail-closed with 409 STAFFING_POLICY_REQUIRED until Order implements authoritative staffing requirements/readiness/finalization. Team 1-4 acceptance policy remains a contract/fixture, not a deployed Order feature.
- Notification list/count snapshots are coherent; read-all returns a real unread count instead of an assumed zero. Authorization remains account-scoped.
- Availability is read-only with day/slot details; unsendable request drafts are removed. Profile validation/form are gated while Auth profile APIs are absent.
- Income table/control layout, accessibility and copy are refined. DEMO_V2 calculation/payment semantics are unchanged; estimates are not reconciled or paid wages.
- TypeScript baseUrl is removed while existing aliases are preserved. Leaflet dependency/lock entries are retained.

## Commit plan and preservation

1. Staff Backend and tests: 12 paths; owner Backend review required.
2. Staff Frontend/BFF and feature regression tests: 49 paths.
3. Opt-in Staff QA harnesses/runbook: 4 paths; no new trial environment or seed data.
4. Four Staff contracts plus this plan and incremental manifest: 6 paths.

Total: 71 unique update paths. Tests stay with their feature. Backend npm test remains npm run test:unit and includes both income-policy suites plus the team/practical suites. Development's 61 modified + 186 untracked and the PR worktree's 10 untracked Database/ERD files remain protected.

Keep the PR's existing stronger qa/staff/.gitignore, session-renewal link fixes, private-evidence link fix and chatbot scroll fix. Do not overwrite the old 265-file preparation manifest: it is historical. Use qa/staff/pr-update-manifest-20261110.json for this incremental update. Local acceptance reports and whitespace-only documentation differences are excluded.

## Evidence and limits

Source Integration QA evidence: Frontend 813 PASS / 8 SKIP; Auth tests 122 PASS; Chrome 3 REAL_PASS for login/F5, browser reopen/owned Frontend restart, logout and A/B. Refresh rotation/concurrency are MOCK_PASS. Real refresh is BLOCKED_REFRESH_DISABLED. No 30-day session is running. Groq REAL_PASS is prior source-QA evidence; no new provider call or secret transfer is part of this PR update.

PR-worktree unit/typecheck/build results are recorded in the GitHub PR description after execution. Do not label source Chrome evidence as E2E on this worktree. No Auth schema, MySQL mutation, API-key change or live QA startup is performed for PR validation.

At preflight, GitHub reports the PR Draft/mergeable with zero check runs, zero status contexts and zero Actions runs. This is not a CI PASS. Keep Draft status; do not merge or enable auto-merge. Recheck the remote base/head before a normal fast-forward push; stop on base drift, conflicting history or serious conflicts.

## Required owner review before merge

- Staff Backend: team ownership/self-only DTO, snapshot fallback, notification transaction/isolation semantics, scoped filters and backward compatibility.
- Auth: approve refresh contract/policy/store/revocation and 30-day idle proposal before enabling renewal. Production TTL safeguards are not relaxed here.
- Order/Admin/Customer: authoritative minimum/required staff snapshots, readiness, replacement slots and committed-DONE booking finalization. Do not remove guards to make the demo appear complete.
- Product APIs still missing: profile update/contact verification, shift approvals, password change, Review/KPI and payout.

## Validation of this prepared PR tree

- Frontend: 813 PASS, 8 SKIP; standard Auth script: 122 PASS.
- Backend standard npm test: 170 PASS, including both income-policy suites.
- PR worktree typecheck and whitespace checks: PASS.
- Webpack production build: PASS in an isolated E-drive copy of the PR runtime source; all 280 copied input files are checked against the PR worktree. Output remains outside both worktrees. Only tracing root and resource controls differ in the build wrapper. Direct worktree build was rejected by automatic review because of the AGENTS rule on build outputs; no worktree build output was created.
- Live HTTP/Chrome on this PR worktree: NOT_RUN, no QA secrets were copied. The 3 Chrome REAL_PASS groups and Groq REAL_PASS are explicitly prior source Integration QA evidence.

Two test files in the initial candidate inventory differed only by an extra EOF blank line (areas-demo-ui.test.mjs and notifications-demo.test.mjs). After whitespace normalization they equal the existing PR files and are excluded from the incremental commits. No test logic or development WIP was changed.
