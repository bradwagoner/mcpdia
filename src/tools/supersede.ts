import { z } from 'zod';
import { supersede } from '../core/lifecycle.js';
import { plural } from '../core/render.js';
import type { Deps } from './deps.js';
import { respond } from './respond.js';

export function registerSupersede({ server, store, ctx }: Deps): void {
  server.registerTool(
    'supersede',
    {
      description:
        'Replace an outdated node with a new one. Moves its links to the replacement and keeps the old one as history.',
      inputSchema: {
        old: z.string(),
        new: z
          .string()
          .optional()
          .describe('Key of the replacement, existing or new. Omit to build one from the title.'),
        type: z.string().optional().describe("Defaults to the old node's type."),
        title: z.string().optional().describe("Defaults to the old node's title."),
        summary: z.string().optional(),
        body: z.string().optional(),
        tags: z.array(z.string()).optional(),
        aliases: z.array(z.string()).optional(),
      },
    },
    (input) =>
      respond(async () => {
        const out = await supersede(ctx, store, input);
        const lines = [
          `${out.newKey}${out.created ? ' (new)' : ''} supersedes ${out.oldKey}. Moved ${plural(out.movedEdges, 'link')}.`,
        ];
        if (out.typeHint) lines.push(out.typeHint);
        return lines.join('\n');
      }),
  );
}
