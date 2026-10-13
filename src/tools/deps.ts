import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Context } from '../context.js';
import type { GraphStore } from '../store/GraphStore.js';

/** What every tool registration needs. */
export interface Deps {
  server: McpServer;
  store: GraphStore;
  ctx: Context;
}
