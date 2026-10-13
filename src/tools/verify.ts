import { z } from 'zod';
import { verify } from '../core/lifecycle.js';
import type { Deps } from './deps.js';
import { batchText, respond } from './respond.js';

export function registerVerify({ server, store, ctx }: Deps): void {
  server.registerTool(
    'verify',
    {
      description: 'Mark nodes as checked and still correct. Use after confirming a fact against the source.',
      inputSchema: { keys: z.array(z.string()).min(1) },
    },
    ({ keys }) => respond(async () => batchText('Verified', await verify(ctx, store, keys))),
  );
}
