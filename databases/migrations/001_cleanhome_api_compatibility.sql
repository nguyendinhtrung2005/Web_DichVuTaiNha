-- CleanHome API compatibility migration, MySQL 8.0.
-- Run only after the preflight checks in backend/README.md and a verified backup.
-- This migration is additive: the existing 32-table schema and legacy reviews remain intact.

USE dich_vu_ve_sinh;

-- Preflight must report no rows before adding the one-payment-per-booking index.
SELECT booking_id, COUNT(*) AS payment_count
FROM payments
WHERE booking_id IS NOT NULL
GROUP BY booking_id
HAVING COUNT(*) > 1;

ALTER TABLE users
  ADD COLUMN address_text VARCHAR(300) NOT NULL DEFAULT '' AFTER phone,
  ADD COLUMN avatar_url VARCHAR(2048) NULL AFTER address_text,
  ADD COLUMN avatar_data MEDIUMTEXT NULL AFTER avatar_url,
  ADD COLUMN employee_code VARCHAR(30) NULL AFTER role,
  ADD COLUMN position VARCHAR(120) NULL AFTER employee_code;

ALTER TABLE service_categories
  ADD COLUMN slug VARCHAR(80) NULL AFTER name,
  ADD UNIQUE KEY uq_service_categories_slug (slug);

ALTER TABLE services
  ADD COLUMN slug VARCHAR(160) NULL AFTER name,
  ADD COLUMN short_description VARCHAR(500) NOT NULL DEFAULT '' AFTER description,
  ADD COLUMN price_mode VARCHAR(20) NOT NULL DEFAULT 'unit' AFTER unit,
  ADD COLUMN min_quantity DECIMAL(10,2) NOT NULL DEFAULT 1 AFTER base_price,
  ADD COLUMN minutes_per_unit INT NOT NULL DEFAULT 0 AFTER duration_minutes,
  ADD COLUMN base_minutes INT NOT NULL DEFAULT 0 AFTER minutes_per_unit,
  ADD COLUMN scope JSON NULL AFTER is_active,
  ADD COLUMN included JSON NULL AFTER scope,
  ADD COLUMN excluded JSON NULL AFTER included,
  ADD COLUMN image_url VARCHAR(2048) NULL AFTER excluded,
  ADD UNIQUE KEY uq_services_slug (slug);

ALTER TABLE bookings
  ADD COLUMN booking_code VARCHAR(40) NULL AFTER id,
  ADD COLUMN special_request VARCHAR(1000) NOT NULL DEFAULT '' AFTER address_snapshot,
  ADD COLUMN duration_minutes INT NOT NULL DEFAULT 0 AFTER scheduled_end,
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER total_amount,
  ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD UNIQUE KEY uq_bookings_code (booking_code);

ALTER TABLE booking_items
  ADD COLUMN duration_snapshot INT NOT NULL DEFAULT 0 AFTER unit_snapshot,
  ADD COLUMN line_total DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER duration_snapshot;

ALTER TABLE payments
  ADD COLUMN payment_code VARCHAR(40) NULL AFTER id,
  ADD COLUMN confirmed_by BIGINT NULL AFTER paid_at,
  ADD COLUMN refund_required BOOLEAN NOT NULL DEFAULT FALSE AFTER confirmed_by,
  ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER confirmed_by,
  ADD UNIQUE KEY uq_payments_code (payment_code),
  ADD UNIQUE KEY uq_payments_booking (booking_id),
  ADD CONSTRAINT fk_payments_confirmed_by FOREIGN KEY (confirmed_by) REFERENCES users(id);

CREATE TABLE payment_status_history (
  id BIGINT NOT NULL AUTO_INCREMENT,
  payment_id BIGINT NOT NULL,
  changed_by BIGINT NOT NULL,
  previous_status VARCHAR(20) NULL,
  new_status VARCHAR(20) NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_history_payment (payment_id, created_at),
  CONSTRAINT fk_payment_history_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_payment_history_user FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB COMMENT='Lịch sử thay đổi trạng thái ghi nhận thanh toán';

CREATE TABLE booking_cancellation_requests (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_id BIGINT NOT NULL,
  requested_by BIGINT NOT NULL,
  reason VARCHAR(2000) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_by BIGINT NULL,
  resolved_at TIMESTAMP NULL,
  admin_note VARCHAR(2000) NULL,
  PRIMARY KEY (id),
  KEY idx_cancel_booking_status (booking_id, status),
  KEY idx_cancel_status_date (status, requested_at),
  CONSTRAINT fk_cancel_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_cancel_requester FOREIGN KEY (requested_by) REFERENCES users(id),
  CONSTRAINT fk_cancel_resolver FOREIGN KEY (resolved_by) REFERENCES users(id)
) ENGINE=InnoDB COMMENT='Yêu cầu hủy đơn dịch vụ';

CREATE TABLE booking_reviews (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  employee_id BIGINT NULL,
  service_id BIGINT NOT NULL,
  service_rating TINYINT UNSIGNED NOT NULL,
  employee_rating TINYINT UNSIGNED NULL,
  comment VARCHAR(2000) NOT NULL,
  is_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  hidden_reason VARCHAR(2000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_reviews_booking (booking_id),
  KEY idx_booking_reviews_customer (customer_id, created_at),
  KEY idx_booking_reviews_employee (employee_id, created_at),
  CONSTRAINT chk_booking_reviews_service_rating CHECK (service_rating BETWEEN 1 AND 5),
  CONSTRAINT chk_booking_reviews_employee_rating CHECK (employee_rating IS NULL OR employee_rating BETWEEN 1 AND 5),
  CONSTRAINT chk_booking_reviews_employee_pair CHECK ((employee_id IS NULL AND employee_rating IS NULL) OR (employee_id IS NOT NULL AND employee_rating IS NOT NULL)),
  CONSTRAINT fk_booking_reviews_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_booking_reviews_customer FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_booking_reviews_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_booking_reviews_service FOREIGN KEY (service_id) REFERENCES services(id)
) ENGINE=InnoDB COMMENT='Một đánh giá tổng hợp cho mỗi đơn dịch vụ';

-- Backfill values that can be derived without guessing customer-specific data.
UPDATE services
SET price_mode = CASE
      WHEN LOWER(unit) IN ('giờ', 'gio', 'hour', 'hours') THEN 'hour'
      WHEN LOWER(unit) IN ('m²', 'm2', 'sqm') THEN 'area'
      ELSE 'unit'
    END,
    base_minutes = duration_minutes,
    slug = COALESCE(slug, CONCAT('service-', id));

UPDATE service_categories c
JOIN (
  SELECT MIN(id) AS id,
    CASE
      WHEN LOWER(TRIM(name)) IN ('vệ sinh nhà ở', 've sinh nha o') THEN 've-sinh-nha-o'
      WHEN LOWER(TRIM(name)) IN ('vệ sinh phòng trọ', 've sinh phong tro') THEN 've-sinh-phong-tro'
      WHEN LOWER(TRIM(name)) IN ('chăm sóc', 'cham soc') THEN 'cham-soc'
      WHEN LOWER(TRIM(name)) IN ('bảo dưỡng', 'bao duong') THEN 'bao-duong'
    END AS mapped_slug
  FROM service_categories
  GROUP BY mapped_slug
  HAVING mapped_slug IS NOT NULL
) mapped ON mapped.id = c.id
SET c.slug = mapped.mapped_slug
WHERE c.slug IS NULL;

INSERT INTO service_categories (name, description, is_active, slug)
SELECT 'Vệ sinh nhà ở', 'Dịch vụ vệ sinh nhà ở đặt lịch.', TRUE, 've-sinh-nha-o'
WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE slug = 've-sinh-nha-o' OR LOWER(TRIM(name)) = LOWER('Vệ sinh nhà ở'));

INSERT INTO service_categories (name, description, is_active, slug)
SELECT 'Vệ sinh phòng trọ', 'Dịch vụ vệ sinh phòng trọ đặt lịch.', TRUE, 've-sinh-phong-tro'
WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE slug = 've-sinh-phong-tro' OR LOWER(TRIM(name)) = LOWER('Vệ sinh phòng trọ'));

INSERT INTO service_categories (name, description, is_active, slug)
SELECT 'Chăm sóc', 'Dịch vụ chăm sóc đặt lịch.', TRUE, 'cham-soc'
WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE slug = 'cham-soc' OR LOWER(TRIM(name)) = LOWER('Chăm sóc'));

INSERT INTO service_categories (name, description, is_active, slug)
SELECT 'Bảo dưỡng', 'Dịch vụ bảo dưỡng đặt lịch.', TRUE, 'bao-duong'
WHERE NOT EXISTS (SELECT 1 FROM service_categories WHERE slug = 'bao-duong' OR LOWER(TRIM(name)) = LOWER('Bảo dưỡng'));

UPDATE bookings b
LEFT JOIN (
  SELECT booking_id, MIN(created_at) AS first_status_at
  FROM booking_status_history
  GROUP BY booking_id
) h ON h.booking_id = b.id
SET b.created_at = COALESCE(h.first_status_at, b.scheduled_start);

UPDATE bookings
SET booking_code = CONCAT('DH', LPAD(id, 8, '0'))
WHERE booking_code IS NULL;

UPDATE payments
SET payment_code = CONCAT('TT', LPAD(id, 8, '0'))
WHERE payment_code IS NULL;
