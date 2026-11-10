ALTER TABLE bookings
  MODIFY COLUMN branch_id BIGINT NULL,
  MODIFY COLUMN scheduled_end TIMESTAMP NULL,
  ADD COLUMN decision_state VARCHAR(32) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN decision_source VARCHAR(16) NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN decision_reason TEXT NULL,
  ADD COLUMN duration_minutes INT NULL,
  ADD KEY idx_booking_decision_branch_start (decision_state, branch_id, scheduled_start);

UPDATE bookings
SET duration_minutes = TIMESTAMPDIFF(MINUTE, scheduled_start, scheduled_end)
WHERE scheduled_end IS NOT NULL AND scheduled_end > scheduled_start;

ALTER TABLE assignments
  ADD KEY idx_assignment_employee_status_booking (employee_id, status, booking_id);

CREATE TABLE branch_services (
  branch_id BIGINT NOT NULL,
  service_id BIGINT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (branch_id, service_id),
  KEY idx_branch_services_service (service_id, is_active, branch_id),
  CONSTRAINT fk_branch_services_branch FOREIGN KEY (branch_id) REFERENCES branches(id),
  CONSTRAINT fk_branch_services_service FOREIGN KEY (service_id) REFERENCES services(id)
) ENGINE=InnoDB;

CREATE TABLE branch_service_areas (
  id BIGINT NOT NULL AUTO_INCREMENT,
  branch_id BIGINT NOT NULL,
  region_key VARCHAR(180) NOT NULL,
  region_name VARCHAR(180) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (id),
  UNIQUE KEY uq_branch_service_area (branch_id, region_key),
  KEY idx_service_area_region (region_key, is_active, branch_id),
  CONSTRAINT fk_service_area_branch FOREIGN KEY (branch_id) REFERENCES branches(id)
) ENGINE=InnoDB;

CREATE TABLE service_auto_assignment_config (
  service_id BIGINT NOT NULL,
  skills_verified BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (service_id),
  CONSTRAINT fk_auto_assignment_service FOREIGN KEY (service_id) REFERENCES services(id)
) ENGINE=InnoDB;

CREATE TABLE service_required_skills (
  service_id BIGINT NOT NULL,
  skill_id BIGINT NOT NULL,
  PRIMARY KEY (service_id, skill_id),
  KEY idx_service_required_skill (skill_id, service_id),
  CONSTRAINT fk_required_skill_config FOREIGN KEY (service_id) REFERENCES service_auto_assignment_config(service_id),
  CONSTRAINT fk_required_skill_skill FOREIGN KEY (skill_id) REFERENCES skills(id)
) ENGINE=InnoDB;

CREATE TABLE booking_decision_history (
  id BIGINT NOT NULL AUTO_INCREMENT,
  booking_id BIGINT NOT NULL,
  actor_type VARCHAR(16) NOT NULL,
  actor_id BIGINT NULL,
  action VARCHAR(32) NOT NULL,
  previous_status VARCHAR(20) NULL,
  next_status VARCHAR(20) NOT NULL,
  previous_decision VARCHAR(32) NULL,
  next_decision VARCHAR(32) NOT NULL,
  reason TEXT NOT NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_booking_decision_history_booking_time (booking_id, created_at, id),
  KEY idx_booking_decision_history_actor (actor_type, actor_id, created_at),
  CONSTRAINT fk_booking_decision_history_booking FOREIGN KEY (booking_id) REFERENCES bookings(id),
  CONSTRAINT fk_booking_decision_history_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
