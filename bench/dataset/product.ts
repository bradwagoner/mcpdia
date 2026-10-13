import { topic } from './types.js';

/** Data, reports and the web app. */
export const product = topic('product', [
  {
    key: 'concept/data-model',
    title: 'Core data model',
    summary: 'Workspace owns members, clients, invoices, expenses and settings; everything carries workspace_id.',
    tags: ['data', 'architecture'],
    links: [['related_to', 'concept/tenant-isolation']],
    body: `
The top-level entity is the workspace. Under it: members (users joined through memberships), clients, invoices with line items, payments, expenses, expense reports, recurring schedules, groups and roles.

Every table except \`users\` has a non-null \`workspace_id\` column, and every query filters on it. Primary keys are UUIDv7, so they sort by creation time.
`,
  },
  {
    key: 'concept/tenant-isolation',
    title: 'Tenant isolation',
    summary: 'Postgres row-level security on workspace_id, set per transaction, backs up the application filter.',
    tags: ['data', 'security'],
    links: [['references', 'concept/data-model']],
    body: `
Workspaces share tables. The application filters every query on \`workspace_id\`, and PostgreSQL row-level security enforces the same rule as a second line of defense: each transaction runs \`SET LOCAL app.workspace_id = ...\`, and RLS policies compare against it.

Background jobs that work across workspaces (\`seat-count\`, \`fx-rates\`) use a separate database role with \`BYPASSRLS\`, and only those jobs may use it.
`,
  },
  {
    key: 'concept/reports',
    title: 'Reports',
    summary:
      'Revenue, aging, expenses by category and tax summary; computed on the read replica, cached for 10 minutes.',
    tags: ['reports'],
    links: [
      ['depends_on', 'concept/postgres'],
      ['related_to', 'concept/currencies'],
    ],
    body: `
Built-in reports: revenue by month, accounts receivable aging (current, 1-30, 31-60, 61-90, 90+ days), expenses by category, and tax summary. All run against the read replica and are cached per workspace and filter set for 10 minutes.

Replica lag is usually under a second but can reach a minute during month-end, so a just-paid invoice can briefly still show as outstanding in reports.
`,
  },
  {
    key: 'concept/data-export',
    title: 'Data export',
    summary: 'Owners can export the whole workspace as a ZIP of CSVs and receipts; the link expires after 7 days.',
    tags: ['data', 'compliance'],
    body: `
Settings > Data > Export builds a ZIP with one CSV per entity and all receipt files. The \`workspace-export\` job runs on the read replica and emails the Owner a signed S3 link that expires after 7 days.

Exports are rate-limited to one per workspace per 24 hours. Very large workspaces (over 2 GB of receipts) are split into several ZIP files.
`,
  },
  {
    key: 'concept/data-retention',
    title: 'Data retention and deletion',
    summary: 'Deleted workspaces are kept 30 days, then purged; backups age out after 35 days.',
    tags: ['data', 'compliance'],
    body: `
Deleting a workspace makes it inaccessible at once and schedules a purge 30 days later, so an accidental deletion can be undone by support during that window. After the purge, the data remains only in backups, which age out after 35 days.

Individual invoices are never hard-deleted; they are voided. Expenses can be deleted while their report is still a draft.
`,
  },
  {
    key: 'concept/search-indexing',
    title: 'In-app search',
    summary: 'Postgres full-text search over clients, invoices and expenses, with trigram matching for names.',
    tags: ['data'],
    body: `
The search box uses PostgreSQL full-text search (\`tsvector\` columns maintained by triggers) for invoice notes and line items, and \`pg_trgm\` trigram indexes for client names and invoice numbers, so "acme" finds "ACME Ltd." and partial numbers work.

Results are limited to 50 and filtered by the same permission check as the list pages.
`,
  },
  {
    key: 'concept/web-app',
    title: 'Web app',
    summary: 'React 19 with TypeScript, Vite, TanStack Query and a small in-house component library.',
    tags: ['frontend'],
    links: [['related_to', 'concept/design-system']],
    body: `
The web app is React 19 and TypeScript, built with Vite and deployed as static files to S3 behind CloudFront. Server state uses TanStack Query; there is no global client store. Routing is TanStack Router with typed routes.

The app talks only to the internal API. Its generated client lives in \`web/src/api/generated\` and is rebuilt from the OpenAPI document with \`pnpm api:gen\`.
`,
  },
  {
    key: 'concept/design-system',
    title: 'Design system',
    summary: 'In-house "Perch" components on Radix primitives; tokens in CSS variables; Storybook as the catalog.',
    tags: ['frontend'],
    aliases: ['Perch'],
    body: `
Components live in the \`perch\` package, built on Radix UI primitives with CSS modules. Colors, spacing and type sizes are CSS variables defined in \`perch/tokens.css\`; dark mode swaps the variables.

Storybook is the catalog and is published on every merge. New components need a story and an accessibility check (axe) before they can be used in the app.
`,
  },
  {
    key: 'concept/i18n',
    title: 'Localization',
    summary: 'English, German, French, Spanish and Dutch; strings in ICU format, translated through Crowdin.',
    tags: ['frontend'],
    aliases: ['i18n', 'translations'],
    body: `
The app and invoice PDFs are available in English, German, French, Spanish and Dutch. Strings use ICU MessageFormat and live in \`web/locales/<lang>.json\`. Translations are managed in Crowdin and synced by a nightly GitHub Action.

Invoice language is set per client, independently of the sender's app language. Dates and numbers use the client's locale on invoices.
`,
  },
  {
    key: 'concept/invoice-pdf',
    title: 'Invoice PDF rendering',
    summary: 'PDFs are rendered by headless Chromium in the worker from an HTML template, then stored in S3.',
    tags: ['billing', 'frontend'],
    links: [['related_to', 'concept/invoices']],
    body: `
Invoice PDFs are rendered in the worker with headless Chromium (Playwright) from an HTML template, then stored in S3. A PDF is rendered once, when the invoice is sent, and that file is what the client receives and what later downloads return; it is never re-rendered, so template changes do not alter sent invoices.

Drafts render on demand for preview and are not stored. Rendering takes about 1.5 seconds per invoice.
`,
  },
  {
    key: 'concept/mobile-app',
    title: 'Mobile app',
    summary: 'React Native app for expenses and receipt capture only; invoicing stays on the web.',
    tags: ['frontend', 'expenses'],
    body: `
The iOS and Android apps are React Native (Expo) and cover expenses only: capture receipts, add expenses, submit reports and approve them. Invoicing is deliberately web-only.

The apps work offline: expenses are queued in SQLite on the device and synced when online. Minimum versions are iOS 16 and Android 10.
`,
  },
]);
