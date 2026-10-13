import { api } from './api.js';
import { billing } from './billing.js';
import { decisions } from './decisions.js';
import { infrastructure } from './infrastructure.js';
import { operations } from './operations.js';
import { permissions } from './permissions.js';
import { product } from './product.js';
import type { DemoNode } from './types.js';

export { questions, type Question } from './questions.js';
export type { DemoNode } from './types.js';

export const nodes: DemoNode[] = [
  ...permissions,
  ...billing,
  ...api,
  ...infrastructure,
  ...product,
  ...decisions,
  ...operations,
];

/** Topic files on the markdown side, in index order, with their index line. */
export const files: { name: string; title: string; about: string }[] = [
  {
    name: 'permissions',
    title: 'Permissions',
    about: 'roles, groups, the permission check and cache, SSO, API key scopes',
  },
  { name: 'billing', title: 'Billing', about: 'plans, Stripe, invoices, numbering, tax, currencies, expenses, OCR' },
  {
    name: 'api',
    title: 'API',
    about: 'public API, rate limits, pagination, versioning, errors, webhooks, integrations',
  },
  {
    name: 'infrastructure',
    title: 'Infrastructure',
    about: 'architecture, regions, Postgres, Redis, jobs, deploys, observability',
  },
  { name: 'product', title: 'Product', about: 'data model, tenant isolation, reports, exports, web and mobile apps' },
  { name: 'decisions', title: 'Decisions', about: 'why we chose what we chose' },
  { name: 'operations', title: 'Operations', about: 'runbooks, incidents, team process, glossary' },
];

function titleOf(key: string): string {
  return nodes.find((n) => n.key === key)?.title ?? key;
}

function section(node: DemoNode): string {
  const parts = [`## ${node.title}`, node.summary];
  if (node.aliases?.length) parts.push(`Also called: ${node.aliases.join(', ')}.`);
  parts.push(node.body);
  const related = (node.links ?? []).map(([, to]) => titleOf(to));
  if (related.length) parts.push(`See also: ${related.join('; ')}.`);
  return parts.join('\n\n');
}

/** One topic file, written the way a team would keep a markdown memory file. */
export function renderFile(name: string): string {
  const file = files.find((f) => f.name === name);
  if (!file) throw new Error(`Unknown file ${name}`);
  const sections = nodes.filter((n) => n.file === name).map(section);
  return [`# ${file.title}`, ...sections].join('\n\n') + '\n';
}

/** The short index an agent reads first. */
export function renderIndex(): string {
  const lines = files.map((f) => `- [${f.title}](${f.name}.md): ${f.about}`);
  return ['# Kestrel team memory', 'Read the file for the topic you need.', ...lines].join('\n\n') + '\n';
}

/** Everything in one file, for the whole-file baseline. */
export function renderWhole(): string {
  return [
    '# Kestrel team memory',
    ...files.map((f) => renderFile(f.name).replace(/^# /, '## ').replace(/\n## /g, '\n### ')),
  ].join('\n\n');
}

/** Every markdown file as name → content, index first. */
export function renderMarkdown(): Map<string, string> {
  const out = new Map<string, string>([['MEMORY.md', renderIndex()]]);
  for (const f of files) out.set(`${f.name}.md`, renderFile(f.name));
  return out;
}
