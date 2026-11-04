# Services and optional product commerce

Status: Approved for implementation after task-owner confirmation of TV2 Catalog and TV3 Order approval on 2026-10-30. Team-wide review is still required before merge. Extends customer-api-contract.md; existing endpoints and booking semantics remain compatible. No Admin authentication/backend is added through the browser demo session.

Implementation scope: Catalog and Order expose the endpoints below through the existing API Gateway; Customer uses those APIs without demo fallback. Migration `002_services_product_orders.sql` is additive. On 2026-10-30 the user separately approved applying it to local 127.0.0.1:3306 / dich_vu_ve_sinh; all five statements were applied once and metadata verified. Other environments must obtain their own database-owner approval. Until an approved environment applies it, product relations, inventory reservations, and product orders are unavailable there and must surface API errors.

## Service taxonomy and metadata

Group codes ve-sinh / cham-soc / bao-duong, labels Vệ sinh / Chăm sóc / Bảo dưỡng. Cleaning types phong-tro / nha-gia-dinh / khac. Preserve service ID, slug and category ID, stored booking snapshots and demo storage/version. Legacy dinh-ky,chuyen-sau,noi-that classify as ve-sinh; thiet-bi as bao-duong. Explicit version-1 customer_config.group overrides legacy classification; known Vietnamese category/service names may be normalized by a documented deterministic compatibility map. Unknown legacy services remain visible under a conservative documented group with their original label; no existing row is deleted or silently rewritten.

services.customer_config JSON nullable:
{version:1,group,cleaningType?,scope:[],included:[],excluded:[],image,pricingMode:fixed|reference|survey,minQuantity,defaultQuantity,quantityLabel,baseMinutes?}.
Persisted name/description/unit/base_price/duration_minutes remain authoritative. Absent legacy metadata is visibly unavailable, not fabricated. New demo fixtures explicitly provide complete metadata. Quote/survey bookings store the server's reference amount and show that the final quote needs confirmation; no paid transaction is implied.

Service DTO extends existing fields with group, groupName, cleaningType?, pricingMode. GET /catalog/services supports group and cleaningType filters alongside existing q/category/page/limit. SQL filters and DTOs classify the same normalized category-plus-service-name source (Vietnamese accents and whitespace/hyphen/underscore compatibility). Existing catalog/categories remains compatible; Customer filter presents exactly three groups independently of numeric category IDs. Booking body and routes remain service-only. The contact houseType enum adds phong-tro while retaining the existing four values; this is JSON metadata, with no extra DDL. Relevant house details are required for rental/family cleaning; equipment/care can omit inapplicable area/room/floor fields. Server pricing-mode snapshots preserve fixed/reference/survey meaning for later booking display.

## Product DTO and browsing

Product {id,code,slug,name,description,images:[],image,categoryId,categoryName,relatedServiceIds:[],price,unit,stock,status}. stock is available quantity max(quantity-reserved_quantity,0); status available|out_of_stock|inactive. IDs are strings, slug=id, code derived SP+id. No mock fallback and no shipping/payment claim.

Public GET /catalog/product-categories -> array {id,name}.
Public GET /catalog/products?q=&category=&serviceId=&page=&limit= -> paginated Product.
Public GET /catalog/products/:id -> Product (inactive direct link returns explicit unavailable status, not purchasable).
Catalog derives service links only from product_services. Suggestions never change the cart automatically and always state optional purchase.

## Cart and separate purchase orders

Cart is a tab-memory draft containing product IDs/quantities, separate from AppState demo and service booking. No password, token, contact or auth session is persisted in browser storage. A separate transient recovery draft holds submitted items/contact and the original request key, is bound to the signed-in account, and clears on account/session change. The user can explicitly retry that original draft after an unknown outcome even if the current cart changed; confirmation subtracts only submitted quantities and preserves later additions/re-added lines. UI rechecks current Product availability and shows API errors. Backend never trusts browser prices/totals/status/customer ID or schedule fields.

POST /product-orders (authenticated customer):
{requestKey:UUID,items:[{productId,quantity}],contact:{name,phone,address?,note?}}.
Max 50 distinct products, integer quantity 1..999, duplicate product IDs rejected. No serviceId, scheduledAt, branch or service order is required/accepted. Contact is for follow-up, optional address is not a shipping booking. Price in VND from Catalog in integer cents, validated upper bound.

GET /product-orders?page=&limit=; GET /product-orders/:id; POST /product-orders/:id/retry {}. Ownership derives from JWT, unowned ->404. DTO {id,code,customerId,status:processing|pending|failed,items:[],contact,total:null|number,createdAt,updatedAt,errorCode?}. Items are immutable product/name/unit/quantity/price snapshots. Processing is an honest recovery state (HTTP 202 when a journal is known but the final result is not); pending means request recorded and stock reserved, not paid/shipped. A reread that proves PENDING returns that verified state even when a prior commit response was lost. No automatic request retry.

## Ownership and stock protocol

TV2 Catalog alone writes inventory and product_stock_reservations. TV3 Order alone writes product_orders/items. Existing products/inventory are global per product, not per branch. No Order query/write of Catalog tables.

Internal, caller order only:
POST /internal/v1/product-reservations {operationKey:'purchase-<orderId>',customerId,items}.
GET /internal/v1/product-reservations/:operationKey.
POST /internal/v1/product-reservations/:operationKey/release {} (reserved for explicit confirmed rollback/reconciliation, not ambiguous timeout).

Order first journals a durable PROCESSING row with unique(customerId,requestKey) and normalized request hash. Catalog reserves atomically under inventory row locks in ascending product ID order, checks category/product status and available stock, increments reserved_quantity, records a unique operationKey/hash plus authoritative item/price snapshot. Matching operation/request keys are serialized with database-qualified advisory locks; lookup of a missing key does not take a cross-request gap lock. Repeated matching keys return the same result; mismatching payload ->409. Out-of-stock ->409, invalid input ->400, no session ->401, unowned ->404, dependency/db ->503 with existing envelope.

Order also serializes reconciliation of the same purchase ID across its REST calls so a competing definite rejection cannot mark a journal FAILED while another reconciliation reserves stock. Order journal reads/writes reuse the lock connection, including with a one-connection pool; Catalog still owns its independent inventory transaction. This is coordination within the current shared MySQL instance, not a distributed transaction or a claim that any remote timeout proves failure.

Order then atomically saves item snapshots and PENDING status. If an HTTP/commit response is ambiguous, do not release potentially committed inventory or report success: keep PROCESSING and reconcile on explicit retry of the same key or retry endpoint. A definite business rejection without any reservation marks FAILED. Active reservations have no automatic expiry because an independent timer could oversell a committed order after a lost ACK. Future fulfillment/cancellation/expiry policy needs owner review; it is not represented as working shipping/payment here.

## Migration and tests

002_services_product_orders.sql adds one nullable JSON column and four tables: product_services, product_stock_reservations (TV2); product_orders, product_order_items (TV3). Existing 32 tables/IDs/URLs are preserved. No base schema import/backfill/destructive rollback. Metadata locks and empty-table creation are the main DDL impact. Rollback first disables new routes; preserve/export product orders/reservations and reconcile inventory before any owner-reviewed table/column removal. Never auto-drop or reset data.

Unit/HTTP tests use injectable repositories. Real MySQL fixtures require separately approved 127.0.0.1:3306/dich_vu_ve_sinh target and exact tables, unique markers/ID journal and dependency-order cleanup; preserve all pre-existing rows. Browser tests reuse Chrome/CDP and existing Customer flow. Test taxonomy legacy storage/URLs, rich service detail and booking, optional suggestions, cart add/update/remove, independent checkout without a schedule, price tampering, last-stock concurrency, idempotency, unknown reserve/commit recovery, ownership and API failure.
