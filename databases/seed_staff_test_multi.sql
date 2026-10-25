-- CleanHome UC9-UC12: OPTIONAL multi-employee fixtures, MANUAL execution only.
-- Run the original seed_staff_test.sql first. This file never changes its rows.
-- Exactly 15 new rows: one user, one employee, four bookings/items, five jobs.
-- Dedicated test DB only; no working password, no token, no Admin, no history.
-- Run the complete file in ONE session; do not run concurrent seed sessions.
-- LIMIT 1 derived tables prevent target-table subquery merging during INSERT.

USE cleanhome_staff_test;
SET SESSION time_zone = '+00:00';
SET @cleanhome_staff_multi_allowed = 0;

-- Missing original fixtures or any reserved-ID/lineage collision blocks all
-- inserts. Initialize the flag first so an editor continuing after an error
-- still fails closed. Every INSERT also has its own qualified target/DB check.
SELECT CASE WHEN DATABASE() = 'cleanhome_staff_test'
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.users WHERE id = 9109001 AND phone = 'TEST-CUSTOMER-UC9' AND role = 'CUSTOMER')
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.users WHERE id = 9109002 AND phone = 'TEST-EMPLOYEE-UC9' AND role = 'EMPLOYEE')
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.branches WHERE id = 9109003
    AND JSON_UNQUOTE(JSON_EXTRACT(service_area, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1')
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.employees WHERE id = 9109004 AND user_id = 9109002 AND branch_id = 9109003)
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.service_categories WHERE id = 9109005 AND description = 'cleanhome-staff-uc9-uc12-v1')
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.services WHERE id = 9109006 AND category_id = 9109005 AND description = 'cleanhome-staff-uc9-uc12-v1')
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.bookings WHERE id = 9109007 AND customer_id = 9109001 AND branch_id = 9109003
    AND scheduled_end > scheduled_start
    AND JSON_UNQUOTE(JSON_EXTRACT(address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1')
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.booking_items WHERE id = 9109009 AND booking_id = 9109007 AND service_id = 9109006)
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.assignments WHERE id = 9109008 AND booking_id = 9109007 AND employee_id = 9109004)
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.users
    WHERE (id = 9109101 OR phone = 'TEST-EMPLOYEE-UC9-B')
      AND NOT (id = 9109101 AND phone = 'TEST-EMPLOYEE-UC9-B' AND role = 'EMPLOYEE')
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.employees
    WHERE (id = 9109102 OR user_id = 9109101)
      AND NOT (id = 9109102 AND user_id = 9109101 AND branch_id = 9109003)
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.bookings
    WHERE id IN (9109103, 9109111, 9109121, 9109131)
      AND NOT (customer_id = 9109001 AND branch_id = 9109003
        AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(address_snapshot, '$._cleanhome_fixture')), '') = 'cleanhome-staff-uc9-uc12-multi-v1'
        AND (
          (id = 9109103 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(address_snapshot, '$._cleanhome_case')), '') = 'employee-b')
          OR (id = 9109111 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(address_snapshot, '$._cleanhome_case')), '') = 'employee-a-early')
          OR (id = 9109121 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(address_snapshot, '$._cleanhome_case')), '') = 'employee-a-late')
          OR (id = 9109131 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(address_snapshot, '$._cleanhome_case')), '') = 'multi-worker')
        )
      )
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.booking_items
    WHERE (id IN (9109104, 9109112, 9109122, 9109132) OR booking_id IN (9109103, 9109111, 9109121, 9109131))
      AND NOT (service_id = 9109006 AND (
        (id = 9109104 AND booking_id = 9109103) OR (id = 9109112 AND booking_id = 9109111)
        OR (id = 9109122 AND booking_id = 9109121) OR (id = 9109132 AND booking_id = 9109131)
      ))
  )
  AND NOT EXISTS (
    SELECT 1 FROM cleanhome_staff_test.assignments
    WHERE (id IN (9109105, 9109113, 9109123, 9109133, 9109134) OR booking_id IN (9109103, 9109111, 9109121, 9109131))
      AND NOT (
        (id = 9109105 AND booking_id = 9109103 AND employee_id = 9109102)
        OR (id = 9109113 AND booking_id = 9109111 AND employee_id = 9109004)
        OR (id = 9109123 AND booking_id = 9109121 AND employee_id = 9109004)
        OR (id = 9109133 AND booking_id = 9109131 AND employee_id = 9109004)
        OR (id = 9109134 AND booking_id = 9109131 AND employee_id = 9109102)
      )
  )
THEN 1 ELSE 0 END INTO @cleanhome_staff_multi_allowed;

START TRANSACTION;

INSERT INTO cleanhome_staff_test.users
  (id, full_name, phone, password_hash, role, status, created_at)
SELECT 9109101, '(TEST) Nhân viên B Staff UC9', 'TEST-EMPLOYEE-UC9-B',
  '!CLEANHOME_TEST_ONLY_NO_LOGIN!', 'EMPLOYEE', 'ACTIVE', UTC_TIMESTAMP()
FROM DUAL
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.users WHERE id = 9109101 OR phone = 'TEST-EMPLOYEE-UC9-B' LIMIT 1
  ) AS existing_multi_user);

INSERT INTO cleanhome_staff_test.employees
  (id, user_id, branch_id, verification_status, experience_years, response_rate, status)
SELECT 9109102, u.id, b.id, 'PENDING', 0, 0, 'ACTIVE'
FROM cleanhome_staff_test.users u
JOIN cleanhome_staff_test.branches b ON b.id = 9109003
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND u.id = 9109101 AND u.phone = 'TEST-EMPLOYEE-UC9-B' AND u.role = 'EMPLOYEE'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.service_area, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.employees WHERE id = 9109102 OR user_id = 9109101 LIMIT 1
  ) AS existing_multi_employee);

INSERT INTO cleanhome_staff_test.bookings
  (id, customer_id, branch_id, address_snapshot, scheduled_start, scheduled_end, status, total_amount)
SELECT 9109103, b.customer_id, b.branch_id,
  JSON_OBJECT('_cleanhome_fixture', 'cleanhome-staff-uc9-uc12-multi-v1', '_cleanhome_case', 'employee-b',
    'recipient', '(TEST) Khách hàng Staff UC9', 'phone', 'TEST-CUSTOMER-UC9', 'address_text', 'Địa chỉ kiểm thử công việc nhân viên B'),
  DATE_ADD(b.scheduled_start, INTERVAL 1 DAY), DATE_ADD(b.scheduled_end, INTERVAL 1 DAY), 'CONFIRMED', 200000.00
FROM cleanhome_staff_test.bookings b
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109007 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.bookings WHERE id = 9109103 LIMIT 1
  ) AS existing_multi_booking_b);

INSERT INTO cleanhome_staff_test.bookings
  (id, customer_id, branch_id, address_snapshot, scheduled_start, scheduled_end, status, total_amount)
SELECT 9109111, b.customer_id, b.branch_id,
  JSON_OBJECT('_cleanhome_fixture', 'cleanhome-staff-uc9-uc12-multi-v1', '_cleanhome_case', 'employee-a-early',
    'recipient', '(TEST) Khách hàng Staff UC9', 'phone', 'TEST-CUSTOMER-UC9', 'address_text', 'Địa chỉ kiểm thử lịch sớm của nhân viên A'),
  DATE_SUB(b.scheduled_start, INTERVAL 2 DAY), DATE_SUB(b.scheduled_end, INTERVAL 2 DAY), 'CONFIRMED', 200000.00
FROM cleanhome_staff_test.bookings b
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109007 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.bookings WHERE id = 9109111 LIMIT 1
  ) AS existing_multi_booking_early);

INSERT INTO cleanhome_staff_test.bookings
  (id, customer_id, branch_id, address_snapshot, scheduled_start, scheduled_end, status, total_amount)
SELECT 9109121, b.customer_id, b.branch_id,
  JSON_OBJECT('_cleanhome_fixture', 'cleanhome-staff-uc9-uc12-multi-v1', '_cleanhome_case', 'employee-a-late',
    'recipient', '(TEST) Khách hàng Staff UC9', 'phone', 'TEST-CUSTOMER-UC9', 'address_text', 'Địa chỉ kiểm thử lịch muộn của nhân viên A'),
  DATE_ADD(b.scheduled_start, INTERVAL 2 DAY), DATE_ADD(b.scheduled_end, INTERVAL 2 DAY), 'CONFIRMED', 200000.00
FROM cleanhome_staff_test.bookings b
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109007 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.bookings WHERE id = 9109121 LIMIT 1
  ) AS existing_multi_booking_late);

INSERT INTO cleanhome_staff_test.bookings
  (id, customer_id, branch_id, address_snapshot, scheduled_start, scheduled_end, status, total_amount)
SELECT 9109131, b.customer_id, b.branch_id,
  JSON_OBJECT('_cleanhome_fixture', 'cleanhome-staff-uc9-uc12-multi-v1', '_cleanhome_case', 'multi-worker',
    'recipient', '(TEST) Khách hàng Staff UC9', 'phone', 'TEST-CUSTOMER-UC9', 'address_text', 'Địa chỉ kiểm thử hai nhân viên trên một đơn'),
  DATE_ADD(b.scheduled_start, INTERVAL 3 DAY), DATE_ADD(b.scheduled_end, INTERVAL 3 DAY), 'CONFIRMED', 200000.00
FROM cleanhome_staff_test.bookings b
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109007 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.bookings WHERE id = 9109131 LIMIT 1
  ) AS existing_multi_booking_shared);

INSERT INTO cleanhome_staff_test.booking_items
  (id, booking_id, service_id, entitlement_id, service_name_snapshot, quantity, unit_price, unit_snapshot)
SELECT 9109104, b.id, s.id, NULL, s.name, 2.00, 100000.00, 'giờ'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.services s ON s.id = 9109006
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109103 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-multi-v1'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_case')) = 'employee-b'
  AND s.category_id = 9109005 AND s.description = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.booking_items WHERE id = 9109104 OR booking_id = 9109103 LIMIT 1
  ) AS existing_multi_item_b);

INSERT INTO cleanhome_staff_test.booking_items
  (id, booking_id, service_id, entitlement_id, service_name_snapshot, quantity, unit_price, unit_snapshot)
SELECT 9109112, b.id, s.id, NULL, s.name, 2.00, 100000.00, 'giờ'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.services s ON s.id = 9109006
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109111 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-multi-v1'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_case')) = 'employee-a-early'
  AND s.category_id = 9109005 AND s.description = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.booking_items WHERE id = 9109112 OR booking_id = 9109111 LIMIT 1
  ) AS existing_multi_item_early);

INSERT INTO cleanhome_staff_test.booking_items
  (id, booking_id, service_id, entitlement_id, service_name_snapshot, quantity, unit_price, unit_snapshot)
SELECT 9109122, b.id, s.id, NULL, s.name, 2.00, 100000.00, 'giờ'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.services s ON s.id = 9109006
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109121 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-multi-v1'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_case')) = 'employee-a-late'
  AND s.category_id = 9109005 AND s.description = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.booking_items WHERE id = 9109122 OR booking_id = 9109121 LIMIT 1
  ) AS existing_multi_item_late);

INSERT INTO cleanhome_staff_test.booking_items
  (id, booking_id, service_id, entitlement_id, service_name_snapshot, quantity, unit_price, unit_snapshot)
SELECT 9109132, b.id, s.id, NULL, s.name, 2.00, 100000.00, 'giờ'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.services s ON s.id = 9109006
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109131 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-multi-v1'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_case')) = 'multi-worker'
  AND s.category_id = 9109005 AND s.description = 'cleanhome-staff-uc9-uc12-v1'
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.booking_items WHERE id = 9109132 OR booking_id = 9109131 LIMIT 1
  ) AS existing_multi_item_shared);

INSERT INTO cleanhome_staff_test.assignments
  (id, booking_id, employee_id, assigned_at, check_in_at, check_out_at, status)
SELECT 9109105, b.id, e.id, UTC_TIMESTAMP(), NULL, NULL, 'ASSIGNED'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.employees e ON e.id = 9109102
JOIN cleanhome_staff_test.users u ON u.id = e.user_id
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109103 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-multi-v1'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_case')) = 'employee-b'
  AND e.user_id = 9109101 AND e.branch_id = 9109003 AND u.phone = 'TEST-EMPLOYEE-UC9-B' AND u.role = 'EMPLOYEE'
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.booking_items WHERE id = 9109104 AND booking_id = 9109103 AND service_id = 9109006)
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.assignments WHERE id = 9109105 OR (booking_id = 9109103 AND employee_id = 9109102) LIMIT 1
  ) AS existing_multi_job_b);

INSERT INTO cleanhome_staff_test.assignments
  (id, booking_id, employee_id, assigned_at, check_in_at, check_out_at, status)
SELECT 9109113, b.id, e.id, DATE_SUB(b.scheduled_start, INTERVAL 1 HOUR), NULL, NULL, 'ASSIGNED'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.employees e ON e.id = 9109004
JOIN cleanhome_staff_test.users u ON u.id = e.user_id
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109111 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-multi-v1'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_case')) = 'employee-a-early'
  AND e.user_id = 9109002 AND e.branch_id = 9109003 AND u.phone = 'TEST-EMPLOYEE-UC9' AND u.role = 'EMPLOYEE'
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.booking_items WHERE id = 9109112 AND booking_id = 9109111 AND service_id = 9109006)
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.assignments WHERE id = 9109113 OR (booking_id = 9109111 AND employee_id = 9109004) LIMIT 1
  ) AS existing_multi_job_early);

INSERT INTO cleanhome_staff_test.assignments
  (id, booking_id, employee_id, assigned_at, check_in_at, check_out_at, status)
SELECT 9109123, b.id, e.id, UTC_TIMESTAMP(), NULL, NULL, 'ACCEPTED'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.employees e ON e.id = 9109004
JOIN cleanhome_staff_test.users u ON u.id = e.user_id
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109121 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-multi-v1'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_case')) = 'employee-a-late'
  AND e.user_id = 9109002 AND e.branch_id = 9109003 AND u.phone = 'TEST-EMPLOYEE-UC9' AND u.role = 'EMPLOYEE'
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.booking_items WHERE id = 9109122 AND booking_id = 9109121 AND service_id = 9109006)
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.assignments WHERE id = 9109123 OR (booking_id = 9109121 AND employee_id = 9109004) LIMIT 1
  ) AS existing_multi_job_late);

INSERT INTO cleanhome_staff_test.assignments
  (id, booking_id, employee_id, assigned_at, check_in_at, check_out_at, status)
SELECT 9109133, b.id, e.id, UTC_TIMESTAMP(), NULL, NULL, 'ASSIGNED'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.employees e ON e.id = 9109004
JOIN cleanhome_staff_test.users u ON u.id = e.user_id
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109131 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-multi-v1'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_case')) = 'multi-worker'
  AND e.user_id = 9109002 AND e.branch_id = 9109003 AND u.phone = 'TEST-EMPLOYEE-UC9' AND u.role = 'EMPLOYEE'
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.booking_items WHERE id = 9109132 AND booking_id = 9109131 AND service_id = 9109006)
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.assignments WHERE id = 9109133 OR (booking_id = 9109131 AND employee_id = 9109004) LIMIT 1
  ) AS existing_multi_job_shared_a);

INSERT INTO cleanhome_staff_test.assignments
  (id, booking_id, employee_id, assigned_at, check_in_at, check_out_at, status)
SELECT 9109134, b.id, e.id, UTC_TIMESTAMP(), NULL, NULL, 'ASSIGNED'
FROM cleanhome_staff_test.bookings b
JOIN cleanhome_staff_test.employees e ON e.id = 9109102
JOIN cleanhome_staff_test.users u ON u.id = e.user_id
WHERE DATABASE() = 'cleanhome_staff_test' AND @cleanhome_staff_multi_allowed = 1
  AND b.id = 9109131 AND b.customer_id = 9109001 AND b.branch_id = 9109003
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_fixture')) = 'cleanhome-staff-uc9-uc12-multi-v1'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.address_snapshot, '$._cleanhome_case')) = 'multi-worker'
  AND e.user_id = 9109101 AND e.branch_id = 9109003 AND u.phone = 'TEST-EMPLOYEE-UC9-B' AND u.role = 'EMPLOYEE'
  AND EXISTS (SELECT 1 FROM cleanhome_staff_test.booking_items WHERE id = 9109132 AND booking_id = 9109131 AND service_id = 9109006)
  AND NOT EXISTS (SELECT 1 FROM (
    SELECT id FROM cleanhome_staff_test.assignments WHERE id = 9109134 OR (booking_id = 9109131 AND employee_id = 9109102) LIMIT 1
  ) AS existing_multi_job_shared_b);

COMMIT;

-- Metadata only, not an HTTP/Auth/Order integration success assertion.
SELECT DATABASE() AS selected_database, @cleanhome_staff_multi_allowed AS multi_seed_guard_passed;
SELECT u.id AS staff_user_id, u.role, u.status AS user_status, e.id AS employee_id,
  a.id AS assignment_id, a.booking_id, a.status AS assignment_status
FROM cleanhome_staff_test.users u
JOIN cleanhome_staff_test.employees e ON e.user_id = u.id
JOIN cleanhome_staff_test.assignments a ON a.employee_id = e.id
WHERE DATABASE() = 'cleanhome_staff_test'
  AND ((u.id = 9109002 AND u.phone = 'TEST-EMPLOYEE-UC9' AND e.id = 9109004
      AND a.id IN (9109008, 9109113, 9109123, 9109133))
    OR (u.id = 9109101 AND u.phone = 'TEST-EMPLOYEE-UC9-B' AND e.id = 9109102
      AND a.id IN (9109105, 9109134)))
ORDER BY e.id, a.id;
