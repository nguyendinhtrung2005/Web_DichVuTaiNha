CREATE TABLE product_orders (
  id               BIGINT         NOT NULL AUTO_INCREMENT,
  user_id          BIGINT         NOT NULL,
  status           ENUM('PENDING','COMPLETED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  recipient_name   VARCHAR(100)   NOT NULL,
  recipient_phone  VARCHAR(20)    NOT NULL,
  delivery_address VARCHAR(500)   NOT NULL,
  note             VARCHAR(1000)  NULL,
  total_amount     DECIMAL(12,2)  NOT NULL,
  created_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  completed_at     TIMESTAMP      NULL,
  cancelled_at     TIMESTAMP      NULL,
  PRIMARY KEY (id),
  KEY idx_product_orders_user (user_id),
  KEY idx_product_orders_status_created (status, created_at),
  CONSTRAINT fk_product_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB COMMENT='Product purchase orders';

CREATE TABLE product_order_items (
  id                    BIGINT         NOT NULL AUTO_INCREMENT,
  order_id              BIGINT         NOT NULL,
  product_id            BIGINT         NOT NULL,
  product_name_snapshot VARCHAR(200)   NOT NULL,
  product_unit_snapshot VARCHAR(50)    NOT NULL,
  unit_price_snapshot   DECIMAL(12,2)  NOT NULL,
  quantity              INT            NOT NULL,
  line_total            DECIMAL(12,2)  NOT NULL,
  PRIMARY KEY (id),
  KEY idx_product_order_items_order (order_id),
  KEY idx_product_order_items_product (product_id),
  CONSTRAINT fk_product_order_items_order FOREIGN KEY (order_id) REFERENCES product_orders(id),
  CONSTRAINT fk_product_order_items_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB COMMENT='Purchase order item snapshots';
