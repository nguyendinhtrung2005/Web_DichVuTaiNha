-- Owner: TV3 Staff (assignment transition journal), coordinated with Order.
-- Additive only. Apply manually after backup and owner review; never at startup.
-- Preflight: MySQL 8.0.16+; assignments exists; journal table is absent.
CREATE TABLE staff_assignment_transition_operations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  operation_id CHAR(36) NOT NULL,
  assignment_id BIGINT NOT NULL,
  employee_id BIGINT NOT NULL,
  booking_id BIGINT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  from_status VARCHAR(20) NOT NULL,
  to_status VARCHAR(20) NOT NULL,
  phase VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  result_snapshot JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_staff_transition_operation (operation_id),
  KEY idx_staff_transition_assignment_phase (assignment_id, phase, id),
  CONSTRAINT fk_staff_transition_assignment
    FOREIGN KEY (assignment_id) REFERENCES assignments(id),
  CONSTRAINT chk_staff_transition_phase
    CHECK (phase IN ('PENDING', 'COMPLETED', 'FAILED')),
  CONSTRAINT chk_staff_transition_status
    CHECK (
      from_status IN ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'DONE')
      AND to_status IN ('ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'DONE')
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
