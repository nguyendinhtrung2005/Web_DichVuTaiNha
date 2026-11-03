# Product purchase orders

The order service owns the product-purchase workflow. It uses the existing
`users`, `products`, and `product_inventory` tables and the additive schema in
`migrations/001_create_product_orders.sql`. Apply the migration once after the
existing catalog schema from `Database.txt`; there is no migration runner in
the current backend.

## Run locally

1. Copy `backend/.env.example` to `backend/.env`; configure the MySQL credentials
   and RSA JWT public key issued by the authentication system.
2. For a fresh database, apply the complete `Database.txt`. For an existing
   database created before purchase orders were added, apply the migration with
   a MySQL 8 client from the repository root:
   `SOURCE backend\order-service\migrations\001_create_product_orders.sql;`
   Do not apply both the updated schema and migration to the same database.
3. Start the order service from `backend/order-service` with `npm start`.
4. Start the API gateway from `backend/api-gateway` with `npm start`.

The order service listens on `SERVICE_HOST:ORDER_SERVICE_PORT` (defaults to
`127.0.0.1:4102`); the gateway routes `/api/v1/product-orders` to it.

## Workflow

The three statuses are `PENDING` (new order and stock reserved), `COMPLETED`
(delivery confirmed), and `CANCELLED`. Admin transitions are limited to
`PENDING -> COMPLETED` or `PENDING -> CANCELLED`.

On order creation, a transaction locks product inventory, validates available
stock, saves immutable item name/unit/price snapshots, and increases reserved
quantities. Completing delivery decreases both on-hand and reserved quantities.
Cancelling a pending order releases reserved quantities without changing
on-hand stock. Completed and cancelled orders are terminal. Delivery recipient,
phone, and address are stored as order-time snapshots.

The auth service in this repository is still a scaffold and does not issue
JWTs. Customer and admin APIs fail closed until the existing authentication
system issues the configured RS256 session cookie or bearer token. No customer
frontend, payment, courier integration, or service-order workflow is changed.

## API

- `POST /api/v1/product-orders` — active customer creates a delivery order.
- `GET /api/v1/admin/product-orders` — admin list with search, status, and page
  filters.
- `GET /api/v1/admin/product-orders/:id` — admin detail with item snapshots and
  delivery information.
- `PATCH /api/v1/admin/product-orders/:id/status` — admin completes delivery
  or cancels a pending order.

Run tests with `npm test` from this directory.
