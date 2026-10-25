-- CleanHome UC9-UC12: OPTIONAL fixtures for the dedicated test database ONLY.
-- Review and run manually in ONE MySQL session after schema_staff_test.sql.
-- This script is not invoked by npm, service startup, or automated tests.
-- No usable passwords/tokens. The phone/hash strings below are fixture markers.
-- Fixed IDs 9109001-9109009 are reserved by this fixture, not production IDs.
-- Existing rows are never updated: a rerun preserves state, dates and prices.
-- NOT EXISTS reads each target through a LIMIT 1 derived table; LIMIT prevents
-- merging and keeps MySQL's same-target subquery restriction out of the INSERT.

USE cleanhome_staff_test;
SET SESSION time_zone = '+00:00';

-- Fail closed even if a SQL editor continues after a preflight error. Every
-- INSERT independently checks the selected database and has a qualified target.
-- A collision at any reserved ID/unique key blocks the whole seed beforehand.
SET @cleanhome_staff_seed_allowed = 0;
SELECT CASE WHEN DATABASE() = 'cleanhome_staff_test'
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.users
    WHERE (id = 9109001 OR phone = 'TEST-CUSTOMER-UC9')
      AND NOT (id = 9109001 AND phone = 'TEST-CUSTOMER-UC9' AND role = 'CUSTOMER')
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.users
    WHERE (id = 9109002 OR phone = 'TEST-EMPLOYEE-UC9')
      AND NOT (id = 9109002 AND phone = 'TEST-EMPLOYEE-UC9' AND role = 'EMPLOYEE')
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.branches
    WHERE id = 9109003
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(service_area, '$._cleanhome_fixture')), '') <> 'cleanhome-staff-uc9-uc12-v1'
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.employees
    WHERE (id = 9109004 OR user_id = 9109002)
      AND NOT (id = 9109004 AND user_id = 9109002 AND branch_id = 9109003)
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.service_categories
    WHERE id = 9109005 AND description <> 'cleanhome-staff-uc9-uc12-v1'
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.services
    WHERE id = 9109006
      AND NOT (category_id = 9109005 AND description = 'cleanhome-staff-uc9-uc12-v1')
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.bookings
    WHERE id = 9109007 AND NOT (
      customer_id = 9109001 AND branch_id = 9109003
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(address_snapshot, '$._cleanhome_fixture')), '') = 'cleanhome-staff-uc9-uc12-v1'
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.assignments
    WHERE (id = 9109008 OR (booking_id = 9109007 AND employee_id = 9109004))
      AND NOT (id = 9109008 AND booking_id = 9109007 AND employee_id = 9109004)
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.booking_items
    WHERE (id = 9109009 OR (booking_id = 9109007 AND service_id = 9109006))
      AND NOT (id = 9109009 AND booking_id = 9109007 AND service_id = 9109006)
  )
THEN 1 ELSE 0 END INTO @cleanhome_staff_seed_allowed;

START TRANSACTION;

INSERT INTO cleanhome_staff_test.users
  (id, full_name, phone, password_hash, role, status, created_at)
SELECT 9109001, '(TEST) Khách hàng Staff UC9', 'TEST-CUSTOMER-UC9',
  '!CLEANHOME_TEST_ONLY_NO_LOGIN!', 'CUSTOMER', 'ACTIVE', UTC_TIMESTAMP()
FROM DUAL
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_seed_allowed = 1
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.users WHERE id = 9109001 OR phone = 'TEST-CUSTOMER-UC9' LIMIT 1
  ) AS existing_customer);

INSERT INTO cleanhome_staff_test.users
  (id, full_name, phone, password_hash, role, status, created_at)
SELECT 9109002, '(TEST) Nhân viên Staff UC9', 'TEST-EMPLOYEE-UC9',
  '!CLEANHOME_TEST_ONLY_NO_LOGIN!', 'EMPLOYEE', 'ACTIVE', UTC_TIMESTAMP()
FROM DUAL
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_seed_allowed = 1
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.users WHERE id = 9109002 OR phone = 'TEST-EMPLOYEE-UC9' LIMIT 1
  ) AS existing_staff_user);

INSERT INTO cleanhome_staff_test.branches
  (id, name, address_text, service_area, latitude, longitude, status)
SELECT 9109003, '(TEST) Chi nhánh Staff UC9', 'Địa chỉ kiểm thử; không dùng để phục vụ khách hàng',
  JSON_OBJECT('_cleanhome_fixture', 'cleanhome-staff-uc9-uc12-v1'), 0, 0, 'ACTIVE'
FROM DUAL
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_seed_allowed = 1
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.branches WHERE id = 9109003 LIMIT 1
  ) AS existing_branch);

INSERT INTO cleanhome_staff_test.employees
  (id, user_id, branch_id, verification_status, experience_years, response_rate, status)
SELECT 9109004, u.id, b.id, 'PENDING', 0, 0, 'ACTIVE'
FROM cleanhome_staff_test.users u
JOIN cleanhome_staff_test.branches b ON b.id = 9109003
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_seed_allowed = 1
  AND u.id = 9109002 AND u.phone = 'TEST-EMPLOYEE-UC9' AND u.role = 'EMPLOYEE'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.service_area, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.employees WHERE id = 9109004 OR user_id = 9109002 LIMIT 1
  ) AS existing_employee);

INSERT INTO cleanhome_staff_test.service_categories
  (id, name, description, is_active)
SELECT 9109005, '(TEST) Nhóm dịch vụ Staff UC9', 'cleanhome-staff-uc9-uc12-v1', TRUE
FROM DUAL
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_seed_allowed = 1
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.service_categories WHERE id = 9109005 LIMIT 1
  ) AS existing_category);

INSERT INTO cleanhome_staff_test.services
  (id, category_id, name, description, unit, base_price, duration_minutes, is_active)
SELECT 9109006, c.id, '(TEST) Dọn dẹp kiểm thử Staff UC9', 'cleanhome-staff-uc9-uc12-v1',
  'giờ', 100000.00, 120, TRUE
FROM cleanhome_staff_test.service_categories c
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_seed_allowed = 1
  AND c.id = 9109005 AND c.description = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.services WHERE id = 9109006 LIMIT 1
  ) AS existing_service);

INSERT INTO cleanhome_staff_test.bookings
  (id, customer_id, branch_id, address_snapshot, scheduled_start, scheduled_end, status, total_amount)
SELECT 9109007, u.id, b.id,
  JSON_OBJECT('_cleanhome_fixture', 'cleanhome-staff-uc9-uc12-v1',
    'recipient', '(TEST) Khách hàng Staff UC9', 'phone', 'TEST-CUSTOMER-UC9',
    'address_text', 'Địa chỉ kiểm thử CleanHome; không phải địa chỉ khách hàng thực'),
  DATE_ADD(UTC_DATE(), INTERVAL 25 HOUR), DATE_ADD(UTC_DATE(), INTERVAL 27 HOUR),
  'CONFIRMED', 200000.00
FROM cleanhome_staff_test.users u
JOIN cleanhome_staff_test.branches b ON b.id = 9109003
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_seed_allowed = 1
  AND u.id = 9109001 AND u.phone = 'TEST-CUSTOMER-UC9' AND u.role = 'CUSTOMER'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.service_area, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.bookings WHERE id = 9109007 LIMIT 1
  ) AS existing_booking);

INSERT INTO cleanhome_staff_test.booking_items
  (id, booking_id, service_id, entitlement_id, service_name_snapshot, quantity, unit_price, unit_snapshot)
SELECT 9109009, b.id, s.id, NULL, s.name, 2.00, 100000.00, 'giờ'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.services s ON s.id = 9109006
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_seed_allowed = 1
  AND b.id = 9109007 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1'
  AND s.category_id = 9109005 AND s.description = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.booking_items
    WHERE id = 9109009 OR (booking_id = 9109007 AND service_id = 9109006) LIMIT 1
  ) AS existing_booking_item);

INSERT INTO cleanhome_staff_test.assignments
  (id, booking_id, employee_id, assigned_at, check_in_at, check_out_at, status)
SELECT 9109008, b.id, e.id, UTC_TIMESTAMP(), NULL, NULL, 'ASSIGNED'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.employees e ON e.id = 9109004
JOIN cleanhome_staff_test.users u ON u.id = e.user_id
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_seed_allowed = 1
  AND b.id = 9109007 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1'
  AND e.user_id = 9109002 AND e.branch_id = 9109003
  AND u.phone = 'TEST-EMPLOYEE-UC9' AND u.role = 'EMPLOYEE'
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.booking_items WHERE id = 9109009 AND booking_id = 9109007 AND service_id = 9109006)
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.assignments
    WHERE id = 9109008 OR (booking_id = 9109007 AND employee_id = 9109004) LIMIT 1
  ) AS existing_assignment);

COMMIT;

-- Metadata only: no credential hash, token, customer address or phone output.
SELECT DATABASE() AS selected_database, @cleanhome_staff_seed_allowed AS seed_guard_passed;
SELECT u.id AS staff_user_id, u.role, u.status AS user_status,
  e.id AS employee_id, e.status AS employee_status,
  a.id AS assignment_id, a.booking_id, a.status AS assignment_status
FROM cleanhome_staff_test.users u
JOIN cleanhome_staff_test.employees e ON e.user_id = u.id
JOIN cleanhome_staff_test.assignments a ON a.employee_id = e.id
WHERE DATABASE() = 'cleanhome_staff_test'
  AND u.id = 9109002 AND u.phone = 'TEST-EMPLOYEE-UC9' AND u.role = 'EMPLOYEE'
  AND e.id = 9109004 AND e.branch_id = 9109003
  AND a.id = 9109008 AND a.booking_id = 9109007;
