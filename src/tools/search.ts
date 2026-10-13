import { z } from 'zod';
import { RENDER_LEVELS, renderStub } from '../core/render.js';
import { search } from '../core/search.js';
import type { Deps } from './deps.js';
import { respond } from './respond.js';

export function registerSearch({ server, store, ctx }: Deps): void {
  server.registerTool(
    'search',
    {
      description:
        'Keyword search over titles, summaries, bodies, aliases and tags. Returns short stubs; use get for detail.',
      inputSchema: {
        query: z.string().describe('Plain words.'),
        type: z.string().optional().describe('Only nodes of this type.'),
        tag: z.string().optional().describe('Only nodes with this tag.'),
        level: z.enum(RENDER_LEVELS).default('summary'),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    (input) =>
      respond(async () => {
        const out = await search(ctx, store, input);
        if (out.total === 0) {
          return `No results for "${out.query}". Try fewer or different words.`;
        }
        const count = out.total > out.hits.length ? `${out.hits.length} of ${out.total}` : `${out.total}`;
        const header = out.partial
          ? `No node matched all words of "${out.query}". ${count} partial match${out.total === 1 ? '' : 'es'}, check before relying on them:`
          : `${count} result${out.total === 1 ? '' : 's'} for "${out.query}":`;
        const entries = out.hits.map((h) => `- ${renderStub(ctx, h.node, input.level, { edgeCount: h.edgeCount })}`);
        const lines = [header, ...entries];
        if (out.total > out.hits.length) {
          lines.push(`${out.total - out.hits.length} more: raise limit or add type.`);
        }
        return lines.join('\n');
      }),
  );
}
