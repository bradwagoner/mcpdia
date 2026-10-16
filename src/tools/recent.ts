import { z } from 'zod';
import { recent } from '../core/recent.js';
import { titleLine } from '../core/render.js';
import type { Deps } from './deps.js';
import { respond } from './respond.js';

const VERBS = { created: 'created', updated: 'updated', useful: 'marked useful' } as const;

export function registerRecent({ server, store, ctx }: Deps): void {
  server.registerTool(
    'recent',
    {
      description: 'Latest changes and nodes marked useful, newest first.',
      inputSchema: {
        mine: z.boolean().default(false).describe('Only nodes you wrote last.'),
        since: z.string().optional().describe('A date (2026-10-01) or a span (3d, 12h, 2w).'),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    (input) =>
      respond(async () => {
        const entries = await recent(ctx, store, input);
        if (entries.length === 0) {
          const scope = [input.since && `since ${input.since}`, input.mine && 'yours only'].filter(Boolean);
          return scope.length ? `Nothing recent (${scope.join(', ')}).` : 'Nothing recent.';
        }
        return entries.map((e) => `- ${titleLine(ctx, e.node)} · ${VERBS[e.kind]} ${e.at.slice(0, 10)}`).join('\n');
      }),
  );
}
