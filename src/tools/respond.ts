import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { UserError } from '../core/errors.js';

export function text(body: string): CallToolResult {
  return { content: [{ type: 'text', text: body }] };
}

/** `Verified concept/a, concept/b.` plus a line each for keys not found, superseded or already deleted. */
export function batchText(
  verb: string,
  out: { done: string[]; notFound: string[]; superseded?: string[]; deleted?: string[] },
): string {
  const lines: string[] = [];
  if (out.done.length) lines.push(`${verb} ${out.done.join(', ')}.`);
  if (out.notFound.length) lines.push(`Not found: ${out.notFound.join(', ')}.`);
  if (out.superseded?.length) lines.push(`Superseded, use the replacement: ${out.superseded.join(', ')}.`);
  if (out.deleted?.length) lines.push(`Already deleted: ${out.deleted.join(', ')}.`);
  return lines.join('\n');
}

/**
 * Runs a tool body. A UserError becomes one line (plus its hint) with MCP's
 * error flag set; anything else is a bug and is rethrown for the SDK to report.
 */
export async function respond(run: () => Promise<string>): Promise<CallToolResult> {
  try {
    return text(await run());
  } catch (err) {
    if (err instanceof UserError) {
      return {
        content: [{ type: 'text', text: err.hint ? `${err.message} ${err.hint}` : err.message }],
        isError: true,
      };
    }
    throw err;
  }
}
