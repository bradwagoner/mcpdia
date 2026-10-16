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
    ({ keys }) =>
      respond(async () => {
        const out = await softDelete(ctx, store, keys);
        const lines = [batchText('Deleted', out)];
        for (const d of out.dangling) lines.push(danglingLine(d.key, d.from));
        return lines.join('\n');
      }),
  );
}

const SHOWN = 5;

/** `task/a (part_of), task/b (references) still link to concept/x; ...` */
function danglingLine(key: string, from: string[]): string {
  const shown = from.slice(0, SHOWN).join(', ') + (from.length > SHOWN ? ` and ${from.length - SHOWN} more` : '');
  return `${shown} still link to ${key}, so those links lead nowhere now. Relink them if they need a new target.`;
}
