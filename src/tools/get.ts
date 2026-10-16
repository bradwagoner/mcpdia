import { z } from 'zod';
import { get, type GetItem, type NeighborView } from '../core/get.js';
import { RENDER_LEVELS, renderStub, type RenderLevel } from '../core/render.js';
import type { Context } from '../context.js';
import type { Deps } from './deps.js';
import { respond } from './respond.js';

export function registerGet({ server, store, ctx }: Deps): void {
  server.registerTool(
    'get',
    {
      description: 'Fetch one or more nodes by key. Optionally include directly linked nodes as titles.',
      inputSchema: {
        keys: z.array(z.string()).min(1).describe('Node keys, e.g. ["concept/permissions"].'),
        level: z.enum(RENDER_LEVELS).default('full'),
        neighbors: z.boolean().default(false).describe('Add nodes one link away.'),
        neighbor_level: z.enum(RENDER_LEVELS).default('title'),
      },
    },
    (input) =>
      respond(async () => {
        const items = await get(ctx, store, { keys: input.keys, neighbors: input.neighbors });
        return items.map((item) => renderItem(ctx, item, input.level, input.neighbor_level)).join('\n\n---\n\n');
      }),
  );
}

function renderItem(ctx: Context, item: GetItem, level: RenderLevel, neighborLevel: RenderLevel): string {
  if (!item.node) {
    const what = item.deleted ? `${item.ref} was deleted.` : `Not found: ${item.ref}.`;
    return `${what}${item.suggestion ? ` Did you mean ${item.suggestion}?` : ''}`;
  }
  const lines = [renderStub(ctx, item.node, level, { supersededByKey: item.supersededByKey })];
  if (item.neighbors?.length) {
    lines.push('', 'Links:', ...renderNeighbors(ctx, item.neighbors, neighborLevel));
    if (item.moreNeighbors) lines.push(`+${item.moreNeighbors} more`);
  }
  return lines.join('\n');
}

/**
 * Grouped by direction and edge type. At title level a group fits on one line:
 * `→ depends_on: concept/roles Roles; concept/groups Groups`.
 */
function renderNeighbors(ctx: Context, neighbors: NeighborView[], level: RenderLevel): string[] {
  const groups = new Map<string, NeighborView[]>();
  for (const n of neighbors) {
    const label = `${n.direction === 'out' ? '→' : '←'} ${n.type}`;
    groups.set(label, [...(groups.get(label) ?? []), n]);
  }
  const lines: string[] = [];
  for (const [label, group] of groups) {
    if (level === 'title') {
      const entries = group.map((n) => (n.node ? `${n.key} ${n.node.title}` : `${n.key} (missing)`));
      lines.push(`${label}: ${entries.join('; ')}`);
    } else {
      lines.push(`${label}:`);
      for (const n of group) {
        lines.push(n.node ? `- ${renderStub(ctx, n.node, level)}` : `- ${n.key} (missing)`);
      }
    }
  }
  return lines;
}
