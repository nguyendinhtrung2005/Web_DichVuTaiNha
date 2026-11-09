# 003 — Customer booking idempotency

Local execution record (2026-11-06): task owner explicitly approved the exact file for 127.0.0.1:3306 / dich_vu_ve_sinh. Applied once after verifying the target and an empty InnoDB bookings table. Column/index/check metadata and unchanged users/bookings counts were verified with SELECT; `check:db` passes after correcting metadata aliases. No schema import, automatic rollback or seed was part of this migration. This approval does not cover other databases.

This additive migration allows Customer to retry a booking request after a network timeout without creating a duplicate. It adds nullable `customer_request_key` and `customer_request_hash` columns, a check constraint requiring both key fields to be present or absent together, and a unique index on `(customer_id, customer_request_key)`. It requires MySQL 8.0.16 or later so the `CHECK` constraint is enforced. Existing bookings remain unchanged and retain `NULL` request keys.

Preflight: confirm the exact approved MySQL target and version, take an appropriate backup, verify `bookings` is the expected InnoDB table, and confirm both columns, `uq_booking_customer_request`, and `chk_booking_request_pair` are absent. Apply once during a controlled window, then verify the two column definitions, ordered unique-index columns, and the exact check expression using read-only metadata queries or `npm run check:db`. MySQL DDL is not transactional; if partially applied, stop and inspect before taking any action. Do not rerun automatically, drop columns/indexes, execute `schema.sql`, or apply at service startup.

The Customer API accepts an optional UUID `requestKey` for backward compatibility. New Customer booking requests include one. A repeated key with the same normalized request returns the existing booking; the same key with a different request returns `409 REQUEST_KEY_REUSED`. Requests without a key keep the previous behavior.

Rollback is not automatic. First deploy a version that no longer sends or requires request keys, preserve request hashes for investigation, and have the database owner review any index/column removal. No existing booking data is deleted or rewritten.
