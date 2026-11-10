# 005 — Staff assignment transition journal

This additive migration creates `staff_assignment_transition_operations`, a Staff-owned journal for idempotent assignment status transitions. It does not alter bookings, assignments, existing orders, or product data.

The Staff API must fail closed for status mutations when this table is absent. Startup never applies DDL. Other databases require separate owner approval.

## Before applying

1. Confirm the exact approved local database and MySQL version (8.0.16+).
2. Take an appropriate backup and confirm `assignments` is the expected InnoDB table.
3. Check `information_schema.tables` and confirm `staff_assignment_transition_operations` does not exist.
4. Have Staff and Order owners review the migration and rollout order.

Apply the SQL once during a controlled local maintenance window. MySQL DDL is not transactional: if the result is uncertain, stop and inspect metadata; do not rerun or drop automatically.

## Verify

Use read-only metadata queries to confirm the table, unique operation key, assignment foreign key, and CHECK constraints. Then run the Staff transition readiness check and contract tests. Do not insert fixture or demo rows as part of the migration.

## Rollback

There is no automatic rollback. First disable Staff status mutations and reconcile all `PENDING` operations. Preserve completed operation records for audit. Any table removal requires explicit database-owner approval and an appropriate export/backup.
