import { z } from 'zod';
import { displayKey } from '../core/keys.js';
import { upsert } from '../core/upsert.js';
import type { Deps } from './deps.js';
import { respond } from './respond.js';

export function registerUpsert({ server, store, ctx }: Deps): void {
  server.registerTool(
    'upsert',
    {
      description:
        "Create a node, or edit a node's own facts by key. Search first to avoid duplicates. Keep one thing per node and link related ones.",
      inputSchema: {
        key: z.string().optional().describe('Omit to create; a key is built from type and title.'),
        type: z.string().describe('e.g. concept, how-to, decision, note. Reuse existing types.'),
        title: z.string(),
        summary: z.string().optional().describe('One line. This is what search shows.'),
        body: z.string().optional(),
        tags: z.array(z.string()).optional(),
        aliases: z.array(z.string()).optional().describe('Other names people use for it.'),
        properties: z.record(z.string(), z.unknown()).optional(),
        version: z.number().int().optional().describe('Apply only if the node is still at this version.'),
      },
    },
    (input) =>
      respond(async () => {
        const out = await upsert(ctx, store, input);
        const key = displayKey(ctx, out.node.namespace, out.node.key);
        const lines = [`${out.created ? 'Created' : 'Updated'} ${key} (v${out.node.version}).`];
        if (out.typeHint) lines.push(out.typeHint);
        return lines.join('\n');
      }),
  );
}
