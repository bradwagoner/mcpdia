import { topic } from './types.js';

export const infrastructure = topic('infrastructure', [
  {
    key: 'concept/architecture-overview',
    title: 'Architecture overview',
    summary:
      'A Fastify API, a React web app, a jobs worker, Postgres and Redis, on AWS ECS Fargate in eu-west-1 and us-east-1.',
    tags: ['architecture', 'infra'],
    links: [
      ['depends_on', 'concept/postgres'],
      ['depends_on', 'concept/redis'],
      ['depends_on', 'concept/job-queue'],
      ['related_to', 'concept/regions'],
    ],
    body: `
Kestrel is a monorepo with three deployable services: \`api\` (Fastify), \`web\` (React, served as static files from CloudFront) and \`worker\` (background jobs). Data lives in PostgreSQL 17 on Amazon RDS and in Redis (ElastiCache). Files go to S3.

Services run as containers on ECS Fargate. Each region is a full, independent copy of the stack; there is no cross-region traffic apart from the global sign-in directory.
`,
  },
  {
    key: 'concept/regions',
    title: 'Regions and data residency',
    summary: 'EU workspaces live in eu-west-1 (Ireland), all others in us-east-1; a workspace never moves on its own.',
    tags: ['infra', 'compliance'],
    body: `
A workspace's region is chosen at signup from the billing country: EU and EEA countries, the UK and Switzerland go to eu-west-1 (Ireland); everything else goes to us-east-1 (N. Virginia). All of a workspace's data, backups and files stay in its region.

Moving a workspace between regions is a manual support operation using the \`region-move\` script, with the workspace read-only for the duration (usually under an hour).
`,
  },
  {
    key: 'concept/postgres',
    title: 'PostgreSQL database',
    summary: 'RDS PostgreSQL 17, one primary and one read replica per region; migrations with node-pg-migrate.',
    tags: ['infra', 'data'],
    aliases: ['database', 'RDS'],
    links: [['related_to', 'concept/migrations-policy']],
    body: `
Each region has one RDS PostgreSQL 17 primary (db.r7g.2xlarge) with Multi-AZ failover, and one read replica used by reports and exports. Connections go through RDS Proxy; the API's pool size is 20 per container.

Point-in-time recovery is enabled with 14 days of retention. A daily snapshot is copied to a separate backup account and kept for 35 days.
`,
  },
  {
    key: 'concept/migrations-policy',
    title: 'Database migrations policy',
    summary: 'Expand and contract: migrations must be backward compatible with the previous release.',
    tags: ['infra', 'data', 'process'],
    links: [['references', 'concept/postgres']],
    body: `
Migrations run automatically before the new \`api\` containers start, so the old code keeps running against the new schema for a few minutes. Every migration must therefore work with the previous release: add columns as nullable, backfill in a job, and drop old columns one release later ("expand and contract").

Locking migrations (adding an index without \`CONCURRENTLY\`, rewriting a large table) need a reviewer from the platform team and must run outside 08:00-18:00 UTC.
`,
  },
  {
    key: 'concept/redis',
    title: 'Redis',
    summary:
      'ElastiCache Redis 7 for the permission cache, rate limits, sessions and the job queue; not durable storage.',
    tags: ['infra'],
    body: `
Redis 7 on ElastiCache, one cluster per region. It holds the permission cache, rate-limit buckets, web sessions and the BullMQ job queue.

Treat Redis as disposable except for the job queue: a cache flush must never lose data. Sessions in Redis can be lost; users sign in again. Job durability relies on Redis AOF persistence being on (\`appendfsync everysec\`), so up to a second of enqueued jobs can be lost in a crash.
`,
  },
  {
    key: 'concept/job-queue',
    title: 'Job queue',
    summary: 'BullMQ on Redis, processed by the worker service; jobs must be idempotent.',
    tags: ['infra', 'reliability'],
    aliases: ['background jobs', 'BullMQ'],
    links: [['depends_on', 'concept/redis']],
    body: `
Background work runs in the \`worker\` service using BullMQ queues on Redis. Scheduled jobs (\`fx-rates\`, \`recurring-invoices\`, \`seat-count\`, nightly overdue checks) are defined in \`worker/schedules.ts\`.

Every job must be idempotent: it can run twice after a crash or a retry. The default retry policy is 5 attempts with exponential backoff from 30 seconds. Failed jobs stay in the failed set for 14 days and appear on the ops dashboard.
`,
  },
  {
    key: 'concept/deploys',
    title: 'Deploys',
    summary: 'Merges to main deploy automatically through GitHub Actions, with a 10% canary for 15 minutes.',
    tags: ['infra', 'process'],
    links: [['related_to', 'concept/feature-flags']],
    body: `
Every merge to \`main\` builds images in GitHub Actions and deploys to staging, runs the smoke suite, then deploys to production. Production deploys start as a 10% canary for 15 minutes; if the 5xx rate or p95 latency alarms fire during the canary, the deploy rolls back automatically.

Deploys are frozen from Friday 15:00 UTC to Monday 08:00 UTC and during the last two days of each month, when invoice volume peaks. The freeze can be overridden for incidents by the on-call engineer.
`,
  },
  {
    key: 'concept/feature-flags',
    title: 'Feature flags',
    summary: 'Flags live in LaunchDarkly; flag keys use kebab-case and every flag has an owner and a removal date.',
    tags: ['infra', 'process'],
    body: `
Feature flags are managed in LaunchDarkly, targeted by workspace id and plan. Flag keys are kebab-case with a team prefix, for example \`billing-new-tax-engine\`.

Every flag must have an owner and a planned removal date in its description. Flags older than 90 days show up in the weekly engineering review. Server code reads flags through \`flags.isOn(key, ctx)\`; never call the LaunchDarkly SDK directly.
`,
  },
  {
    key: 'concept/observability',
    title: 'Observability',
    summary: 'Logs in Grafana Loki, metrics in Prometheus, traces in Tempo, errors in Sentry; dashboards in Grafana.',
    tags: ['infra', 'ops'],
    links: [['related_to', 'concept/alerts']],
    body: `
Logs are JSON lines shipped to Grafana Loki and kept 30 days. Metrics are Prometheus, traces are OpenTelemetry sent to Tempo with 10% sampling (100% for errors). Uncaught exceptions go to Sentry, project \`kestrel-api\` or \`kestrel-web\`.

Never log full request bodies: they contain bank details and client addresses. The logger redacts fields named \`iban\`, \`account_number\`, \`email\` and \`address\` automatically.
`,
  },
  {
    key: 'concept/alerts',
    title: 'Alerts and on-call',
    summary: 'PagerDuty pages for SLO burn and queue backlog; one primary and one secondary on-call per week.',
    tags: ['ops'],
    links: [['related_to', 'concept/slos']],
    body: `
Alerts page through PagerDuty. Paging alerts: API availability SLO burn rate, worker queue backlog older than 15 minutes, RDS CPU above 85% for 10 minutes, and Stripe webhook failures above 5% for 10 minutes. Everything else goes to the #ops-alerts Slack channel without paging.

On-call rotates weekly on Mondays at 10:00 UTC, with one primary and one secondary. The primary must acknowledge a page within 10 minutes, otherwise it escalates to the secondary.
`,
  },
  {
    key: 'concept/slos',
    title: 'Service level objectives',
    summary: 'API availability 99.9% monthly; p95 latency under 400 ms; invoice email sent within 2 minutes.',
    tags: ['ops', 'reliability'],
    body: `
- API availability: 99.9% of requests succeed (non-5xx), measured monthly. That is about 43 minutes of error budget a month.
- API latency: p95 under 400 ms for reads and 800 ms for writes.
- Invoice email delivery: 99% handed to the email provider within 2 minutes of "Send".

When a service spends more than half its monthly error budget, feature deploys to it pause until the budget recovers.
`,
  },
  {
    key: 'concept/email-delivery',
    title: 'Email delivery',
    summary: 'Transactional email through Postmark, with a separate message stream for invoices.',
    tags: ['infra', 'integrations'],
    body: `
All email goes through Postmark. Invoice emails use the \`invoices\` message stream; sign-in links, alerts and digests use \`transactional\`. Keeping invoices separate protects their sender reputation.

Workspaces can send invoices from their own domain after adding the DKIM and Return-Path DNS records shown in Settings > Email. Bounces and spam complaints mark the client's email as undeliverable and show a warning on the client.
`,
  },
  {
    key: 'concept/secrets',
    title: 'Secrets management',
    summary: 'Secrets live in AWS Secrets Manager, injected at container start; never in env files in the repo.',
    tags: ['infra', 'security'],
    body: `
Runtime secrets (database passwords, Stripe keys, Postmark tokens) are stored in AWS Secrets Manager and injected into containers as environment variables by ECS at start. Local development uses \`.env.local\`, which is git-ignored, with test-mode keys only.

Database passwords rotate automatically every 30 days. Rotating a Stripe or Postmark key is manual; follow the secret rotation runbook.
`,
  },
]);
