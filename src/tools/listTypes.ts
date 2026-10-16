import { listTypes } from '../core/types.js';
import type { TypeCount } from '../store/GraphStore.js';
import type { Deps } from './deps.js';
import { respond } from './respond.js';

export function registerListTypes({ server, store, ctx }: Deps): void {
  server.registerTool(
    'list_types',
    {
      description: 'Node and edge types in use, with counts. Check before inventing a new type.',
      inputSchema: {},
    },
    () =>
      respond(async () => {
        const out = await listTypes(ctx, store);
        const lines = [`Node types: ${counts(out.nodeTypes)}`, `Edge types: ${counts(out.edgeTypes)}`];
        const unused = [...out.unusedNodeStarters, ...out.unusedEdgeStarters];
        if (unused.length) lines.push(`Also available: ${unused.join(', ')}`);
        if (out.lookalikes.length) {
          const shown = out.lookalikes.map(([a, b]) => `${a} and ${b}`).join('; ');
          lines.push(`Look alike: ${shown}. Pick one and reuse it.`);
        }
        return lines.join('\n');
      }),
  );
}

/** `concept 12, how-to 4` */
function counts(types: TypeCount[]): string {
  return types.length ? types.map((t) => `${t.name} ${t.count}`).join(', ') : 'none yet';
}
