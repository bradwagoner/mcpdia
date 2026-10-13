import { topic } from './types.js';

export const decisions = topic('decisions', [
  {
    key: 'decision/postgres-over-mongodb',
    title: 'PostgreSQL over MongoDB',
    summary: 'Money needs transactions and constraints; chose Postgres in 2022 and migrated off MongoDB by 2023.',
    tags: ['data', 'architecture'],
    links: [['references', 'concept/postgres']],
    body: `
Decided 2022-06. The first prototype used MongoDB. Invoice numbering, payments and tax all need multi-row transactions and constraints, and a double-numbered invoice in the beta made the case. We moved to PostgreSQL; the last MongoDB collection (activity feed) was migrated in 2023-02.
`,
  },
  {
    key: 'decision/no-deny-rules',
    title: 'No deny rules in permissions',
    summary: 'Permissions are additive only; deny rules made checks order-dependent and audits hard to read.',
    tags: ['auth'],
    links: [['references', 'concept/permission-system']],
    body: `
Decided 2024-01. We considered allow and deny rules, as in many IAM systems. Deny rules make the result depend on evaluation order and make "why can this person do X" hard to answer. Customers asked for deny mostly to exclude contractors, which a separate group handles. Permissions stay additive.
`,
  },
  {
    key: 'decision/fastify-over-express',
    title: 'Fastify over Express',
    summary: 'Chose Fastify for schema-based validation, hooks and about twice the throughput of Express in our tests.',
    tags: ['api', 'architecture'],
    links: [['references', 'concept/request-lifecycle']],
    body: `
Decided 2022-05. Fastify gave about twice the requests per second of Express on our benchmark, typed hooks for the request lifecycle, and first-class schema validation. Validation later moved to Zod with a Fastify adapter, but the hook model stayed.
`,
  },
  {
    key: 'decision/monorepo',
    title: 'Monorepo with pnpm workspaces',
    summary: 'One repo for api, web, worker, mobile and shared packages, managed with pnpm workspaces and Turborepo.',
    tags: ['process', 'architecture'],
    body: `
Decided 2022-05. One repository keeps the API types, the generated client and the shared validation in step. pnpm workspaces handle packages; Turborepo caches builds and tests in CI, which cut CI time from about 18 minutes to 7.
`,
  },
  {
    key: 'decision/gapless-numbering-on-send',
    title: 'Assign invoice numbers on send',
    summary: 'Numbers are assigned on send rather than at draft creation, because deleted drafts left gaps.',
    tags: ['billing'],
    links: [['references', 'concept/invoice-numbering']],
    body: `
Decided 2023-04. Assigning numbers at draft creation left gaps whenever a draft was deleted, which accountants in Germany and France flagged as a compliance problem. Assigning on send, under a row lock, removes gaps at the cost of drafts having no number.
`,
  },
  {
    key: 'decision/eu-data-residency',
    title: 'Separate EU region',
    summary: 'Added eu-west-1 in 2024 because EU agencies required data to stay in the EU; regions are full copies.',
    tags: ['infra', 'compliance'],
    links: [['references', 'concept/regions']],
    body: `
Decided 2024-02. Several large EU agencies would not sign without EU data residency. We chose fully independent regional stacks over a shared control plane, which avoids cross-border data flows entirely at the cost of running two of everything.
`,
  },
  {
    key: 'decision/textract-for-ocr',
    title: 'AWS Textract for receipt OCR',
    summary: 'Chose Textract over Google Document AI to keep receipts inside AWS and the workspace region.',
    tags: ['expenses', 'integrations'],
    links: [['references', 'concept/receipt-ocr']],
    body: `
Decided 2024-06. Google Document AI was slightly more accurate on our 500-receipt test set (94% vs 92% on totals), but Textract keeps receipts inside AWS and inside the workspace's region, which matters for EU residency.
`,
  },
  {
    key: 'decision/postmark-for-email',
    title: 'Postmark for email',
    summary: 'Chose Postmark over SES for deliverability and separate message streams; SES is the fallback.',
    tags: ['integrations'],
    links: [['references', 'concept/email-delivery']],
    body: `
Decided 2022-09. Invoices landing in spam is a top churn reason for invoicing tools. Postmark had better inbox placement in our tests and supports separate streams. Amazon SES is configured as a manual fallback, switched with the \`email-provider\` feature flag.
`,
  },
  {
    key: 'decision/no-offset-pagination',
    title: 'Cursor pagination only in v2',
    summary: 'Removed offset pagination in API v2 because deep offsets caused multi-second queries.',
    tags: ['api'],
    links: [['references', 'concept/pagination']],
    body: `
Decided 2025-01 for API v2. One integration paged through 300,000 invoices with offsets, and pages past 100,000 took several seconds each and loaded the primary. Cursors on \`(created_at, id)\` keep every page fast.
`,
  },
  {
    key: 'decision/expo-for-mobile',
    title: 'Expo for the mobile app',
    summary: 'Chose React Native with Expo to share validation and API code with the web app.',
    tags: ['frontend'],
    links: [['references', 'concept/mobile-app']],
    body: `
Decided 2024-09. A small team cannot keep two native apps in step. Expo lets the mobile app reuse the shared validation package and the generated API client, and EAS handles builds and over-the-air updates.
`,
  },
]);
