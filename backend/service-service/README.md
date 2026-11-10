# Product catalog API

The service catalog owns the admin APIs for `product_categories`, `products`,
`product_images`, and `product_inventory` from the existing MySQL schema in
`Database.txt`. It does not create schema on startup.

## Run locally

1. Copy `backend/.env.example` to `backend/.env` and set real local MySQL
   credentials, the database name, and the JWT public key issued by the auth
   system. Do not commit `backend/.env`.
2. Ensure the product tables from `Database.txt` have been applied to MySQL.
3. From `backend/service-service`, run `npm start`.
4. From `backend/api-gateway`, run `npm start`.

The service listens on `SERVICE_HOST:SERVICE_SERVICE_PORT` (defaults to
`127.0.0.1:4105`); the gateway listens on `GATEWAY_HOST:GATEWAY_PORT`
(defaults to `127.0.0.1:4000`). The frontend API base defaults to
`http://localhost:4000/api`.

## Admin routes

All routes below are exposed through the gateway under `/api` and require a
valid RS256 JWT in the `cleanhome_access` cookie or an Authorization bearer
header. The API verifies issuer, audience, and signature, then checks the
account's current `users.role = 'ADMIN'` and `users.status = 'ACTIVE'` in
MySQL. Client-side role flags are not authorization.

- `GET /v1/admin/product-categories`
- `POST /v1/admin/product-categories`
- `PUT /v1/admin/product-categories/:id`
- `DELETE /v1/admin/product-categories/:id` (only when no products use it)
- `GET /v1/admin/products?search=&categoryId=&status=&page=1&pageSize=12`
- `POST /v1/admin/products`
- `GET /v1/admin/products/:id`
- `PUT /v1/admin/products/:id`
- `PATCH /v1/admin/products/:id/status`
- `PATCH /v1/admin/products/:id/inventory`
- `DELETE /v1/admin/products/:id` (only when no stock is reserved and no purchase order references it)

Inventory changes use a MySQL transaction and row lock. Reserved stock cannot
exceed total stock, and an update cannot reduce total stock below reserved
stock. Product images are URL records in `product_images`; this service does
not upload image files.

## Product purchase orders

Purchase-order APIs and their additive schema are owned by
`../order-service/README.md`; the catalog service does not implement their
workflow. Product records referenced in purchase-order history cannot be
deleted because the database enforces a foreign key.

## Authentication integration status

The repository's auth service is currently a scaffold and does not issue JWTs.
The product APIs therefore fail closed until the existing authentication
system issues the configured RS256 session cookie/token. The frontend demo
login is local-only and does not create this backend session.

## Tests

From `backend/service-service`, run `npm test`. From `backend/api-gateway`, run
`npm test`.
