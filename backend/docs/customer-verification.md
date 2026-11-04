# Customer integration verification

Environment: Windows, Node.js 24.21, MySQL 8.0.46, approved local 127.0.0.1:3306 / dich_vu_ve_sinh. Branch feat/mysql-database-integration. No commit, push, merge or branch change. The pre-existing root AGENTS.md change and BACKEND_TEAM_RULES .md were preserved.

## Database changes

The user explicitly approved the additive migration 001_users_email.sql, which was applied once and verified with information_schema: nullable users.email and its unique single-column index. Existing 32 tables remain; schema.sql was not imported. No startup migration/seed exists. The user separately authorized synthetic fixture inserts and restricted cleanup on the 11 named tables.

## Results

| Check | Result | Evidence/limits |
|---|---|---|
| All backend tests | PASS, 43/43, no skip/fail | 14 real HTTP/MySQL tests including parent; 13 security tests; 16 domain tests, some explicitly using mocked repositories/dependencies |
| Customer browser | PASS | Native installed Chrome/CDP, actual frontend + services + MySQL fixtures |
| Staff browser demo | PASS | Login/dashboard/reload; role storage retained; no Customer API requests |
| Admin browser demo | PASS | Login/dashboard/reload; role storage retained; no Customer API requests |
| Customer typecheck | PASS | npm.cmd run typecheck:customer |
| Staff typecheck | PASS | npm.cmd run typecheck:staff |
| Admin typecheck | PASS | npm.cmd run typecheck:admin |
| Customer production build | PASS | npm.cmd run build:customer |
| Fixture cleanup | PASS | All 11 approved fixture tables returned to zero rows; registry/profile artifacts removed; test listeners stopped |
| Staff/Admin app source preservation | PASS | Next dev generated import-path/instruction artifacts were verified and cleaned; no diff in those app directories |
| Team provider/consumer review | NOT_VERIFIED | Task-owner approval is recorded; no team PR review/merge was performed |

The browser covered signup, phone AND email login, logout, profile save/reload, catalog and details, multistep booking, owned order list/detail, cancellation pending, simulated transfer pending, completed history/review/rebooking, missing session, API offline/retry and preserved legacy browser keys. No password/token/session business data was added to browser storage.

The real MySQL/HTTP suite checked strict input and role injection, unauthorized/other-customer access, price snapshots, transactions, cancellation concurrency, an older IN_PROGRESS assignment hidden by a newer waiting assignment, payment idempotence/preservation, one-review semantics, dependency failure and session revocation. Security tests cover RS256 claims/signatures/algorithms, cookie constraints, caller-bound internal credentials, CORS/Origin/JSON/body limits and sanitized errors.

Commands from backend (fixture writes require the explicit approved target and authorization):

    $env:ALLOW_CUSTOMER_DB_TEST = '1'
    node --env-file-if-exists=.env --test --test-isolation=none tests/*.test.js
    node --env-file-if-exists=.env tests/customer-browser.mysql.mjs
    node tests/role-demo-browser.mjs

Commands from frontend:

    npm.cmd run typecheck:customer
    npm.cmd run typecheck:staff
    npm.cmd run typecheck:admin
    npm.cmd run build:customer

Initial isolated-worker/build attempts hit sandbox spawn EPERM. Automatic review also rejected Playwright installation and a build interpretation of the generated-output rule. The user explicitly approved tool-generated Next output and worker/headless browser execution; build/browser then passed. No Playwright dependency was installed; browser tests use installed Chrome and Node's WebSocket APIs. Generated outputs were not edited manually.

## Handoff limits

- The live database is intentionally empty again after test cleanup. Catalog/Staff owners must provision actual services and an ACTIVE branch; configure CUSTOMER_DEFAULT_BRANCH_ID. Staff/Admin demos do not provision MySQL.
- Profile avatar/default-address editing is visibly unavailable. Booking contact addresses work through JSON snapshots. Email is optional and is not claimed verified.
- Payment is a simulation only. Cancellation approval, real payment confirmation/refunds and Staff/Admin backend workflows are outside this task.
- Auth's local session registry is memory-based. Production needs stable external keys/secrets, HTTPS, shared/reliable session storage and deployment review.
- Internal status checks use REST, not a distributed transaction. MySQL advisory review locks assume the current single database instance. Booking writes remain transactional; migration 003 adds per-customer idempotency for retries while the submitted Customer form remains open. That migration is source-only here and must be applied before this behavior is available on MySQL.
- Provider/consumer owners must review the new contract and migration before team merge. No other schema changes were made.
