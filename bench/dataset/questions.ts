/**
 * Benchmark questions. `needle` must appear in what a strategy read for the
 * answer to count as found; `answer` is the node that holds it. Search words
 * are derived from `question` by the harness, never written by hand (ADR 0013).
 */
export interface Question {
  question: string;
  answer: string;
  needle: string;
}

export const questions: Question[] = [
  {
    question: 'How long do cached permissions live in Redis?',
    answer: 'concept/permission-cache',
    needle: '5 minutes',
  },
  {
    question: 'Why was the permission cache TTL not set to 60 seconds?',
    answer: 'decision/permission-cache-ttl',
    needle: '97% to 81%',
  },
  {
    question: 'Can roles be assigned directly to a user?',
    answer: 'concept/permission-system',
    needle: 'users join groups',
  },
  { question: 'How many custom roles can a workspace have?', answer: 'concept/roles', needle: '40 custom roles' },
  {
    question: 'How long does a new Owner have to accept an ownership transfer?',
    answer: 'concept/builtin-roles',
    needle: '72 hours',
  },
  { question: 'How deep can groups be nested?', answer: 'concept/groups', needle: 'one level only' },
  {
    question: 'What HTTP status does a failed permission check return?',
    answer: 'concept/permission-check',
    needle: 'HTTP 403',
  },
  { question: 'What is the default approval limit?', answer: 'concept/approval-limit', needle: '5,000' },
  { question: 'How long are audit log entries kept?', answer: 'concept/audit-log', needle: '400 days' },
  { question: 'How long do SSO sessions last?', answer: 'concept/sso', needle: '12 hours' },
  { question: 'What prefix do live API keys start with?', answer: 'concept/api-key-scopes', needle: 'kst_live_' },
  { question: 'How much does the Business plan cost per member?', answer: 'concept/plans', needle: '19 USD' },
  { question: 'Are Viewers billed as active members?', answer: 'concept/active-member', needle: 'Viewers are billed' },
  { question: 'Which Stripe API version is pinned?', answer: 'concept/stripe-integration', needle: '2025-09-30' },
  {
    question: 'How many times is a failed webhook retried?',
    answer: 'concept/webhook-processing',
    needle: 'up to 8 times',
  },
  {
    question: 'What happens to a workspace when all subscription payment retries fail?',
    answer: 'concept/dunning',
    needle: 'becomes read-only',
  },
  {
    question: 'When are invoice numbers assigned?',
    answer: 'concept/invoice-numbering',
    needle: 'when an invoice is sent',
  },
  { question: 'How is tax rounded on invoices?', answer: 'concept/tax-calculation', needle: 'half to even' },
  {
    question: 'Where do currency conversion rates for reports come from?',
    answer: 'concept/currencies',
    needle: 'European Central Bank',
  },
  {
    question: 'What confidence does receipt OCR need to prefill fields?',
    answer: 'concept/receipt-ocr',
    needle: '0.80',
  },
  {
    question: 'What are the API rate limits on the Team plan?',
    answer: 'concept/rate-limits',
    needle: '120 requests per minute',
  },
  {
    question: 'What is the maximum page size for API list endpoints?',
    answer: 'concept/pagination',
    needle: 'maximum 200',
  },
  { question: 'When was API v1 sunset?', answer: 'concept/api-versioning', needle: '2026-03-31' },
  {
    question: 'How long are idempotency key responses stored?',
    answer: 'concept/idempotency-keys',
    needle: 'stored for 24 hours',
  },
  { question: 'How are outgoing webhook payloads signed?', answer: 'concept/outgoing-webhooks', needle: 'HMAC-SHA256' },
  { question: 'Which AWS region hosts EU workspaces?', answer: 'concept/regions', needle: 'eu-west-1' },
  {
    question: 'How long is point-in-time recovery retained for the database?',
    answer: 'concept/postgres',
    needle: '14 days',
  },
  {
    question: 'When can locking database migrations run?',
    answer: 'concept/migrations-policy',
    needle: '08:00-18:00 UTC',
  },
  { question: 'How long is the canary during production deploys?', answer: 'concept/deploys', needle: '15 minutes' },
  { question: 'When are deploys frozen?', answer: 'concept/deploys', needle: 'Friday 15:00 UTC' },
  { question: 'What is the API availability SLO?', answer: 'concept/slos', needle: '99.9%' },
  { question: 'Which email provider sends invoice emails?', answer: 'concept/email-delivery', needle: 'Postmark' },
  { question: 'How often do database passwords rotate?', answer: 'concept/secrets', needle: 'every 30 days' },
  {
    question: 'How is tenant isolation enforced in Postgres?',
    answer: 'concept/tenant-isolation',
    needle: 'row-level security',
  },
  {
    question: 'How long does a workspace data export link stay valid?',
    answer: 'concept/data-export',
    needle: 'expires after 7 days',
  },
  {
    question: 'Are invoice PDFs re-rendered when the template changes?',
    answer: 'concept/invoice-pdf',
    needle: 'never re-rendered',
  },
  {
    question: 'Why did we choose Textract over Google Document AI?',
    answer: 'decision/textract-for-ocr',
    needle: 'inside AWS',
  },
  {
    question: 'How many workers can the queue backlog runbook scale to?',
    answer: 'runbook/queue-backlog',
    needle: 'the maximum 24',
  },
  {
    question: 'How often is the status page updated during an incident?',
    answer: 'runbook/incident-process',
    needle: 'every 30 minutes',
  },
  { question: 'Which changes need two code review approvals?', answer: 'concept/code-review', needle: 'need two' },
];
