-- Owners: TV2 Catalog (services metadata, product links, stock journal)
--         TV3 Order (purchase headers/items). Requires their approval before apply.
-- Additive only. Do not import schema.sql or run on service startup.
-- Preflight: customer_config and all four named tables must be absent.
ALTER TABLE services ADD COLUMN customer_config JSON NULL;

CREATE TABLE product_services (
  product_id BIGINT NOT NULL,
  service_id BIGINT NOT NULL,
  PRIMARY KEY (product_id, service_id),
  KEY idx_product_services_service (service_id),
  CONSTRAINT fk_product_services_product FOREIGN KEY (product_id) REFERENCES products(id),
  CONSTRAINT fk_product_services_service FOREIGN KEY (service_id) REFERENCES services(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_stock_reservations (
  id BIGINT NOT NULL AUTO_INCREMENT,
  operation_key VARCHAR(100) NOT NULL,
  customer_id BIGINT NOT NULL,
  request_hash CHAR(64) NOT NULL,
  items_snapshot JSON NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'RESERVED',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_stock_operation (operation_key),
  CONSTRAINT chk_product_stock_amount CHECK (total_amount >= 0),
  CONSTRAINT chk_product_stock_status CHECK (status IN ('RESERVED','RELEASED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_orders (
  id BIGINT NOT NULL AUTO_INCREMENT,
  customer_id BIGINT NOT NULL,
  request_key CHAR(36) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  items_request JSON NOT NULL,
  contact_snapshot JSON NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PROCESSING',
  total_amount DECIMAL(12,2) NULL,
  error_code VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_order_request (customer_id, request_key),
  KEY idx_product_order_customer (customer_id, id),
  CONSTRAINT chk_product_order_amount CHECK (total_amount IS NULL OR total_amount >= 0),
  CONSTRAINT chk_product_order_status CHECK (status IN ('PROCESSING','PENDING','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE product_order_items (
  id BIGINT NOT NULL AUTO_INCREMENT,
  product_order_id BIGINT NOT NULL,
  product_id BIGINT NOT NULL,
  product_code_snapshot VARCHAR(50) NOT NULL,
  product_name_snapshot VARCHAR(200) NOT NULL,
  unit_snapshot VARCHAR(50) NOT NULL,
  quantity INT NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,
  line_total DECIMAL(12,2) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_order_item (product_order_id, product_id),
  CONSTRAINT fk_product_order_item_order FOREIGN KEY (product_order_id) REFERENCES product_orders(id),
  CONSTRAINT chk_product_order_item_quantity CHECK (quantity > 0),
  CONSTRAINT chk_product_order_item_amount CHECK (unit_price >= 0 AND line_total >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
