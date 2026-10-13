import { z } from 'zod';
import { feedback } from '../core/lifecycle.js';
import type { Deps } from './deps.js';
import { batchText, respond } from './respond.js';

const LABELS = { useful: 'useful', not_useful: 'not useful', outdated_or_wrong: 'outdated or wrong' } as const;

export function registerFeedback({ server, store, ctx }: Deps): void {
  server.registerTool(
    'feedback',
    {
      description:
        'Say which nodes helped. Call once at the end of a task with the useful ones; call right away for anything outdated or wrong.',
      inputSchema: {
        keys: z.array(z.string()).min(1),
        verdict: z.enum(['useful', 'not_useful', 'outdated_or_wrong']),
      },
    },
    ({ keys, verdict }) =>
      respond(async () => batchText(`Marked ${LABELS[verdict]}:`, await feedback(ctx, store, keys, verdict))),
  );
}
