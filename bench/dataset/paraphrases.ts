import { type Question, questions } from './questions.js';

/**
 * The benchmark questions asked again in other words, the way a different
 * person (or model) might ask them: synonyms, aliases, a different angle.
 * Same answer node and needle as the question at the same position. Written
 * once and never tuned to make search pass (ADR 0024).
 */
const reworded: string[] = [
  'When does a cached permission expire?',
  'What was wrong with a one-minute TTL for the permission cache?',
  'Do users get roles directly, or only through groups?',
  'Is there a limit on custom roles per workspace?',
  'How much time does someone get to take over as workspace Owner?',
  'Can a group contain another group, and how far?',
  'What does the API respond with when a user lacks permission?',
  'How big can an expense be before it needs approval by default?',
  'What is the retention period for the audit log?',
  'When does a single sign-on login expire?',
  'How can you tell a production API key from its prefix?',
  'What is the per-seat price of the Business tier?',
  'Do Viewer seats count toward the bill?',
  'What version of the Stripe API do we use?',
  'How often do we retry a webhook that failed?',
  'What does dunning do to a workspace after the last failed charge?',
  'At what point does an invoice get its number?',
  'Which rounding mode does invoice tax use?',
  'What is the source of exchange rates in reports?',
  'How confident must OCR be before it fills in receipt fields?',
  'How many requests per minute does a Team plan workspace get?',
  'How many items can one page of an API list return?',
  'What date did the first API version stop working?',
  'How long do we keep the response for an idempotency key?',
  'How do receivers verify our webhook signatures?',
  'Where is data for European customers hosted?',
  'How far back can the Postgres database be restored?',
  'During which hours may migrations that lock tables be applied?',
  'How long does a canary run before a full rollout?',
  'Is there a weekly deploy freeze?',
  'What uptime target does the public API have?',
  'Which service delivers invoice email?',
  'What is the rotation schedule for database credentials?',
  'How do we keep one tenant from reading another tenant rows?',
  'How long can a data export download link be used?',
  'If the invoice template changes, do old PDFs change too?',
  'Why was Textract picked for receipt OCR?',
  'What is the worker ceiling when scaling for a queue backlog?',
  'How frequently should the status page be updated in an incident?',
  'When are two reviewers required on a pull request?',
];

if (reworded.length !== questions.length) throw new Error('One paraphrase per question.');

export const paraphrases: Question[] = questions.map((q, i) => ({ ...q, question: reworded[i]! }));

/**
 * Questions the dataset cannot answer. Each shares words with it but has at
 * least one word no node contains, so no node can match every word, and
 * search must say so instead of presenting a hit.
 */
export const unanswerable: string[] = [
  'Which Kubernetes version do the API servers run?',
  'What GraphQL schema does the public API expose?',
  'How much does the Kafka cluster for billing events cost?',
  'Which Terraform module creates the Postgres database?',
  'What is the parking policy at the office?',
  'How many vacation days does the team get?',
  'Which Python version do the background jobs use?',
  'When is the SOC 2 audit for the workspace data?',
  'What font does the invoice PDF use for the logo?',
  'Who orders lunch for the incident review?',
];
