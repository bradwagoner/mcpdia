# Billing

## Plans and pricing

Free, Team and Business plans, billed per active member per month through Stripe.

- **Free:** up to 3 members, 20 invoices a month, no custom roles, no SSO.
- **Team:** 9 USD per active member per month (7 USD billed yearly). Unlimited invoices, expense reports, recurring invoices.
- **Business:** 19 USD per active member per month (15 USD billed yearly). Adds custom roles, SSO, SCIM, audit log export and the approval limit second-approver flow.

Prices are set in Stripe, not in code; the app reads them from the Stripe price objects at startup and caches them for an hour. Prices in EUR and GBP match the USD number (9 EUR, 9 GBP).

See also: Stripe integration; Active member.

## Active member

A member who signed in or was assigned work in the billing period; only active members are billed.

Also called: billable seat.

A member counts as active for a billing period if they signed in, or had an invoice or expense assigned to them, during that period. Invited users who never accepted are not billed. Viewers are billed like everyone else; this is the most common billing complaint.

The count is taken on the last day of the period by the `seat-count` job and reported to Stripe as metered usage.

## Stripe integration

Subscriptions, metered seats and card payments for invoices go through Stripe; webhooks drive state.

Kestrel uses Stripe for two separate things, which are easy to confuse:

1. **Kestrel's own billing:** each workspace is a Stripe customer with one subscription. Seats are reported as metered usage.
2. **Client payments on invoices:** workspaces connect their own Stripe account (Stripe Connect, Standard accounts). Kestrel takes no fee on these.

State changes arrive as webhooks to `/webhooks/stripe`. The handler verifies the signature, stores the raw event in `stripe_events`, and processes it asynchronously. The Stripe API version is pinned to 2025-09-30 in the dashboard and in `STRIPE_API_VERSION`.

See also: Incoming webhook processing.

## Incoming webhook processing

Store first, process later: raw events are saved, deduplicated by event id, and handled by the jobs queue.

Every incoming webhook (Stripe, QuickBooks, Xero) is written to its provider table with the provider's event id as a unique key, and the endpoint returns 200 within the same request. Duplicate deliveries hit the unique key and are ignored.

A job then processes the event. Failed processing is retried with exponential backoff up to 8 times over about 21 hours, then the event is marked `dead` and shows up in the ops dashboard.

See also: Job queue.

## Dunning and failed payments

Stripe retries a failed subscription charge 4 times over 3 weeks; then the workspace becomes read-only.

When a subscription payment fails, Stripe Smart Retries tries 4 more times over 3 weeks, and Kestrel emails the Owner after the first, second and last failure.

If all retries fail, the workspace becomes read-only: members can view and export but cannot create or send invoices. Data is never deleted for non-payment. Paying the open invoice restores the workspace within a minute, once the `invoice.paid` webhook is processed.

See also: Stripe integration.

## Invoices

Draft, sent, viewed, paid, overdue, void: the invoice lifecycle, numbering and editing rules.

An invoice moves through Draft, Sent, Viewed, Paid and Overdue. It can be voided from any state except Paid. Drafts are freely editable. Once sent, line items are locked; changing them requires voiding and issuing a new invoice, so the record matches what the client received.

Overdue is computed nightly from the due date in the workspace time zone. Partial payments keep the invoice in Sent or Overdue with a "Partially paid" badge.

See also: Invoice numbering; Tax calculation.

## Invoice numbering

Numbers are per workspace, gapless and assigned on send, not on draft, using a row lock.

Some countries require gapless invoice numbers, so numbers are assigned when an invoice is sent, not when the draft is created. The next number comes from `workspace_counters` under a row lock (`SELECT ... FOR UPDATE`) inside the send transaction.

The format is configurable (prefix, year, padding), for example `KST-2026-0042`. Changing the format does not renumber existing invoices. Voided invoices keep their number, so there are no gaps.

## Tax calculation

Tax is per line item with up to two rates; rounding is per line, half-even, in the invoice currency.

Also called: VAT, sales tax.

Each line item can carry up to two tax rates (for example GST and PST in Canada). Tax is computed per line and rounded per line using banker's rounding (half to even), then summed. This matched what accountants expected in user testing more than rounding once on the total.

Amounts are stored as integer minor units (cents) in `bigint` columns. Never use floating point for money; the lint rule `no-float-money` flags it.

## Currencies

An invoice has one currency; reports convert using the daily rate from the European Central Bank.

Each invoice has exactly one currency, chosen at creation. Workspaces have a home currency for reports. Reports convert other currencies using the European Central Bank reference rate for the invoice date, fetched daily at 16:30 CET by the `fx-rates` job.

Currencies without an ECB rate (about 10 of the 41 supported) fall back to the Open Exchange Rates API.

## Recurring invoices

A schedule that creates and optionally sends invoices; runs at 06:00 in the workspace time zone.

A recurring invoice is a template plus a schedule (weekly, monthly, quarterly, yearly). The `recurring-invoices` job runs every 15 minutes and creates invoices whose next run time has passed; the next run time is 06:00 in the workspace time zone.

If "send automatically" is off, the invoice is created as a draft and the creator is notified. A schedule pauses itself after 3 consecutive failed sends.

See also: Job queue.

## Expense reports

Members group expenses into a report, submit it, and an Approver approves or rejects it.

Members add expenses (with receipts) and group them into an expense report. Submitting locks the report. An Approver approves or rejects it; rejections need a comment. Above the approval limit, a second approval is required.

Approved reports can be exported to QuickBooks or Xero as bills, or marked as reimbursed by hand.

See also: Approval limit; Receipt OCR.

## Receipt OCR

Uploaded receipts are read by AWS Textract to prefill merchant, date, total and tax.

Receipt images and PDFs go to S3, then the `receipt-ocr` job sends them to AWS Textract AnalyzeExpense. Merchant, date, total and tax are prefilled when Textract's confidence is above 0.80; below that, fields stay empty and the expense shows "Check details".

Uploads are capped at 10 MB. HEIC images from iPhones are converted to JPEG before OCR.
