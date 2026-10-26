import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { UserError } from './core/errors.js';

export interface HttpOptions {
  host: string;
  port: number;
  /** Host names requests may be addressed to, besides localhost. */
  allowedHosts: string[];
  /**
   * Serves GET /export when set: the graph as mcpdia-jsonl, so another MCPdia can
   * load it as a starter set (ADR 0026). Takes the query string (namespace, tag).
   */
  exportGraph?: (query: URLSearchParams, write: (line: string) => Promise<void>) => Promise<unknown>;
}

const LOCALHOST = ['localhost', '127.0.0.1', '[::1]'];

/**
 * MCP over Streamable HTTP at /mcp (ADR 0025). Stateless: each request gets a
 * fresh MCP server from `makeServer`, so any number of clients can connect.
 * GET /health answers "ok" for container health checks, and GET /export streams
 * the graph when the caller passes an exporter.
 *
 * Only requests addressed to localhost (or an allowed host name) are served,
 * so a web page can't reach the server through DNS rebinding.
 */
export async function serveHttp(makeServer: () => McpServer, options: HttpOptions): Promise<Server> {
  const allowed = new Set([...LOCALHOST, ...options.allowedHosts.map((h) => h.toLowerCase())]);
  const http = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) reply(res, 500, 'Internal server error');
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!allowed.has(hostname(req.headers.host))) {
      return reply(
        res,
        403,
        `Host not allowed: ${req.headers.host ?? '(none)'}. Set MCPDIA_HTTP_ALLOWED_HOSTS to add it.`,
      );
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/health' && req.method === 'GET') return reply(res, 200, 'ok');
    if (path === '/export' && req.method === 'GET' && options.exportGraph) {
      return exportGraph(options.exportGraph, new URL(req.url ?? '/', 'http://localhost').searchParams, res);
    }
    if (path !== '/mcp') return reply(res, 404, 'Not found. MCP is served at /mcp.');
    if (req.method !== 'POST') return reply(res, 405, 'Method not allowed. This server is stateless: POST only.');

    const server = makeServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, options.host, () => resolve());
  });
  return http;
}

/** Streams the export. A problem the caller can fix, found before the first line, is a 400. */
async function exportGraph(
  run: NonNullable<HttpOptions['exportGraph']>,
  query: URLSearchParams,
  res: ServerResponse,
): Promise<void> {
  const write = async (line: string) => {
    if (!res.headersSent) res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8' });
    if (!res.write(line + '\n')) await new Promise((done) => res.once('drain', done));
  };
  try {
    await run(query, write);
    res.end();
  } catch (err) {
    if (!(err instanceof UserError) || res.headersSent) throw err;
    reply(res, 400, [err.message, err.hint].filter(Boolean).join(' '));
  }
}

/** The Host header without its port, lowercased. IPv6 keeps its brackets. */
function hostname(header: string | undefined): string {
  if (!header) return '';
  const h = header.toLowerCase();
  return h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':')[0]!;
}

function reply(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' }).end(text + '\n');
}
