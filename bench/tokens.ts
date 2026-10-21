import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface TokenCounter {
  /** Shown in results, e.g. "claude-opus-5-5 count_tokens" or "estimate (chars / 4)". */
  name: string;
  /** False for the character estimate; only exact counts may be published (ADR 0013). */
  exact: boolean;
  count(text: string): Promise<number>;
  /** Persists anything worth keeping between runs. */
  flush(): void;
}

/** Rough and offline: about four characters per token for English prose. */
export function estimateCounter(): TokenCounter {
  return {
    name: 'estimate (characters / 4)',
    exact: false,
    count: async (text) => Math.ceil(text.length / 4),
    flush() {},
  };
}

/**
 * Exact counts from Anthropic's count_tokens endpoint. Each text is sent as
 * one user message; the fixed message overhead is measured once and
 * subtracted. Results are cached on disk by model and text hash, so reruns
 * only count what changed.
 */
export async function anthropicCounter(model: string, cachePath: string): Promise<TokenCounter> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const cache: Record<string, number> = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};

  async function raw(text: string): Promise<number> {
    const id = createHash('sha256').update(model).update('\0').update(text).digest('hex');
    const hit = cache[id];
    if (hit !== undefined) return hit;
    const result = await client.messages.countTokens({ model, messages: [{ role: 'user', content: text }] });
    cache[id] = result.input_tokens;
    return result.input_tokens;
  }

  // A one-character message is the envelope plus one token.
  const overhead = (await raw('.')) - 1;
  return {
    name: `${model} count_tokens`,
    exact: true,
    count: async (text) => (text ? Math.max(0, (await raw(text)) - overhead) : 0),
    flush: () => writeFileSync(cachePath, JSON.stringify(cache)),
  };
}

/** Exact when Anthropic credentials are available, otherwise the estimate. */
export async function pickCounter(model: string, cachePath: string): Promise<TokenCounter> {
  if (process.env.MCPDIA_BENCH_ESTIMATE === '1') return estimateCounter();
  try {
    const counter = await anthropicCounter(model, cachePath);
    return counter;
  } catch (err) {
    console.error(`Exact token counting unavailable (${(err as Error).message.split('\n')[0]}); using the estimate.`);
    return estimateCounter();
  }
}
