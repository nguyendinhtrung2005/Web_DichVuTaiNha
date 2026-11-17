-- Proposed additive migration; apply only after owner and exact-target approval.
-- MySQL 8.0.16+. No startup migration, seed, backfill or automatic rollback.
-- Preflight: product_orders exists; payment_method and the named CHECK are absent.
-- Existing product orders keep NULL (no payment method has been chosen).
ALTER TABLE product_orders
  ADD COLUMN payment_method VARCHAR(16) NULL AFTER contact_snapshot,
  ADD CONSTRAINT chk_product_order_payment_method
    CHECK (payment_method IS NULL OR payment_method IN ('CASH', 'TRANSFER'));
