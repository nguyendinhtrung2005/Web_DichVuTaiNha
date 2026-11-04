-- Customer booking retry safety. Requires MySQL 8.0.16+; legacy bookings keep NULL keys.
-- Preflight: verify both columns and uq_booking_customer_request are absent.
-- Do not apply automatically or import schema.sql over an existing database.
ALTER TABLE bookings
  ADD COLUMN customer_request_key CHAR(36) NULL,
  ADD COLUMN customer_request_hash CHAR(64) NULL,
  ADD UNIQUE KEY uq_booking_customer_request (customer_id, customer_request_key),
  ADD CONSTRAINT chk_booking_request_pair CHECK (
    (customer_request_key IS NULL AND customer_request_hash IS NULL)
    OR (customer_request_key IS NOT NULL AND customer_request_hash IS NOT NULL)
  );
