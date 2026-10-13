# Operations

## Stripe webhooks failing

Check the signing secret and API version first; replay dead events from the ops dashboard.

1. Open the Stripe dashboard > Developers > Webhooks and check the failure reason. A 400 with "signature" means the signing secret in Secrets Manager does not match the endpoint (usually after a rotation).
2. If events reach us but processing fails, check the `stripe-events` queue in the ops dashboard. Version mismatches show as parse errors; the pinned version is in `STRIPE_API_VERSION`.
3. After fixing, replay dead events with "Retry all dead" in the ops dashboard. Processing is idempotent, so replaying is safe.

See also: Incoming webhook processing.

## Worker queue backlog

Scale the worker service, find the slow job type, and pause non-urgent schedules.

1. In the ops dashboard, sort queues by oldest waiting job. Invoice sending and PDF rendering are urgent; reports and exports are not.
2. Scale the worker: `kestrel ops scale worker --region <region> --count 12` (the default is 4, the maximum 24).
3. If one job type is slow, check its recent deploys and Sentry. Pause non-urgent schedules with `kestrel ops pause-schedule <name>`.
4. Remember to scale back down; the autoscaler does not reduce below a manual count.

See also: Job queue.

## Database failover

RDS Multi-AZ fails over in about 60 seconds; the API reconnects through RDS Proxy; check replica lag after.

A Multi-AZ failover takes about 60 seconds. RDS Proxy holds connections, so most API requests wait rather than fail. During the window, expect a burst of 5xx and a paging SLO alert.

After failover: confirm the new primary in the RDS console, check that the read replica is replicating (lag in Grafana), and post in #incidents. If the replica broke, point reports at the primary with the `reports-use-primary` flag until it is rebuilt.

See also: PostgreSQL database.

## Rotate a Stripe or Postmark key

Create the new key, add it to Secrets Manager, redeploy, verify, then revoke the old one.

1. Create a new key in the provider dashboard. Do not revoke the old one yet.
2. Update the secret in AWS Secrets Manager in both regions.
3. Force a new deployment of `api` and `worker` so containers pick up the new value.
4. Verify: send a test invoice email (Postmark) or create a test charge in a test workspace (Stripe).
5. Revoke the old key, and note the rotation in the #security channel.

See also: Secrets management.

## Customer locked out

Check SSO enforcement and the Owner break-glass password before resetting anything.

1. Find the workspace in the admin console and check whether "Enforce SSO" is on.
2. If the identity provider is down or misconfigured, the Owner can still sign in with their password (break-glass) and turn enforcement off.
3. If the Owner is also locked out, verify identity with two of: billing email, last invoice amount, last four card digits. Then support can disable SSO enforcement, which is audit-logged.

See also: Single sign-on.

## Incident process

Declare in #incidents, name an incident lead, update the status page every 30 minutes, write a review within 5 days.

Anyone can declare an incident with `/incident` in Slack, which opens a channel. The first responder is incident lead until they hand over. Severity 1 (customers cannot send invoices or sign in) or 2 (degraded) gets a status page update within 15 minutes and then every 30 minutes.

Every severity 1 or 2 incident gets a blameless review within 5 working days, with action items tracked in Linear under the `incident-followup` label.

## Code review rules

One approval for most changes; two for auth, billing and migrations; reviews within one working day.

Pull requests need one approval. Changes under `server/auth`, `server/billing` and database migrations need two, one of them from the owning team (enforced by CODEOWNERS).

Reviewers aim to respond within one working day. Pull requests over 400 changed lines (excluding generated files) should be split unless there is a reason in the description.

## Testing strategy

Vitest unit tests, API integration tests against a real Postgres in Docker, and Playwright end-to-end smoke tests.

Unit tests use Vitest. API integration tests run against real PostgreSQL and Redis in Docker (Testcontainers), never mocks of the database. Playwright covers about 30 end-to-end smoke flows (sign in, create and send an invoice, submit an expense report), run on every deploy to staging.

Money calculations have property-based tests (fast-check) for rounding and currency conversion.

## Release notes and changelog

Customer-facing changelog published weekly on Thursdays from Linear issues labeled changelog.

Product publishes a customer changelog every Thursday. Engineers add the `changelog` label in Linear and a one-sentence customer-facing description; product edits and publishes. API changes also go to the API changelog with the date and whether they are additive or breaking.

## Team structure

Four teams: Billing, Expenses, Platform and Growth; each owns services and on-call for them.

- **Billing:** invoices, payments, tax, recurring invoices, accounting integrations.
- **Expenses:** expenses, receipts and OCR, expense reports, the mobile app.
- **Platform:** infrastructure, database, auth and permissions, the public API, deploys.
- **Growth:** signup, plans and pricing pages, onboarding, email.

Each team owns its code through CODEOWNERS and is second-line on-call for its areas.

## Workspace

The tenant: one company or agency, with its own members, data, plan and region.

Also called: tenant, account, org.

A workspace is one customer company. It has members, a plan, a region and all the business data. In code and in the database it is always "workspace"; older support macros say "account" and the sales team says "org".

See also: Core data model.

## Client

Who a workspace invoices. Not the same as a member or a customer of Kestrel.

A client is a company or person that a workspace sends invoices to. Clients do not have accounts in Kestrel; they get emails and a public invoice page. "Customer" in Kestrel docs means a Kestrel workspace, so avoid calling clients customers.

## Member

A user who has joined a workspace. Also the name of a built-in role, which causes confusion.

A member is a user who belongs to a workspace through a membership. "Member" is also the name of a built-in role. In docs, write "workspace member" for the person and "the Member role" for the role.
