-- =====================================================================
-- CSDL HỆ THỐNG CUNG CẤP VÀ QUẢN LÝ DỊCH VỤ VỆ SINH TẠI NHÀ (MySQL 8.0+)
-- 32 bảng - tạo theo thứ tự phụ thuộc khóa ngoại
-- =====================================================================
CREATE DATABASE IF NOT EXISTS dich_vu_ve_sinh
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
USE dich_vu_ve_sinh;
 
SET FOREIGN_KEY_CHECKS = 0;
 
-- 1. users
CREATE TABLE users (
  id            BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'Mã định danh',
  full_name     VARCHAR(100) NOT NULL COMMENT 'Họ và tên',
  phone         VARCHAR(20)  NOT NULL COMMENT 'Số điện thoại',
  password_hash VARCHAR(255) NOT NULL COMMENT 'Mật khẩu đã băm',
  role          VARCHAR(20)  NOT NULL COMMENT 'Vai trò tài khoản (CUSTOMER/EMPLOYEE/ADMIN)',
  status        VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'Trạng thái',
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm tạo',
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_phone (phone)
) ENGINE=InnoDB COMMENT='Tài khoản khách hàng, nhân viên, quản trị viên';
 
-- 2. addresses
CREATE TABLE addresses (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  user_id      BIGINT        NOT NULL COMMENT 'Mã người dùng',
  recipient    VARCHAR(100)  NOT NULL COMMENT 'Tên người nhận',
  phone        VARCHAR(20)   NOT NULL COMMENT 'Số điện thoại',
  address_text TEXT          NOT NULL COMMENT 'Địa chỉ',
  latitude     DECIMAL(10,7) NOT NULL COMMENT 'Vĩ độ',
  longitude    DECIMAL(10,7) NOT NULL COMMENT 'Kinh độ',
  PRIMARY KEY (id),
  KEY idx_addresses_user (user_id),
  CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB COMMENT='Địa chỉ sử dụng dịch vụ của khách hàng';
 
-- 3. branches
CREATE TABLE branches (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  name         VARCHAR(150)  NOT NULL COMMENT 'Tên',
  address_text TEXT          NOT NULL COMMENT 'Địa chỉ',
  service_area JSON          NOT NULL COMMENT 'Khu vực phục vụ',
  latitude     DECIMAL(10,7) NOT NULL COMMENT 'Vĩ độ',
  longitude    DECIMAL(10,7) NOT NULL COMMENT 'Kinh độ',
  status       VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE' COMMENT 'Trạng thái',
  PRIMARY KEY (id)
) ENGINE=InnoDB COMMENT='Chi nhánh/đối tác và khu vực phục vụ';
 
-- 4. employees
CREATE TABLE employees (
  id                  BIGINT       NOT NULL AUTO_INCREMENT,
  user_id             BIGINT       NOT NULL COMMENT 'Mã người dùng',
  branch_id           BIGINT       NOT NULL COMMENT 'Mã chi nhánh/đối tác',
  verification_status VARCHAR(20)  NOT NULL DEFAULT 'PENDING' COMMENT 'Trạng thái xác minh',
  experience_years    INT          NOT NULL DEFAULT 0 COMMENT 'Số năm kinh nghiệm',
  response_rate       DECIMAL(5,2) NOT NULL DEFAULT 0 COMMENT 'Tỷ lệ phản hồi',
  status              VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE' COMMENT 'Trạng thái',
  PRIMARY KEY (id),
  UNIQUE KEY uq_employees_user (user_id),
  KEY idx_employees_branch (branch_id),
  CONSTRAINT fk_employees_user   FOREIGN KEY (user_id)   REFERENCES users(id),
  CONSTRAINT fk_employees_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB COMMENT='Hồ sơ nghiệp vụ nhân viên';
 
-- 5. employee_availability
CREATE TABLE employee_availability (
  id          BIGINT      NOT NULL AUTO_INCREMENT,
  employee_id BIGINT      NOT NULL COMMENT 'Mã nhân viên',
  starts_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm bắt đầu',
  ends_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm kết thúc',
  status      VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE' COMMENT 'Trạng thái',
  PRIMARY KEY (id),
  KEY idx_avail_employee_time (employee_id, starts_at, ends_at),
  CONSTRAINT fk_avail_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB COMMENT='Lịch làm việc của nhân viên';
 
-- 6. service_categories
CREATE TABLE service_categories (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL COMMENT 'Tên',
  description TEXT         NOT NULL COMMENT 'Mô tả',
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE COMMENT 'Đang hoạt động',
  PRIMARY KEY (id)
) ENGINE=InnoDB COMMENT='Danh mục dịch vụ';
 
-- 7. services
CREATE TABLE services (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  category_id      BIGINT        NOT NULL COMMENT 'Mã danh mục',
  name             VARCHAR(150)  NOT NULL COMMENT 'Tên',
  description      TEXT          NOT NULL COMMENT 'Mô tả',
  unit             VARCHAR(20)   NOT NULL COMMENT 'Đơn vị tính',
  base_price       DECIMAL(12,2) NOT NULL COMMENT 'Giá cơ bản',
  duration_minutes INT           NOT NULL COMMENT 'Thời lượng (phút)',
  is_active        BOOLEAN       NOT NULL DEFAULT TRUE COMMENT 'Đang hoạt động',
  PRIMARY KEY (id),
  KEY idx_services_category (category_id),
  CONSTRAINT fk_services_category FOREIGN KEY (category_id) REFERENCES service_categories(id)
) ENGINE=InnoDB COMMENT='Dịch vụ cung cấp';
 
-- 8. skills
CREATE TABLE skills (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL COMMENT 'Tên',
  description TEXT         NOT NULL COMMENT 'Mô tả',
  PRIMARY KEY (id)
) ENGINE=InnoDB COMMENT='Kỹ năng nhân viên';
 
-- 9. employee_skills
CREATE TABLE employee_skills (
  employee_id BIGINT      NOT NULL COMMENT 'Mã nhân viên',
  skill_id    BIGINT      NOT NULL COMMENT 'Mã kỹ năng',
  level       VARCHAR(20) NOT NULL COMMENT 'Mức độ kỹ năng',
  PRIMARY KEY (employee_id, skill_id),
  KEY idx_es_skill (skill_id),
  CONSTRAINT fk_es_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_es_skill    FOREIGN KEY (skill_id)    REFERENCES skills(id)
) ENGINE=InnoDB COMMENT='Kỹ năng và mức độ thành thạo của nhân viên';
 
-- 10. certificates
CREATE TABLE certificates (
  id                  BIGINT      NOT NULL AUTO_INCREMENT,
  employee_id         BIGINT      NOT NULL COMMENT 'Mã nhân viên',
  skill_id            BIGINT      NOT NULL COMMENT 'Mã kỹ năng',
  document_url        TEXT        NOT NULL COMMENT 'Đường dẫn tài liệu',
  issued_at           DATE        NOT NULL COMMENT 'Ngày cấp',
  expires_at          DATE        NULL COMMENT 'Ngày hết hạn',
  verification_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' COMMENT 'Trạng thái xác minh',
  PRIMARY KEY (id),
  KEY idx_cert_employee (employee_id),
  KEY idx_cert_skill (skill_id),
  CONSTRAINT fk_cert_employee FOREIGN KEY (employee_id) REFERENCES employees(id),
  CONSTRAINT fk_cert_skill    FOREIGN KEY (skill_id)    REFERENCES skills(id)
) ENGINE=InnoDB COMMENT='Chứng nhận của nhân viên';
 
-- 11. service_packages
CREATE TABLE service_packages (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  name          VARCHAR(150)  NOT NULL COMMENT 'Tên',
  price         DECIMAL(12,2) NOT NULL COMMENT 'Giá',
  validity_days INT           NOT NULL COMMENT 'Thời hạn (ngày)',
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE COMMENT 'Đang hoạt động',
  PRIMARY KEY (id)
) ENGINE=InnoDB COMMENT='Gói dịch vụ';
 
-- 12. package_items
CREATE TABLE package_items (
  package_id        BIGINT        NOT NULL COMMENT 'Mã gói dịch vụ',
  service_id        BIGINT        NOT NULL COMMENT 'Mã dịch vụ',
  included_quantity DECIMAL(10,2) NOT NULL COMMENT 'Số lượng bao gồm',
  PRIMARY KEY (package_id, service_id),
  KEY idx_pi_service (service_id),
  CONSTRAINT fk_pi_package FOREIGN KEY (package_id) REFERENCES service_packages(id),
  CONSTRAINT fk_pi_service FOREIGN KEY (service_id) REFERENCES services(id)
) ENGINE=InnoDB COMMENT='Dịch vụ nằm trong gói';
 
-- 13. subscriptions
CREATE TABLE subscriptions (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  user_id        BIGINT        NOT NULL COMMENT 'Mã người dùng',
  package_id     BIGINT        NOT NULL COMMENT 'Mã gói dịch vụ',
  starts_at      DATE          NOT NULL COMMENT 'Thời điểm bắt đầu',
  expires_at     DATE          NOT NULL COMMENT 'Ngày hết hạn',
  purchase_price DECIMAL(12,2) NOT NULL COMMENT 'Giá mua',
  status         VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE' COMMENT 'Trạng thái',
  PRIMARY KEY (id),
  KEY idx_sub_user (user_id),
  KEY idx_sub_package (package_id),
  CONSTRAINT fk_sub_user    FOREIGN KEY (user_id)    REFERENCES users(id),
  CONSTRAINT fk_sub_package FOREIGN KEY (package_id) REFERENCES service_packages(id)
) ENGINE=InnoDB COMMENT='Gói dịch vụ khách hàng đã mua';
 
-- 14. entitlements
CREATE TABLE entitlements (
  id                 BIGINT        NOT NULL AUTO_INCREMENT,
  subscription_id    BIGINT        NOT NULL COMMENT 'Mã gói khách hàng',
  service_id         BIGINT        NOT NULL COMMENT 'Mã dịch vụ',
  purchased_quantity DECIMAL(10,2) NOT NULL COMMENT 'Số lượng đã mua',
  unit_snapshot      VARCHAR(20)   NOT NULL COMMENT 'Đơn vị tại thời điểm chốt',
  PRIMARY KEY (id),
  KEY idx_ent_sub (subscription_id),
  KEY idx_ent_service (service_id),
  CONSTRAINT fk_ent_sub     FOREIGN KEY (subscription_id) REFERENCES subscriptions(id),
  CONSTRAINT fk_ent_service FOREIGN KEY (service_id)      REFERENCES services(id)
) ENGINE=InnoDB COMMENT='Quyền sử dụng dịch vụ từ gói';
 
-- 15. bookings
CREATE TABLE bookings (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  customer_id      BIGINT        NOT NULL COMMENT 'Mã khách hàng',
  branch_id        BIGINT        NOT NULL COMMENT 'Mã chi nhánh/đối tác',
  address_snapshot JSON          NOT NULL COMMENT 'Địa chỉ tại thời điểm đặt',
  scheduled_start  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời gian bắt đầu dự kiến',
  scheduled_end    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời gian kết thúc dự kiến',
  status           VARCHAR(20)   NOT NULL DEFAULT 'PENDING' COMMENT 'Trạng thái',
  total_amount     DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Tổng tiền',
  PRIMARY KEY (id),
  KEY idx_bk_customer (customer_id),
  KEY idx_bk_branch (branch_id),
  KEY idx_bk_status_start (status, scheduled_start),
  CONSTRAINT fk_bk_customer FOREIGN KEY (customer_id) REFERENCES users(id),
  CONSTRAINT fk_bk_branch   FOREIGN KEY (branch_id)   REFERENCES branches(id)
) ENGINE=InnoDB COMMENT='Đơn đặt dịch vụ';
 
-- 16. booking_items
CREATE TABLE booking_items (
  id                    BIGINT        NOT NULL AUTO_INCREMENT,
  booking_id            BIGINT        NOT NULL COMMENT 'Mã đơn đặt dịch vụ',
  service_id            BIGINT        NOT NULL COMMENT 'Mã dịch vụ',
  entitlement_id        BIGINT        NULL COMMENT 'Mã quyền sử dụng',
  service_name_snapshot VARCHAR(150)  NOT NULL COMMENT 'Tên dịch vụ tại thời điểm đặt',
  quantity              DECIMAL(10,2) NOT NULL COMMENT 'Số lượng',
  unit_price            DECIMAL(12,2) NOT NULL COMMENT 'Đơn giá',
  unit_snapshot         VARCHAR(20)   NOT NULL COMMENT 'Đơn vị tại thời điểm chốt',
  PRIMARY KEY (id),
  KEY idx_bi_booking (booking_id),
  KEY idx_bi_service (service_id),
  KEY idx_bi_entitlement (entitlement_id),
  CONSTRAINT fk_bi_booking     FOREIGN KEY (booking_id)     REFERENCES bookings(id),
  CONSTRAINT fk_bi_service     FOREIGN KEY (service_id)     REFERENCES services(id),
  CONSTRAINT fk_bi_entitlement FOREIGN KEY (entitlement_id) REFERENCES entitlements(id)
) ENGINE=InnoDB COMMENT='Dịch vụ thuộc đơn đặt';
 
-- 17. assignments
CREATE TABLE assignments (
  id           BIGINT      NOT NULL AUTO_INCREMENT,
  booking_id   BIGINT      NOT NULL COMMENT 'Mã đơn đặt dịch vụ',
  employee_id  BIGINT      NOT NULL COMMENT 'Mã nhân viên',
  assigned_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm phân công',
  check_in_at  TIMESTAMP   NULL COMMENT 'Thời điểm nhận việc',
  check_out_at TIMESTAMP   NULL COMMENT 'Thời điểm hoàn thành',
  status       VARCHAR(20) NOT NULL DEFAULT 'ASSIGNED' COMMENT 'Trạng thái',
  PRIMARY KEY (id),
  KEY idx_as_booking (booking_id),
  KEY idx_as_employee (employee_id),
  CONSTRAINT fk_as_booking  FOREIGN KEY (booking_id)  REFERENCES bookings(id),
  CONSTRAINT fk_as_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB COMMENT='Phân công nhân viên';
 
-- 18. booking_status_history
CREATE TABLE booking_status_history (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  booking_id BIGINT      NOT NULL COMMENT 'Mã đơn đặt dịch vụ',
  changed_by BIGINT      NOT NULL COMMENT 'Người thực hiện thay đổi',
  status     VARCHAR(20) NOT NULL COMMENT 'Trạng thái',
  note       TEXT        NOT NULL COMMENT 'Ghi chú',
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm tạo',
  PRIMARY KEY (id),
  KEY idx_bsh_booking (booking_id),
  KEY idx_bsh_changed_by (changed_by),
  CONSTRAINT fk_bsh_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_bsh_user    FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB COMMENT='Lịch sử trạng thái đơn';
 
-- 19. payments
CREATE TABLE payments (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  booking_id      BIGINT        NULL COMMENT 'Mã đơn đặt dịch vụ',
  subscription_id BIGINT        NULL COMMENT 'Mã gói khách hàng',
  amount          DECIMAL(12,2) NOT NULL COMMENT 'Số tiền',
  method          VARCHAR(20)   NOT NULL COMMENT 'Phương thức thanh toán',
  provider_ref    VARCHAR(100)  NULL COMMENT 'Mã giao dịch từ đơn vị thanh toán',
  status          VARCHAR(20)   NOT NULL DEFAULT 'PENDING' COMMENT 'Trạng thái',
  paid_at         TIMESTAMP     NULL COMMENT 'Thời điểm thanh toán',
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_provider_ref (provider_ref),
  KEY idx_pay_booking (booking_id),
  KEY idx_pay_subscription (subscription_id),
  CONSTRAINT fk_pay_booking      FOREIGN KEY (booking_id)      REFERENCES bookings(id),
  CONSTRAINT fk_pay_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
) ENGINE=InnoDB COMMENT='Giao dịch thanh toán';
 
-- 20. revenue_shares
CREATE TABLE revenue_shares (
  id                BIGINT        NOT NULL AUTO_INCREMENT,
  payment_id        BIGINT        NOT NULL COMMENT 'Mã thanh toán',
  branch_id         BIGINT        NULL COMMENT 'Mã chi nhánh/đối tác',
  employee_id       BIGINT        NULL COMMENT 'Mã nhân viên',
  beneficiary_type  VARCHAR(20)   NOT NULL COMMENT 'Loại đối tượng nhận doanh thu',
  amount            DECIMAL(12,2) NOT NULL COMMENT 'Số tiền',
  settlement_status VARCHAR(20)   NOT NULL DEFAULT 'PENDING' COMMENT 'Trạng thái quyết toán',
  PRIMARY KEY (id),
  KEY idx_rs_payment (payment_id),
  KEY idx_rs_branch (branch_id),
  KEY idx_rs_employee (employee_id),
  CONSTRAINT fk_rs_payment  FOREIGN KEY (payment_id)  REFERENCES payments(id),
  CONSTRAINT fk_rs_branch   FOREIGN KEY (branch_id)   REFERENCES branches(id),
  CONSTRAINT fk_rs_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB COMMENT='Phân chia doanh thu';
 
-- 21. reviews
CREATE TABLE reviews (
  id          BIGINT      NOT NULL AUTO_INCREMENT,
  booking_id  BIGINT      NOT NULL COMMENT 'Mã đơn đặt dịch vụ',
  employee_id BIGINT      NOT NULL COMMENT 'Mã nhân viên dịch vụ',
  rating      SMALLINT    NOT NULL COMMENT 'Điểm đánh giá (1-5)',
  comment     TEXT        NOT NULL COMMENT 'Nội dung đánh giá',
  created_at  TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm tạo',
  PRIMARY KEY (id),
  UNIQUE KEY uq_reviews_booking_employee (booking_id, employee_id),
  KEY idx_rv_employee (employee_id),
  CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT fk_rv_booking  FOREIGN KEY (booking_id)  REFERENCES bookings(id),
  CONSTRAINT fk_rv_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB COMMENT='Đánh giá của khách hàng';
 
-- 22. conversations
CREATE TABLE conversations (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  booking_id BIGINT      NULL COMMENT 'Mã đơn đặt dịch vụ',
  type       VARCHAR(20) NOT NULL COMMENT 'Loại (SUPPORT/AI/...)',
  created_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm tạo',
  PRIMARY KEY (id),
  KEY idx_cv_booking (booking_id),
  CONSTRAINT fk_cv_booking FOREIGN KEY (booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB COMMENT='Hội thoại hỗ trợ / AI';
 
-- 23. conversation_members
CREATE TABLE conversation_members (
  conversation_id BIGINT    NOT NULL COMMENT 'Mã hội thoại',
  user_id         BIGINT    NOT NULL COMMENT 'Mã người dùng',
  joined_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm tham gia',
  last_read_at    TIMESTAMP NULL COMMENT 'Thời điểm đọc cuối',
  PRIMARY KEY (conversation_id, user_id),
  KEY idx_cm_user (user_id),
  CONSTRAINT fk_cm_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  CONSTRAINT fk_cm_user         FOREIGN KEY (user_id)         REFERENCES users(id)
) ENGINE=InnoDB COMMENT='Thành viên hội thoại';
 
-- 24. messages
CREATE TABLE messages (
  id              BIGINT      NOT NULL AUTO_INCREMENT,
  conversation_id BIGINT      NOT NULL COMMENT 'Mã hội thoại',
  sender_id       BIGINT      NULL COMMENT 'Mã người gửi',
  sender_type     VARCHAR(20) NOT NULL COMMENT 'Loại người gửi',
  content         TEXT        NOT NULL COMMENT 'Nội dung',
  created_at      TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm tạo',
  PRIMARY KEY (id),
  KEY idx_msg_conv_time (conversation_id, created_at),
  KEY idx_msg_sender (sender_id),
  CONSTRAINT fk_msg_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  CONSTRAINT fk_msg_sender       FOREIGN KEY (sender_id)       REFERENCES users(id)
) ENGINE=InnoDB COMMENT='Tin nhắn';
 
-- 25. notifications
CREATE TABLE notifications (
  id         BIGINT    NOT NULL AUTO_INCREMENT,
  user_id    BIGINT    NOT NULL COMMENT 'Mã người dùng',
  booking_id BIGINT    NULL COMMENT 'Mã đơn đặt dịch vụ',
  content    TEXT      NOT NULL COMMENT 'Nội dung',
  read_at    TIMESTAMP NULL COMMENT 'Thời điểm đọc',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm tạo',
  PRIMARY KEY (id),
  KEY idx_nt_user (user_id),
  KEY idx_nt_booking (booking_id),
  CONSTRAINT fk_nt_user    FOREIGN KEY (user_id)    REFERENCES users(id),
  CONSTRAINT fk_nt_booking FOREIGN KEY (booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB COMMENT='Thông báo';
 
-- 26. vouchers
CREATE TABLE vouchers (
  id                  BIGINT        NOT NULL AUTO_INCREMENT,
  code                VARCHAR(50)   NOT NULL COMMENT 'Mã voucher',
  name                VARCHAR(150)  NOT NULL COMMENT 'Tên',
  discount_type       ENUM('PERCENT','FIXED') NOT NULL COMMENT 'Loại giảm giá',
  discount_value      DECIMAL(12,2) NOT NULL COMMENT 'Giá trị giảm',
  max_discount_amount DECIMAL(12,2) NULL COMMENT 'Mức giảm tối đa',
  min_eligible_amount DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Giá trị đơn tối thiểu',
  service_scope       ENUM('ALL','SELECTED') NOT NULL DEFAULT 'ALL' COMMENT 'Phạm vi áp dụng dịch vụ',
  starts_at           DATETIME      NOT NULL COMMENT 'Thời điểm bắt đầu',
  expires_at          DATETIME      NOT NULL COMMENT 'Ngày hết hạn',
  total_usage_limit   INT           NULL COMMENT 'Tổng số lượt sử dụng tối đa',
  per_user_limit      INT           NULL COMMENT 'Số lượt tối đa/người dùng',
  is_active           BOOLEAN       NOT NULL DEFAULT TRUE COMMENT 'Đang hoạt động',
  created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm tạo',
  PRIMARY KEY (id),
  UNIQUE KEY uq_vouchers_code (code)
) ENGINE=InnoDB COMMENT='Mã giảm giá';
 
-- 27. voucher_services
CREATE TABLE voucher_services (
  voucher_id BIGINT NOT NULL COMMENT 'Mã voucher',
  service_id BIGINT NOT NULL COMMENT 'Mã dịch vụ',
  PRIMARY KEY (voucher_id, service_id),
  KEY idx_vs_service (service_id),
  CONSTRAINT fk_vs_voucher FOREIGN KEY (voucher_id) REFERENCES vouchers(id),
  CONSTRAINT fk_vs_service FOREIGN KEY (service_id) REFERENCES services(id)
) ENGINE=InnoDB COMMENT='Dịch vụ được áp dụng voucher';
 
-- 28. voucher_redemptions
CREATE TABLE voucher_redemptions (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  voucher_id      BIGINT        NOT NULL COMMENT 'Mã voucher',
  booking_id      BIGINT        NOT NULL COMMENT 'Mã đơn đặt dịch vụ',
  code_snapshot   VARCHAR(50)   NOT NULL COMMENT 'Mã voucher tại thời điểm áp dụng',
  eligible_amount DECIMAL(12,2) NOT NULL COMMENT 'Giá trị được giảm',
  discount_amount DECIMAL(12,2) NOT NULL COMMENT 'Số tiền được giảm',
  status          ENUM('RESERVED','USED','CANCELLED') NOT NULL DEFAULT 'RESERVED' COMMENT 'Trạng thái',
  reserved_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm giữ mã',
  used_at         DATETIME      NULL COMMENT 'Thời điểm sử dụng',
  cancelled_at    DATETIME      NULL COMMENT 'Thời điểm hủy',
  PRIMARY KEY (id),
  UNIQUE KEY uq_vr_booking (booking_id),
  KEY idx_vr_voucher (voucher_id),
  CONSTRAINT fk_vr_voucher FOREIGN KEY (voucher_id) REFERENCES vouchers(id),
  CONSTRAINT fk_vr_booking FOREIGN KEY (booking_id) REFERENCES bookings(id)
) ENGINE=InnoDB COMMENT='Voucher đã giữ/sử dụng trên đơn';
 
-- 29. product_categories
CREATE TABLE product_categories (
  id          BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'Mã định danh danh mục sản phẩm',
  name        VARCHAR(100) NOT NULL COMMENT 'Tên danh mục sản phẩm',
  description TEXT         NULL COMMENT 'Mô tả danh mục',
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE COMMENT 'Trạng thái hoạt động',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm tạo',
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Thời điểm cập nhật',
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_categories_name (name)
) ENGINE=InnoDB COMMENT='Danh mục sản phẩm';
 
-- 30. products
CREATE TABLE products (
  id          BIGINT        NOT NULL AUTO_INCREMENT COMMENT 'Mã định danh sản phẩm',
  category_id BIGINT        NOT NULL COMMENT 'Mã danh mục',
  name        VARCHAR(200)  NOT NULL COMMENT 'Tên sản phẩm',
  description TEXT          NULL COMMENT 'Mô tả chi tiết',
  unit        VARCHAR(50)   NOT NULL COMMENT 'Đơn vị tính',
  price       DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Giá bán',
  status      ENUM('AVAILABLE','OUT_OF_STOCK','INACTIVE') NOT NULL DEFAULT 'AVAILABLE' COMMENT 'Trạng thái',
  created_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm tạo',
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Thời điểm cập nhật',
  PRIMARY KEY (id),
  KEY idx_products_category (category_id),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES product_categories(id)
) ENGINE=InnoDB COMMENT='Sản phẩm';
 
-- 31. product_images
CREATE TABLE product_images (
  id         BIGINT       NOT NULL AUTO_INCREMENT COMMENT 'Mã hình ảnh',
  product_id BIGINT       NOT NULL COMMENT 'Mã sản phẩm',
  image_url  VARCHAR(500) NOT NULL COMMENT 'URL hình ảnh',
  is_primary BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'Ảnh đại diện chính',
  sort_order INT          NOT NULL DEFAULT 0 COMMENT 'Thứ tự hiển thị',
  created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm thêm',
  PRIMARY KEY (id),
  KEY idx_pimg_product (product_id),
  CONSTRAINT fk_pimg_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB COMMENT='Hình ảnh sản phẩm';
 
-- 32. product_inventory
CREATE TABLE product_inventory (
  id                BIGINT    NOT NULL AUTO_INCREMENT COMMENT 'Mã bản ghi tồn kho',
  product_id        BIGINT    NOT NULL COMMENT 'Mã sản phẩm',
  quantity          INT       NOT NULL DEFAULT 0 COMMENT 'Tổng số lượng hiện có',
  reserved_quantity INT       NOT NULL DEFAULT 0 COMMENT 'Số lượng đã giữ cho đơn hàng',
  min_stock         INT       NOT NULL DEFAULT 0 COMMENT 'Mức tồn kho tối thiểu để cảnh báo',
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Thời điểm cập nhật',
  PRIMARY KEY (id),
  UNIQUE KEY uq_pinv_product (product_id),
  CONSTRAINT fk_pinv_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB COMMENT='Tồn kho sản phẩm';
 
SET FOREIGN_KEY_CHECKS = 1;
 