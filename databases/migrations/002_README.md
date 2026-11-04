# 002 Services and product commerce

Draft for TV2 Catalog / TV3 Order review; do not apply until the task owner confirms exact target and table ownership.

Migration adds services.customer_config JSON NULL and creates product_services, product_stock_reservations, product_orders, product_order_items. Existing product tables are reused; bookings and service snapshots are unchanged. No INSERT/UPDATE/backfill/seed or destructive statement is included.

Preflight: verify MySQL host/database and existing service/product table definitions, backup appropriately, and verify the new column/four tables do not already exist. The ALTER and each CREATE are individual statements; DDL is not transactional in MySQL. If partially applied, stop and inspect metadata; never rerun or drop automatically. Verify column, tables, unique constraints and foreign keys after applying.

Risk: metadata lock during ALTER; new purchase routes depend on this migration and are unavailable if missing. Deployment rollback disables new routes first, preserves/export orders/reservations, and reconciles reserved inventory before owner-reviewed removal. No destructive rollback script is supplied.

API/data ownership and recovery protocol: backend/docs/services-products-contract.md. Fixture tests are not permanent catalog/demo data; cleanup removes only verified synthetic records.
