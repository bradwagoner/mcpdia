# Decisions

## PostgreSQL over MongoDB

Money needs transactions and constraints; chose Postgres in 2022 and migrated off MongoDB by 2023.

Decided 2022-06. The first prototype used MongoDB. Invoice numbering, payments and tax all need multi-row transactions and constraints, and a double-numbered invoice in the beta made the case. We moved to PostgreSQL; the last MongoDB collection (activity feed) was migrated in 2023-02.

See also: PostgreSQL database.

## No deny rules in permissions

Permissions are additive only; deny rules made checks order-dependent and audits hard to read.

Decided 2024-01. We considered allow and deny rules, as in many IAM systems. Deny rules make the result depend on evaluation order and make "why can this person do X" hard to answer. Customers asked for deny mostly to exclude contractors, which a separate group handles. Permissions stay additive.

See also: Permission system.

## Fastify over Express

Chose Fastify for schema-based validation, hooks and about twice the throughput of Express in our tests.

Decided 2022-05. Fastify gave about twice the requests per second of Express on our benchmark, typed hooks for the request lifecycle, and first-class schema validation. Validation later moved to Zod with a Fastify adapter, but the hook model stayed.

See also: API request lifecycle.

## Monorepo with pnpm workspaces

One repo for api, web, worker, mobile and shared packages, managed with pnpm workspaces and Turborepo.

Decided 2022-05. One repository keeps the API types, the generated client and the shared validation in step. pnpm workspaces handle packages; Turborepo caches builds and tests in CI, which cut CI time from about 18 minutes to 7.

## Assign invoice numbers on send

Numbers are assigned on send rather than at draft creation, because deleted drafts left gaps.

Decided 2023-04. Assigning numbers at draft creation left gaps whenever a draft was deleted, which accountants in Germany and France flagged as a compliance problem. Assigning on send, under a row lock, removes gaps at the cost of drafts having no number.

See also: Invoice numbering.

## Separate EU region

Added eu-west-1 in 2024 because EU agencies required data to stay in the EU; regions are full copies.

Decided 2024-02. Several large EU agencies would not sign without EU data residency. We chose fully independent regional stacks over a shared control plane, which avoids cross-border data flows entirely at the cost of running two of everything.

See also: Regions and data residency.

## AWS Textract for receipt OCR

Chose Textract over Google Document AI to keep receipts inside AWS and the workspace region.

Decided 2024-06. Google Document AI was slightly more accurate on our 500-receipt test set (94% vs 92% on totals), but Textract keeps receipts inside AWS and inside the workspace's region, which matters for EU residency.

See also: Receipt OCR.

## Postmark for email

Chose Postmark over SES for deliverability and separate message streams; SES is the fallback.

Decided 2022-09. Invoices landing in spam is a top churn reason for invoicing tools. Postmark had better inbox placement in our tests and supports separate streams. Amazon SES is configured as a manual fallback, switched with the `email-provider` feature flag.

See also: Email delivery.

## Cursor pagination only in v2

Removed offset pagination in API v2 because deep offsets caused multi-second queries.

Decided 2025-01 for API v2. One integration paged through 300,000 invoices with offsets, and pages past 100,000 took several seconds each and loaded the primary. Cursors on `(created_at, id)` keep every page fast.

See also: Pagination.

## Expo for the mobile app

Chose React Native with Expo to share validation and API code with the web app.

Decided 2024-09. A small team cannot keep two native apps in step. Expo lets the mobile app reuse the shared validation package and the generated API client, and EAS handles builds and over-the-air updates.

See also: Mobile app.
