# API

## Public API

REST over JSON at api.kestrel.example/v2, API-key auth, cursor pagination, documented with OpenAPI.

The public API is REST over JSON at `https://api.kestrel.example/v2`. Authentication is a workspace API key in the `Authorization: Bearer` header. The OpenAPI document is generated from route definitions at build time and published at `/v2/openapi.json`.

The web app uses an internal API at `/internal`, which has no stability promise. Customers sometimes find it in the browser and build on it; support should point them to v2.

See also: API key scopes; API rate limits; Pagination; API versioning.

## API rate limits

Token bucket per API key: 120 requests per minute on Team, 600 on Business, with Retry-After on 429.

Rate limits are a token bucket per API key, stored in Redis. Team plan keys get 120 requests per minute with a burst of 40; Business plan keys get 600 per minute with a burst of 100. Free plan workspaces cannot create API keys.

Over the limit, the API returns 429 with a `Retry-After` header in seconds and the headers `X-RateLimit-Limit` and `X-RateLimit-Remaining`. Bulk endpoints (`/invoices:batch`) count as 10 requests.

See also: Redis.

## Pagination

Opaque cursors, default page size 50, maximum 200; offset pagination was removed in v2.

List endpoints take `limit` (default 50, maximum 200) and `cursor`. Responses include `next_cursor`, which is null on the last page. Cursors are opaque, base64-encoded and expire after 24 hours.

Offset pagination existed in v1 and was removed in v2 because deep offsets caused slow queries on large workspaces.

## API versioning

Major versions in the path; v1 was sunset on 2026-03-31; breaking changes need 12 months notice.

The major version is in the URL path (`/v2`). Additive changes (new fields, new endpoints) ship without a version bump, so clients must ignore unknown fields. Breaking changes need a new major version and at least 12 months of notice.

v1 was sunset on 2026-03-31. Requests to `/v1` now return 410 Gone with a link to the migration guide.

## API error format

Errors are JSON with code, message and request_id; codes are stable, messages are not.

Every error response has the shape `{"error": {"code": "...", "message": "...", "request_id": "..."}}`. Clients should branch on `code` (stable, snake_case, for example `validation_failed`, `forbidden`, `not_found`, `rate_limited`) and never on `message`, which may change.

Validation errors add a `fields` object mapping field paths to messages. The `request_id` matches the `X-Request-Id` header and is the fastest way to find a request in the logs.

## Idempotency keys

POST requests accept an Idempotency-Key header; responses are replayed for 24 hours.

Any POST to the public API accepts an `Idempotency-Key` header (up to 255 characters). The first response for a key is stored for 24 hours and replayed for retries with the same key and the same body. The same key with a different body returns 422 with code `idempotency_mismatch`.

The invoice send endpoint requires an idempotency key, since sending twice emails the client twice.

## Outgoing webhooks

Workspaces subscribe URLs to events; payloads are signed with HMAC-SHA256 and retried for 3 days.

Workspaces can register up to 10 webhook endpoints, each subscribed to events such as `invoice.paid` or `expense_report.approved`. Each delivery carries a `Kestrel-Signature` header: an HMAC-SHA256 of the timestamp and body with the endpoint's secret.

Failed deliveries (non-2xx or a 10-second timeout) are retried with backoff for 3 days. An endpoint that fails every delivery for 3 days is disabled and the Owner is emailed.

## API request lifecycle

Request id, auth, rate limit, permission check, handler, audit; all in the Fastify server.

The API server is Fastify on Node.js. Each request goes through these hooks in order: assign `X-Request-Id`, authenticate (session cookie or API key), rate limit, the route's permission check, input validation with Zod, the handler, then audit logging for write actions.

Handlers never call the database directly: they call services in `server/services`, which own transactions.

See also: Permission check; API rate limits.

## Accounting integrations

Two-way sync with QuickBooks Online and Xero for clients, invoices and payments; one-way for bills.

Also called: QuickBooks, Xero.

Kestrel syncs clients, invoices and payments both ways with QuickBooks Online and Xero, and exports approved expense reports one way as bills. A workspace can connect one accounting system at a time.

Conflicts are resolved "last write wins" by modification time, except that a paid invoice in either system is never un-paid by a sync. OAuth tokens are refreshed by the `accounting-token-refresh` job; Xero refresh tokens expire after 60 days without use.

See also: Incoming webhook processing.

## Debug a customer API request

Ask for the request_id, search it in Grafana Loki, then check the audit log and rate-limit headers.

1. Ask the customer for the `request_id` from the error body or the `X-Request-Id` header.
2. In Grafana, open Explore > Loki and query `{app="api"} |= "<request_id>"`.
3. A 403 is a permission check: look up the API key's creator and their groups.
4. A 429: check which key and plan; Team plan keys hit 120 per minute quickly when syncing.

See also: API error format.
