import { z } from 'zod';
import { annotate } from '../core/annotate.js';
import type { Deps } from './deps.js';
import { respond } from './respond.js';

export function registerAnnotate({ server, store, ctx }: Deps): void {
  server.registerTool(
    'annotate',
    {
      description:
        "Leave a note or observation about a node. Saved as its own linked note; the node itself is unchanged. Prefer this to editing a node's body.",
      inputSchema: {
        on: z.string().describe('Key of the node the note is about.'),
        text: z.string(),
        title: z.string().optional().describe('Defaults to the first line of text.'),
      },
    },
    (input) =>
      respond(async () => {
        const out = await annotate(ctx, store, input);
        return `Noted ${out.noteKey} on ${out.onKey}.`;
      }),
  );
}
