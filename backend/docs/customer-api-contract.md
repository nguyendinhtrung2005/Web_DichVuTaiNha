# Customer API contract

Task authorization: Customer integration request and subsequent user approval in this session. The user explicitly approved phone login, schema-compatible profile/review limitations, and synthetic fixtures. The user then requested BOTH phone and email login. The additive users.email migration must be approved separately before application. No existing executable contract or API routes were present in this checkout. Provider/consumer owners TV1/TV2/TV3/TV5 and the Staff internal read owner must review before team merge; do not treat task approval as a recorded team-wide approval.

Implementation status: IMPLEMENTED; task owner approval recorded in this session. Email migration 001 was explicitly approved and applied to the verified local target, then read-only verified. HTTP/MySQL fixture and security tests have passed; browser evidence and team owner review are reported separately. No team-wide APPROVED status is inferred.

## Transport

Browser base NEXT_PUBLIC_API_URL, local default http://localhost:4000/api/v1. Exact allowed Customer Origin http://localhost:3001 (configurable), credentials include. Public mutations require Origin and application/json. HttpOnly SameSite=Lax cookie cleanhome_customer_session, Secure in production. RS256 JWT with sub/role/sid/iss/aud/iat/exp; consumers verify JWKS signature and Auth introspection for live session/account. Process-memory local session registry means Auth restart expires sessions; production multi-instance session storage is outside scope. No browser-storage tokens/passwords. Internal REST uses per-caller secrets and allowlists; gateway never proxies internal routes.

Success envelope {data:...}; errors {error:{code,message,fields?},requestId}. Lists {items,total,page,limit} within data. Codes: 400 invalid, 401 missing/expired auth, 403 role/origin, 404 absent/unowned, 409 duplicate/conflict, 422 business condition, 503 DB/dependency/config. Never return stack/SQL/credentials.

## Public API

The owner column below identifies the service/data provider, not the owner of the Customer feature implementation. Thưởng owns end-to-end Customer frontend and backend; shared provider/schema changes still follow the documented contract and migration review process.

| Service/data owner | Method/path under /api/v1 | Input/result |
|---|---|---|
| Auth TV1 | POST /auth/register | {name,phone,email?,password}; User + cookie; server assigns CUSTOMER |
| Auth TV1 | POST /auth/login | {identifier,password}; identifier phone OR normalized email; User + cookie |
| Auth TV1 | GET /auth/session | User; absent session 401 |
| Auth TV1 | POST /auth/logout | {}; revoke and clear session |
| User TV1 | GET /users/me | owned profile |
| User TV1 | PATCH /users/me | {name,phone,email?}; no avatar/address writes |
| Catalog TV2 | GET /catalog/categories | active {id,name} array |
| Catalog TV2 | GET /catalog/services | q/category/page/limit; page of actual service DTOs |
| Catalog TV2 | GET /catalog/services/:id | active Service DTO |
| Order TV3 | GET /orders | owned Order page |
| Order TV3 | GET /orders/:id | owned Order detail |
| Order | POST /orders | {requestKey?,serviceId,quantity,contact,scheduledAt,specialRequest}; derive price/duration/branch server-side, atomic booking/items/history. Customer sends a UUID key; same key + same normalized payload returns the existing booking, different payload -> 409. Key is optional for backward compatibility. |
| Order TV3 | POST /orders/:id/cancellation-requests | {reason}; pending request, booking status unchanged |
| Payment TV5 | GET /payments | owned Payment page |
| Payment TV5 | POST /orders/:id/payment-simulation | {method:cash or transfer}; unpaid/pending only, never paid |
| Review TV5 | GET /reviews | owned Review page |
| Review TV5 | POST /orders/:id/reviews | {rating,comment}; completed owned booking with real assigned employee |

## Internal REST

Auth GET /api/v1/auth/jwks and POST /internal/v1/introspect. Catalog GET /internal/v1/services/:id for Order. Staff GET /internal/v1/branches/:id and /internal/v1/bookings/:id/assignment; read only, no Staff management. Order GET /internal/v1/orders/:id?customerId= and /internal/v1/customers/:id/orders for Payment/Review. Each service reads/writes its owned tables only. Internal credentials bound to caller with route allowlists, timeouts, fail-closed behavior.

## Schema-compatible mapping

User name/phone/email are editable after email migration; email is optional and normalized lower case, not claimed verified. Avatar and editing profile address unavailable because schema lacks avatar and requires coordinates absent from UI. Existing address may display. Service slug=id, categoryName from DB, image presentation placeholder, absent scope/included/excluded empty; no demo rows. Service quantities default to 1 and duration/price derive solely from persisted catalog values. Booking contact/house metadata/specialRequest in address_snapshot version 1. createdAt is earliest history timestamp; missing legacy timestamps remain unavailable. Payment createdAt is null (schema has no creation column). Review DTO {id,orderId,customerId,staffId,serviceId,rating,comment,createdAt}; one persisted score.

Cancellation note JSON event CUSTOMER_CANCEL_REQUESTED version 1 contains reason; its history-row timestamp is the request time and booking status is preserved. Admin approval is outside scope. Config CUSTOMER_DEFAULT_BRANCH_ID must resolve to an active Staff branch. Migration 003 adds nullable customer_request_key/customer_request_hash and a per-customer unique key to bookings. Customer retries reuse the same UUID and payload; Order returns the existing booking or rejects a reused key with a different payload. Legacy callers may omit the key. Payment's stable simulation provider_ref makes duplicate submissions idempotent; existing paid/provider payments are preserved. Review uses a per-booking MySQL advisory lock, checks existing reviews, and keeps the existing booking/employee unique key, so this API admits one review per booking even if the representative employee changes. Lock release is checked before returning the connection to the pool. These mechanisms target the current single MySQL instance; there is no distributed lock spanning Order/Staff/Payment/Review status changes. Mutating requests are not automatically retried.

## Verification

Node HTTP/security/domain tests; real local HTTP APIs with synthetic MySQL fixtures only on explicitly approved 127.0.0.1:3306/dich_vu_ve_sinh, tracked-ID cleanup. Browser Customer scenarios plus Customer build/typecheck and Staff/Admin regression typechecks for shared changes. Distinguish mocked HTTP, real MySQL HTTP, and browser E2E evidence. No schema.sql execution, startup migration or seed.
