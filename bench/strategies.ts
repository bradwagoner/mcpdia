import type { Question } from './dataset/index.js';
import type { GraphSession } from './graph.js';
import type { TokenCounter } from './tokens.js';

/** What one strategy spent on one question. */
export interface Outcome {
  tokens: number;
  found: boolean;
  /** Tool calls or file reads made. */
  steps: number;
}

/** Tries up to this many candidates (search results or files) before giving up. */
export const MAX_TRIES = 3;

const STOP_WORDS = new Set(
  (
    'a an and are as at be by can do does did for from has have how i in is it its many much of on or ' +
    'the their there to was we were what when where which who why will with long often any after up'
  ).split(' '),
);

/** Search words derived mechanically from the question, never tuned by hand (ADR 0013). */
export function searchWords(question: string): string[] {
  return question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !STOP_WORDS.has(w));
}

function contains(text: string, needle: string): boolean {
  return text.toLowerCase().includes(needle.toLowerCase());
}

/** MCPdia: search at summary level, then get the top results in order until the needle shows up. */
export async function graph(session: GraphSession, counter: TokenCounter, q: Question): Promise<Outcome> {
  let tokens = 0;
  let steps = 0;
  const run = async (name: string, args: Record<string, unknown>) => {
    const text = await session.call(name, args);
    tokens += (await counter.count(JSON.stringify(args))) + (await counter.count(text));
    steps++;
    return text;
  };

  const results = await run('search', { query: searchWords(q.question).join(' '), level: 'summary', limit: 5 });
  const keys = [...results.matchAll(/^- (\S+) \[/gm)].map((m) => m[1]!);
  for (const key of keys.slice(0, MAX_TRIES)) {
    if (contains(await run('get', { keys: [key] }), q.needle)) return { tokens, found: true, steps };
  }
  return { tokens, found: false, steps };
}

/** The fixed cost of having MCPdia in a session: tool definitions, server instructions and one orient call. */
export async function graphOverhead(session: GraphSession, counter: TokenCounter): Promise<number> {
  const { tools } = await session.client.listTools();
  const definitions = JSON.stringify(
    tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
  );
  const instructions = session.client.getInstructions() ?? '';
  const orient = await session.call('orient', {});
  return (await counter.count(definitions)) + (await counter.count(instructions)) + (await counter.count(orient));
}

/** Markdown memory as files keyed by name, plus which topic file holds each node. */
export interface MarkdownMemory {
  files: Map<string, string>;
  whole: string;
  fileOf: (key: string) => string;
}

/** All memory in one file, read in full. */
export async function wholeFile(md: MarkdownMemory, counter: TokenCounter, q: Question): Promise<Outcome> {
  return { tokens: await counter.count(md.whole), found: contains(md.whole, q.needle), steps: 1 };
}

/** Read the index, then the right topic file. The file choice is an oracle: markdown's best case. */
export async function indexThenFile(md: MarkdownMemory, counter: TokenCounter, q: Question): Promise<Outcome> {
  const index = md.files.get('MEMORY.md')!;
  const file = md.files.get(md.fileOf(q.answer))!;
  return {
    tokens: (await counter.count(index)) + (await counter.count(file)),
    found: contains(file, q.needle),
    steps: 2,
  };
}

/** Grep the search words, then read the files with the most matching lines in full until the needle shows up. */
export async function grepThenFile(md: MarkdownMemory, counter: TokenCounter, q: Question): Promise<Outcome> {
  const words = searchWords(q.question);
  const pattern = words.join('|');
  const ranked = [...md.files]
    .filter(([name]) => name !== 'MEMORY.md')
    .map(([name, text]) => ({
      name,
      text,
      hits: text.split('\n').filter((line) => words.some((w) => line.toLowerCase().includes(w))).length,
    }))
    .filter((f) => f.hits > 0)
    .sort((a, b) => b.hits - a.hits);

  const listing = `Found ${ranked.length} files\n${ranked.map((f) => f.name).join('\n')}`;
  let tokens = (await counter.count(JSON.stringify({ pattern, '-i': true }))) + (await counter.count(listing));
  let steps = 1;
  for (const file of ranked.slice(0, MAX_TRIES)) {
    tokens += await counter.count(file.text);
    steps++;
    if (contains(file.text, q.needle)) return { tokens, found: true, steps };
  }
  return { tokens, found: false, steps };
}
