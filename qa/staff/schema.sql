-- ISOLATED SYNTHETIC QA ONLY: cleanhome_staff_qa_isolated on a separately bound MySQL instance.
-- Apply only through seed.mjs after its database/port/server_uuid/datadir guards.
-- Relevant table definitions copied from worktree databases/schema.sql; original is unchanged.
-- No CREATE DATABASE, DROP, ALTER, disabled FK checks or shared database reference.

CREATE TABLE IF NOT EXISTS users (
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

CREATE TABLE IF NOT EXISTS branches (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  name         VARCHAR(150)  NOT NULL COMMENT 'Tên',
  address_text TEXT          NOT NULL COMMENT 'Địa chỉ',
  service_area JSON          NOT NULL COMMENT 'Khu vực phục vụ',
  latitude     DECIMAL(10,7) NOT NULL COMMENT 'Vĩ độ',
  longitude    DECIMAL(10,7) NOT NULL COMMENT 'Kinh độ',
  status       VARCHAR(20)   NOT NULL DEFAULT 'ACTIVE' COMMENT 'Trạng thái',
  PRIMARY KEY (id)
) ENGINE=InnoDB COMMENT='Chi nhánh/đối tác và khu vực phục vụ';

CREATE TABLE IF NOT EXISTS employees (
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

CREATE TABLE IF NOT EXISTS employee_availability (
  id          BIGINT      NOT NULL AUTO_INCREMENT,
  employee_id BIGINT      NOT NULL COMMENT 'Mã nhân viên',
  starts_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm bắt đầu',
  ends_at     TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Thời điểm kết thúc',
  status      VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE' COMMENT 'Trạng thái',
  PRIMARY KEY (id),
  KEY idx_avail_employee_time (employee_id, starts_at, ends_at),
  CONSTRAINT fk_avail_employee FOREIGN KEY (employee_id) REFERENCES employees(id)
) ENGINE=InnoDB COMMENT='Lịch làm việc của nhân viên';

CREATE TABLE IF NOT EXISTS service_categories (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL COMMENT 'Tên',
  description TEXT         NOT NULL COMMENT 'Mô tả',
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE COMMENT 'Đang hoạt động',
  PRIMARY KEY (id)
) ENGINE=InnoDB COMMENT='Danh mục dịch vụ';

CREATE TABLE IF NOT EXISTS services (
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

CREATE TABLE IF NOT EXISTS service_packages (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  name          VARCHAR(150)  NOT NULL COMMENT 'Tên',
  price         DECIMAL(12,2) NOT NULL COMMENT 'Giá',
  validity_days INT           NOT NULL COMMENT 'Thời hạn (ngày)',
  is_active     BOOLEAN       NOT NULL DEFAULT TRUE COMMENT 'Đang hoạt động',
  PRIMARY KEY (id)
) ENGINE=InnoDB COMMENT='Gói dịch vụ';

CREATE TABLE IF NOT EXISTS subscriptions (
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

CREATE TABLE IF NOT EXISTS entitlements (
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

CREATE TABLE IF NOT EXISTS bookings (
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

CREATE TABLE IF NOT EXISTS booking_items (
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

CREATE TABLE IF NOT EXISTS assignments (
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

CREATE TABLE IF NOT EXISTS booking_status_history (
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

CREATE TABLE IF NOT EXISTS notifications (
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

CREATE TABLE IF NOT EXISTS staff_qa_seed_marker (
  id TINYINT NOT NULL,
  run_id VARCHAR(100) NOT NULL,
  schema_version INT NOT NULL,
  seeded_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_staff_qa_seed_singleton CHECK (id = 1)
) ENGINE=InnoDB;
