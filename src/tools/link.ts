import { z } from 'zod';
import { link, type LinkOutput } from '../core/link.js';
import type { Deps } from './deps.js';
import { respond } from './respond.js';

export function registerLink({ server, store, ctx }: Deps): void {
  server.registerTool(
    'link',
    {
      description:
        'Link two nodes with a typed edge, e.g. depends_on, part_of, references, related_to. The target may not exist yet.',
      inputSchema: {
        from: z.string(),
        to: z.string(),
        type: z.string(),
        note: z.string().optional().describe('Short reason for the link.'),
      },
    },
    (input) =>
      respond(async () => {
        return linkLines(await link(ctx, store, input)).join('\n');
      }),
  );
}

/** How a link reads in a tool result. Shared with upsert's links. */
export function linkLines(out: LinkOutput): string[] {
  const lines = [`${out.created ? 'Linked' : 'Already linked'}: ${out.fromKey} → ${out.edge.type} → ${out.toKey}.`];
  if (out.toMissing) lines.push(`${out.toKey} does not exist yet; the link resolves when it is created.`);
  if (out.typeHint) lines.push(out.typeHint);
  if (out.targetHint) lines.push(out.targetHint);
  return lines;
}
