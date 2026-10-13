import { topic } from './types.js';

export const billing = topic('billing', [
  {
    key: 'concept/plans',
    title: 'Plans and pricing',
    summary: 'Free, Team and Business plans, billed per active member per month through Stripe.',
    tags: ['billing'],
    links: [
      ['depends_on', 'concept/stripe-integration'],
      ['related_to', 'concept/active-member'],
    ],
    body: `
- **Free:** up to 3 members, 20 invoices a month, no custom roles, no SSO.
- **Team:** 9 USD per active member per month (7 USD billed yearly). Unlimited invoices, expense reports, recurring invoices.
- **Business:** 19 USD per active member per month (15 USD billed yearly). Adds custom roles, SSO, SCIM, audit log export and the approval limit second-approver flow.

Prices are set in Stripe, not in code; the app reads them from the Stripe price objects at startup and caches them for an hour. Prices in EUR and GBP match the USD number (9 EUR, 9 GBP).
`,
  },
  {
    key: 'concept/active-member',
    title: 'Active member',
    summary: 'A member who signed in or was assigned work in the billing period; only active members are billed.',
    tags: ['billing'],
    aliases: ['billable seat'],
    body: `
A member counts as active for a billing period if they signed in, or had an invoice or expense assigned to them, during that period. Invited users who never accepted are not billed. Viewers are billed like everyone else; this is the most common billing complaint.

The count is taken on the last day of the period by the \`seat-count\` job and reported to Stripe as metered usage.
`,
  },
  {
    key: 'concept/stripe-integration',
    title: 'Stripe integration',
    summary: 'Subscriptions, metered seats and card payments for invoices go through Stripe; webhooks drive state.',
    tags: ['billing', 'integrations'],
    links: [['depends_on', 'concept/webhook-processing']],
    body: `
Kestrel uses Stripe for two separate things, which are easy to confuse:

1. **Kestrel's own billing:** each workspace is a Stripe customer with one subscription. Seats are reported as metered usage.
2. **Client payments on invoices:** workspaces connect their own Stripe account (Stripe Connect, Standard accounts). Kestrel takes no fee on these.

State changes arrive as webhooks to \`/webhooks/stripe\`. The handler verifies the signature, stores the raw event in \`stripe_events\`, and processes it asynchronously. The Stripe API version is pinned to 2025-09-30 in the dashboard and in \`STRIPE_API_VERSION\`.
`,
  },
  {
    key: 'concept/webhook-processing',
    title: 'Incoming webhook processing',
    summary:
      'Store first, process later: raw events are saved, deduplicated by event id, and handled by the jobs queue.',
    tags: ['billing', 'integrations', 'reliability'],
    links: [['depends_on', 'concept/job-queue']],
    body: `
Every incoming webhook (Stripe, QuickBooks, Xero) is written to its provider table with the provider's event id as a unique key, and the endpoint returns 200 within the same request. Duplicate deliveries hit the unique key and are ignored.

A job then processes the event. Failed processing is retried with exponential backoff up to 8 times over about 21 hours, then the event is marked \`dead\` and shows up in the ops dashboard.
`,
  },
  {
    key: 'concept/dunning',
    title: 'Dunning and failed payments',
    summary: 'Stripe retries a failed subscription charge 4 times over 3 weeks; then the workspace becomes read-only.',
    tags: ['billing'],
    links: [['related_to', 'concept/stripe-integration']],
    body: `
When a subscription payment fails, Stripe Smart Retries tries 4 more times over 3 weeks, and Kestrel emails the Owner after the first, second and last failure.

If all retries fail, the workspace becomes read-only: members can view and export but cannot create or send invoices. Data is never deleted for non-payment. Paying the open invoice restores the workspace within a minute, once the \`invoice.paid\` webhook is processed.
`,
  },
  {
    key: 'concept/invoices',
    title: 'Invoices',
    summary: 'Draft, sent, viewed, paid, overdue, void: the invoice lifecycle, numbering and editing rules.',
    tags: ['billing', 'core'],
    links: [
      ['related_to', 'concept/invoice-numbering'],
      ['related_to', 'concept/tax-calculation'],
    ],
    body: `
An invoice moves through Draft, Sent, Viewed, Paid and Overdue. It can be voided from any state except Paid. Drafts are freely editable. Once sent, line items are locked; changing them requires voiding and issuing a new invoice, so the record matches what the client received.

Overdue is computed nightly from the due date in the workspace time zone. Partial payments keep the invoice in Sent or Overdue with a "Partially paid" badge.
`,
  },
  {
    key: 'concept/invoice-numbering',
    title: 'Invoice numbering',
    summary: 'Numbers are per workspace, gapless and assigned on send, not on draft, using a row lock.',
    tags: ['billing'],
    body: `
Some countries require gapless invoice numbers, so numbers are assigned when an invoice is sent, not when the draft is created. The next number comes from \`workspace_counters\` under a row lock (\`SELECT ... FOR UPDATE\`) inside the send transaction.

The format is configurable (prefix, year, padding), for example \`KST-2026-0042\`. Changing the format does not renumber existing invoices. Voided invoices keep their number, so there are no gaps.
`,
  },
  {
    key: 'concept/tax-calculation',
    title: 'Tax calculation',
    summary: 'Tax is per line item with up to two rates; rounding is per line, half-even, in the invoice currency.',
    tags: ['billing'],
    aliases: ['VAT', 'sales tax'],
    body: `
Each line item can carry up to two tax rates (for example GST and PST in Canada). Tax is computed per line and rounded per line using banker's rounding (half to even), then summed. This matched what accountants expected in user testing more than rounding once on the total.

Amounts are stored as integer minor units (cents) in \`bigint\` columns. Never use floating point for money; the lint rule \`no-float-money\` flags it.
`,
  },
  {
    key: 'concept/currencies',
    title: 'Currencies',
    summary: 'An invoice has one currency; reports convert using the daily rate from the European Central Bank.',
    tags: ['billing', 'reports'],
    body: `
Each invoice has exactly one currency, chosen at creation. Workspaces have a home currency for reports. Reports convert other currencies using the European Central Bank reference rate for the invoice date, fetched daily at 16:30 CET by the \`fx-rates\` job.

Currencies without an ECB rate (about 10 of the 41 supported) fall back to the Open Exchange Rates API.
`,
  },
  {
    key: 'concept/recurring-invoices',
    title: 'Recurring invoices',
    summary: 'A schedule that creates and optionally sends invoices; runs at 06:00 in the workspace time zone.',
    tags: ['billing'],
    links: [['depends_on', 'concept/job-queue']],
    body: `
A recurring invoice is a template plus a schedule (weekly, monthly, quarterly, yearly). The \`recurring-invoices\` job runs every 15 minutes and creates invoices whose next run time has passed; the next run time is 06:00 in the workspace time zone.

If "send automatically" is off, the invoice is created as a draft and the creator is notified. A schedule pauses itself after 3 consecutive failed sends.
`,
  },
  {
    key: 'concept/expense-reports',
    title: 'Expense reports',
    summary: 'Members group expenses into a report, submit it, and an Approver approves or rejects it.',
    tags: ['billing', 'expenses'],
    links: [
      ['related_to', 'concept/approval-limit'],
      ['related_to', 'concept/receipt-ocr'],
    ],
    body: `
Members add expenses (with receipts) and group them into an expense report. Submitting locks the report. An Approver approves or rejects it; rejections need a comment. Above the approval limit, a second approval is required.

Approved reports can be exported to QuickBooks or Xero as bills, or marked as reimbursed by hand.
`,
  },
  {
    key: 'concept/receipt-ocr',
    title: 'Receipt OCR',
    summary: 'Uploaded receipts are read by AWS Textract to prefill merchant, date, total and tax.',
    tags: ['expenses', 'integrations'],
    body: `
Receipt images and PDFs go to S3, then the \`receipt-ocr\` job sends them to AWS Textract AnalyzeExpense. Merchant, date, total and tax are prefilled when Textract's confidence is above 0.80; below that, fields stay empty and the expense shows "Check details".

Uploads are capped at 10 MB. HEIC images from iPhones are converted to JPEG before OCR.
`,
  },
]);
