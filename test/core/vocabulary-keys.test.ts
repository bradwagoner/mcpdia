import { describe, expect, it } from 'vitest';
import { soloContext } from '../../src/context.js';
import { displayKey, parseRef, slugify, suggestKey, uniqueKey } from '../../src/core/keys.js';
import {
  normalizeAlias,
  normalizeEdgeType,
  normalizeNodeType,
  normalizeTag,
  squashType,
} from '../../src/core/vocabulary.js';
import { ulid } from '../../src/ulid.js';

describe('vocabulary', () => {
  it('normalizes case, whitespace and separators only', () => {
    expect(normalizeNodeType('  Jira_Ticket ')).toBe('jira-ticket');
    expect(normalizeNodeType('How To')).toBe('how-to');
    expect(normalizeEdgeType('Depends-On')).toBe('depends_on');
    expect(normalizeEdgeType(' related  to ')).toBe('related_to');
    expect(normalizeTag('Core__Auth')).toBe('core-auth');
    expect(normalizeAlias('  Access   Control ')).toBe('access control');
  });

  it('squashes separators and a plural s for lookalike checks', () => {
    expect(squashType('how-tos')).toBe(squashType('howto'));
    expect(squashType('tickets')).toBe(squashType('ticket'));
    expect(squashType('concept')).not.toBe(squashType('decision'));
  });
});

describe('keys', () => {
  it('builds short, readable slugs', () => {
    expect(slugify('Permissions cache is 5 min')).toBe('permissions-cache-is-5-min');
    expect(slugify('Café: crème brûlée!')).toBe('cafe-creme-brulee');
    expect(slugify('one two three four five six seven')).toBe('one-two-three-four-five-six');
    expect(slugify('!!!')).toBe('untitled');
    expect(suggestKey('how-to', 'Granting admin access')).toBe('how-to/granting-admin-access');
  });

  it('keeps the lead phrase and never ends on a filler word', () => {
    // The case reported from real use: six words ended mid-phrase on "fed by".
    expect(slugify('Recommendation: Sigma.js + graphology, fed by a worker that streams nodes')).toBe(
      'recommendation-sigma-js-graphology',
    );
    expect(slugify('Cache is 5 min. Seen in prod logs.')).toBe('cache-is-5-min');
    expect(slugify('Deploys go out at noon - check with ops first')).toBe('deploys-go-out-at-noon');
    expect(slugify('Notes on the rollout of the new billing pipeline')).toBe('notes-on-the-rollout');
    expect(slugify('Note: see below')).toBe('note-see-below');
    expect(slugify('The')).toBe('the');
  });

  it('adds a numeric suffix only on collision', async () => {
    const taken = new Set(['note/a', 'note/a-2']);
    expect(await uniqueKey('note/b', async (k) => taken.has(k))).toBe('note/b');
    expect(await uniqueKey('note/a', async (k) => taken.has(k))).toBe('note/a-3');
  });

  it('parses bare keys, qualified keys and ids', () => {
    const ctx = soloContext();
    expect(parseRef(ctx, 'concept/x')).toEqual({ kind: 'key', namespace: 'default', key: 'concept/x' });
    expect(parseRef(ctx, 'dev:concept/x')).toEqual({ kind: 'key', namespace: 'dev', key: 'concept/x' });
    expect(parseRef(ctx, 'user:alice:note/x')).toEqual({ kind: 'key', namespace: 'user:alice', key: 'note/x' });
    expect(parseRef(ctx, 'ticket/PROJ-1:2')).toEqual({ kind: 'key', namespace: 'default', key: 'ticket/PROJ-1:2' });
    const id = ulid();
    expect(parseRef(ctx, id)).toEqual({ kind: 'id', id });
  });

  it('qualifies keys only when several namespaces are visible', () => {
    const one = soloContext();
    const two = { ...one, namespaces: ['default', 'dev'] };
    expect(displayKey(one, 'default', 'concept/x')).toBe('concept/x');
    expect(displayKey(two, 'default', 'concept/x')).toBe('default:concept/x');
  });
});

describe('ulid', () => {
  it('is 26 characters and sorts by time', () => {
    const a = ulid(1_000);
    const b = ulid(2_000);
    expect(a).toHaveLength(26);
    expect(a < b).toBe(true);
  });
});
