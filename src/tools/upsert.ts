import { z } from 'zod';
import { displayKey } from '../core/keys.js';
import { upsert } from '../core/upsert.js';
import type { Deps } from './deps.js';
import { linkLines } from './link.js';
import { respond } from './respond.js';

export function registerUpsert({ server, store, ctx }: Deps): void {
  server.registerTool(
    'upsert',
    {
      description:
        "Create a node, or edit a node's own facts by key. Search first to avoid duplicates. Keep one thing per node; put it under its parent with links.",
      inputSchema: {
        key: z.string().optional().describe('Omit to create; a key is built from type and title.'),
        type: z.string().describe('e.g. concept, how-to, decision, note. Reuse existing types.'),
        title: z.string(),
        summary: z.string().optional().describe('One line. This is what search shows.'),
        body: z.string().optional(),
        tags: z.array(z.string()).optional(),
        aliases: z.array(z.string()).optional().describe('Other names people use for it.'),
        properties: z.record(z.string(), z.unknown()).optional(),
        version: z.number().optional().describe('Apply only if the node is still at this version.'),
        links: z
          .array(z.object({ type: z.string(), to: z.string(), note: z.string().optional() }))
          .optional()
          .describe('Edges from this node, e.g. [{type: "part_of", to: "plan/x"}]. Added, never replaced.'),
      },
    },
    (input) =>
      respond(async () => {
        const out = await upsert(ctx, store, input);
        const key = displayKey(ctx, out.node.namespace, out.node.key);
        const verb = out.created ? 'Created' : out.restored ? 'Restored' : 'Updated';
        const lines = [`${verb} ${key} (v${out.node.version}).`];
        if (out.restored) lines.push('It was deleted; fields you did not pass kept their old values.');
        if (out.typeHint) lines.push(out.typeHint);
        if (out.removedProperties) {
          lines.push(
            `Properties replaced; dropped ${out.removedProperties.join(', ')}. Pass every property you want to keep.`,
          );
        }
        for (const l of out.links) lines.push(...linkLines(l));
        if (out.parentHint) lines.push(out.parentHint);
        if (out.summaryHint) lines.push(out.summaryHint);
        return lines.join('\n');
      }),
  );
}
