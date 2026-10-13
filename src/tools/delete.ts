import { z } from 'zod';
import { softDelete } from '../core/lifecycle.js';
import type { Deps } from './deps.js';
import { batchText, respond } from './respond.js';

export function registerDelete({ server, store, ctx }: Deps): void {
  server.registerTool(
    'delete',
    {
      description: 'Remove nodes from reads. History is kept. If something replaces the node, use supersede instead.',
      inputSchema: { keys: z.array(z.string()).min(1) },
    },
    ({ keys }) => respond(async () => batchText('Deleted', await softDelete(ctx, store, keys))),
  );
}
