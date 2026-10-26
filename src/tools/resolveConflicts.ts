import { CONFLICT_TYPE } from '../core/starters.js';
import type { Deps } from './deps.js';

/** Short on purpose: it lands in the conversation when the user picks it. */
const TEXT = `Resolve starter-set conflicts in MCPdia. A conflict node means a starter set changed a node after it was edited here.
1. search "${CONFLICT_TYPE}" with type "${CONFLICT_TYPE}" (limit 50) to list them; a node with one open shows "newer version in ..." in get and search too.
2. For each, get it with neighbors: its body holds the starter set's version, and its conflicts_with link points at the edited node. get that node too.
3. Decide with the user, briefly: merge the two into the edited node (upsert), take the starter version (upsert it over the edited node), or keep the edited node as it is.
4. delete the conflict node. That marks this version as handled; a later change in the starter set opens it again.`;

/** The first packaged prompt (ADR 0026): a guided pass over open starter-set conflicts. */
export function registerResolveConflicts({ server }: Deps): void {
  server.registerPrompt(
    'resolve-conflicts',
    { description: 'Walk through starter-set conflicts and resolve each one.' },
    () => ({ messages: [{ role: 'user', content: { type: 'text', text: TEXT } }] }),
  );
}
