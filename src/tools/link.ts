import { z } from 'zod';
import { link } from '../core/link.js';
import type { Deps } from './deps.js';
import { respond } from './respond.js';

export function registerLink({ server, store, ctx }: Deps): void {
  server.registerTool(
    'link',
    {
      description:
        'Link two nodes with a typed edge, e.g. depends_on, part_of, references, related_to. The target may not exist yet.',
      inputSchema: {
        from: z.string().describe('Key of the source node.'),
        to: z.string().describe('Key of the target node.'),
        type: z.string(),
        note: z.string().optional().describe('Short reason for the link.'),
      },
    },
    (input) =>
      respond(async () => {
        const out = await link(ctx, store, input);
        const lines = [
          `${out.created ? 'Linked' : 'Already linked'}: ${out.fromKey} → ${out.edge.type} → ${out.toKey}.`,
        ];
        if (out.toMissing) lines.push(`${out.toKey} does not exist yet; the link resolves when it is created.`);
        if (out.typeHint) lines.push(out.typeHint);
        return lines.join('\n');
      }),
  );
}
