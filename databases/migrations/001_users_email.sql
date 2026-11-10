-- Customer phone/email sign-in: additive migration, apply once after owner approval.
-- Target for this session: 127.0.0.1:3306 / dich_vu_ve_sinh.
-- Preflight: users.email and uq_users_email must not already exist.
-- Existing accounts retain their phone login; NULL email values are allowed.
-- No data backfill, seed, deletion, or schema.sql modification.
ALTER TABLE users
  ADD COLUMN email VARCHAR(254) NULL AFTER phone,
  ADD UNIQUE KEY uq_users_email (email);
