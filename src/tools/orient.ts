import { z } from 'zod';
import { orient } from '../core/orient.js';
import { plural, titleLine } from '../core/render.js';
import type { Deps } from './deps.js';
import { respond } from './respond.js';

export function registerOrient({ server, store, ctx }: Deps): void {
  server.registerTool(
    'orient',
    {
      description:
        'Call first. Explains this knowledge graph, its house rules and where to start. Pass a few focus words about your task to get likely-relevant entries.',
      inputSchema: { focus: z.string().optional().describe('A few words about the current task.') },
    },
    ({ focus }) =>
      respond(async () => {
        const out = await orient(ctx, store, { focus });
        const parts = [out.intro];
        if (out.houseRules.length) parts.push(['House rules:', ...out.houseRules.map((r) => `- ${r}`)].join('\n'));
        if (out.empty) {
          parts.push('The graph is empty. Use upsert to add the first node.');
          return parts.join('\n\n');
        }
        if (out.stats) {
          const s = out.stats;
          const lines = [
            `Graph: ${plural(s.nodes, 'node')} · ${plural(s.nodeTypes, 'node type')} · ${plural(s.edgeTypes, 'edge type')}`,
          ];
          if (s.topTypes.length) lines.push(`Top types: ${s.topTypes.join(', ')}`);
          if (s.topEdgeTypes.length) lines.push(`Top edge types: ${s.topEdgeTypes.join(', ')}`);
          parts.push(lines.join('\n'));
        }
        if (out.pinned.length) {
          parts.push(['Start here:', ...out.pinned.map((n) => `- ${titleLine(ctx, n)}`)].join('\n'));
        }
        if (out.focus?.nodes.length) {
          parts.push(
            [
              `Possibly relevant to "${out.focus.words}":`,
              ...out.focus.nodes.map((n) => `- ${titleLine(ctx, n)}`),
            ].join('\n'),
          );
        }
        parts.push(out.more);
        return parts.join('\n\n');
      }),
  );
}
