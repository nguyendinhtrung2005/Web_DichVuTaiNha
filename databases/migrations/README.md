# Customer email migration

`001_users_email.sql` adds nullable email and a unique index to users. Existing phone accounts remain valid. The task owner requested both phone and email sign-in in this session; applying DDL still requires explicit target database approval.

Before applying: confirm database host/name, take an appropriate backup, check information_schema for absence of email/uq_users_email, and check that users is the expected table. Apply once, then verify column/index with read-only metadata queries. Startup never runs migrations. Do not import schema.sql over an existing database.

Session execution record: the user explicitly approved applying this exact ALTER on 127.0.0.1:3306 / dich_vu_ve_sinh. It was applied once; read-only verification confirmed email IS_NULLABLE=YES and a single-column unique uq_users_email. The initial verification compared a driver-returned string to a number; verification was corrected and repeated with SELECT only, without rerunning DDL. No base schema import was performed.

Risk: ALTER TABLE takes a metadata lock; existing phone-only users are not modified. Duplicate non-null emails are rejected after migration. All application email writes normalize to lower case; no verification email provider is configured, so the application does not claim addresses are verified.

Rollback: first deploy phone-only application behavior, export any newly entered email values, then have the database owner review removal of uq_users_email/email. Removing the column loses these values; no automatic destructive rollback is provided. Provider TV1 and Customer consumer review is required before merging into the team's integration branch.

## 002 — service metadata and product orders

`002_services_product_orders.sql` adds nullable `services.customer_config` plus the `product_services`, `product_stock_reservations`, `product_orders`, and `product_order_items` tables. It does not seed products or services, rewrite existing IDs, or alter existing booking records. Catalog taxonomy falls back to a deterministic legacy mapping when `customer_config` is absent; the optional product-commerce APIs require this migration and report database errors when it has not been applied.

This migration is approved for implementation after task-owner confirmation of TV2 Catalog and TV3 Order approval on 2026-10-30. The user subsequently explicitly approved applying the existing file on 127.0.0.1:3306 / dich_vu_ve_sinh. Preflight confirmed the column/four tables absent and the affected services table empty. All five DDL statements were applied once; postflight verified nullable JSON metadata, four InnoDB tables, and preserved the pre-existing user count. No existing user data was copied into fixtures. Other environments must obtain separate exact-target approval, take an appropriate backup, verify absence of the objects, apply once during a controlled window, and verify columns, tables, foreign keys and constraints using read-only metadata queries. Do not run `schema.sql`, execute migrations at service startup, or auto-drop objects to recover from a partial failure.

Rollback is not automatic: disable the new routes first; preserve product-order and reservation records and reconcile reserved quantities before any owner-reviewed removal. Keep migration evidence with the database owner.

## 003 — Customer booking idempotency

`003_booking_idempotency.sql` requires MySQL 8.0.16+ and adds nullable `customer_request_key` and `customer_request_hash` columns, a matching-pair check constraint, and a unique index on `(customer_id, customer_request_key)`. This lets Customer safely retry the same booking after an uncertain network result. Existing bookings keep `NULL` request keys and are not changed. `npm run check:db` verifies the exact check expression as well as the columns and index. See `003_README.md` for preflight, verification, and rollback constraints.

On 2026-11-06 the task owner explicitly approved migration 003 on 127.0.0.1:3306 / dich_vu_ve_sinh. Preflight confirmed MySQL 8.0.46, InnoDB bookings with zero rows, and both columns/index/check absent. The ALTER ran once. Read-only postflight confirmed nullable CHAR(36)/CHAR(64), the ordered unique index and CHECK expression; the existing user count (1) and booking count (0) were preserved. The readiness checker needed an explicit alias for MySQL's upper-case metadata field names; only SELECT verification was repeated, not DDL. `npm.cmd run check:db` then passed. Other environments still need their own exact-target approval, backup/preflight and verification; startup never applies DDL.

## 004 — Payment method selected during product checkout

`004_product_checkout_payment.sql` adds nullable `product_orders.payment_method VARCHAR(16)` and a CHECK allowing NULL/CASH/TRANSFER. It stores a simulated checkout choice in the same Order journal transaction; it does not create a bank transaction, mark PAID, add tables or modify booking payments. Existing orders retain NULL and the UI does not invent a method for them.

The task owner explicitly confirmed Order/DB approval of the contract and application on 127.0.0.1:3306/dich_vu_ve_sinh. Applied once on 07/11/2026 after verifying MySQL 8.0.46/InnoDB, the absent column/CHECK and six existing orders. Postflight confirmed nullable VARCHAR(16), CASH/TRANSFER CHECK, unchanged six orders with NULL methods. `npm.cmd run check:products` verifies metadata read-only; startup does not run migrations. Other targets require separate approval, backup/preflight and postflight. ALTER may hold a metadata lock; inspect an uncertain result instead of automatically rerunning or dropping objects. Rollback requires preserving selected methods and explicit owner approval before removing the column/CHECK.

Contract, scope and tests: [Customer checkout payment](../../backend/docs/customer-checkout-payment.md).
