import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A promptfoo provider that runs one Claude session per test, through the
 * Claude Agent SDK, against a fresh copy of one side's memory:
 * `side: mcpedia` gets the MCPedia server and its database, `side: markdown`
 * gets CLAUDE.md plus topic files in its working folder, and
 * `side: markdown-onefile` gets the same facts as one CLAUDE.md.
 *
 * Paid sessions use the API key in bench.env, never a Claude login. Spending
 * stops at the run cap set by run.mjs. Everything a session produces is kept
 * under results/ (see the README). With MCPEDIA_BENCH_DRY=1 no model is
 * called: the session is replaced by a canned answer, to check the wiring.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../..');
const FIXTURES = join(HERE, 'fixtures');
const RESULTS = join(HERE, 'results');
const SERVER = join(ROOT, 'dist/index.js');
// Windows' Notepad tends to save bench.env as bench.env.txt, so either name works.
const KEY_FILE =
  process.env.MCPEDIA_BENCH_ENV_FILE ??
  ['bench.env', 'bench.env.txt'].map((f) => join(homedir(), '.mcpdia-secrets', f)).find((f) => existsSync(f)) ??
  join(homedir(), '.mcpdia-secrets', 'bench.env');

const DRY = process.env.MCPEDIA_BENCH_DRY === '1';
const RUN_CAP = Number(process.env.MCPEDIA_BENCH_CAP_USD ?? 0);
const RUN_ID = process.env.MCPEDIA_BENCH_RUN ?? 'adhoc';

const SIDES = ['mcpedia', 'markdown', 'markdown-onefile'];

// Shared by all providers in one promptfoo run, which is one process.
let spent = 0;
let sessionNumber = 0;

export default class SessionProvider {
  constructor(options = {}) {
    this.config = { model: 'claude-haiku-5-5', maxTurns: 12, sessionCapUsd: 0.05, ...options.config };
    this.side = this.config.side;
    if (!SIDES.includes(this.side)) throw new Error(`config.side must be one of ${SIDES.join(', ')}`);
    this.label = options.label ?? this.side;
  }

  id() {
    return `session:${this.side}`;
  }

  async callApi(prompt, context) {
    const vars = context?.vars ?? {};
    const n = ++sessionNumber;
    const work = mkdtempSync(join(tmpdir(), `mcpedia-bench-${this.side}-`));
    try {
      const dbPath = join(work, 'mcpedia.db');
      if (this.side === 'mcpedia') copyFileSync(join(FIXTURES, 'mcpedia.db'), dbPath);
      else cpSync(join(FIXTURES, this.side), work, { recursive: true });

      const session = DRY ? dryRun(vars) : await this.run(prompt, work, dbPath);
      if (session.error) return { error: session.error };

      let output = session.answer;
      if (vars.kind === 'write') {
        const landed = this.side === 'mcpedia' ? graphHas(dbPath, vars.needle) : markdownHas(work, vars.needle);
        output += `\n[write check: ${landed ? 'landed' : 'missing'}]`;
      }

      const record = { run: RUN_ID, n, side: this.side, kind: vars.kind, prompt, dry: DRY, ...session.stats };
      mkdirSync(join(RESULTS, 'transcripts'), { recursive: true });
      writeFileSync(
        join(RESULTS, 'transcripts', `${RUN_ID}-${String(n).padStart(3, '0')}-${this.side}.json`),
        JSON.stringify({ ...record, answer: output, messages: session.messages }, null, 2),
      );
      keep(work, `${RUN_ID}-${String(n).padStart(3, '0')}-${this.side}`, this.side, vars.kind, dbPath);
      if (!DRY)
        appendFileSync(
          join(RESULTS, 'sessions.jsonl'),
          JSON.stringify({ at: new Date().toISOString(), ...record, answer: output }) + '\n',
        );

      return {
        output,
        cost: session.stats.costUsd,
        tokenUsage: {
          prompt: session.stats.inputTokens,
          completion: session.stats.outputTokens,
          cached: session.stats.cacheReadTokens,
          total: session.stats.inputTokens + session.stats.outputTokens,
        },
        metadata: record,
      };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  async run(prompt, work, dbPath) {
    const remaining = RUN_CAP - spent;
    if (remaining <= 0) return { error: `Run cap of $${RUN_CAP} reached; session skipped.` };
    const apiKey = readKey();
    if (!apiKey) return { error: `No ANTHROPIC_API_KEY in ${KEY_FILE}; refusing to run on a Claude login.` };

    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const env = { ...process.env, ANTHROPIC_API_KEY: apiKey };
    for (const name of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ENABLE_TOOL_SEARCH'])
      delete env[name];

    const mcpedia = this.side === 'mcpedia';
    const messages = [];
    let result;
    for await (const message of query({
      prompt,
      options: {
        cwd: work,
        model: this.config.model,
        maxTurns: this.config.maxTurns,
        maxBudgetUsd: Math.min(this.config.sessionCapUsd, remaining),
        // Isolation: no personal settings, no other MCP servers. The markdown sides load only their CLAUDE.md.
        settingSources: mcpedia ? [] : ['project'],
        strictMcpConfig: true,
        mcpServers: mcpedia
          ? {
              mcpedia: {
                type: 'stdio',
                command: process.execPath,
                args: [SERVER],
                env: { MCPEDIA_DB: dbPath, MCPEDIA_METRICS: '1' },
              },
            }
          : {},
        permissionMode: 'dontAsk',
        allowedTools: ['Read', 'Grep', 'Glob', 'Edit', ...(mcpedia ? ['mcp__mcpedia__*'] : [])],
        // allowedTools only pre-approves; these are blocked outright so read-only shell commands can't slip through.
        disallowedTools: ['Bash', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'],
        env,
      },
    })) {
      messages.push(message);
      if (message.type === 'result') result = message;
    }
    if (!result) return { error: 'Session ended without a result message.' };

    const usage = Object.values(result.modelUsage ?? {});
    const total = (field) => usage.reduce((sum, u) => sum + (u[field] ?? 0), 0);
    const stats = {
      subtype: result.subtype,
      costUsd: result.total_cost_usd ?? 0,
      inputTokens: total('inputTokens') + total('cacheCreationInputTokens') + total('cacheReadInputTokens'),
      uncachedInputTokens: total('inputTokens'),
      cacheWriteTokens: total('cacheCreationInputTokens'),
      cacheReadTokens: total('cacheReadInputTokens'),
      outputTokens: total('outputTokens'),
      turns: result.num_turns,
      toolCalls: toolCalls(messages),
      models: Object.keys(result.modelUsage ?? {}),
    };
    spent += stats.costUsd;
    const answer = result.subtype === 'success' ? result.result : `[session stopped: ${result.subtype}]`;
    return { answer, stats, messages };
  }
}

/**
 * Copies what a session leaves behind before its folder is deleted: MCPedia's
 * per-call log, and for writes the memory as it ended (markdown files, or the
 * graph as an export).
 */
function keep(work, name, side, kind, dbPath) {
  const metrics = join(work, 'mcpedia-metrics.jsonl');
  if (existsSync(metrics)) {
    mkdirSync(join(RESULTS, 'metrics'), { recursive: true });
    copyFileSync(metrics, join(RESULTS, 'metrics', `${name}.jsonl`));
  }
  if (kind !== 'write') return;
  const dir = join(RESULTS, 'end-state', name);
  mkdirSync(dir, { recursive: true });
  if (side !== 'mcpedia') {
    for (const f of readdirSync(work).filter((f) => f.endsWith('.md'))) copyFileSync(join(work, f), join(dir, f));
  } else {
    writeFileSync(join(dir, 'graph.jsonl'), exportGraph(dbPath));
  }
}

function dryRun(vars) {
  const answer = vars.kind === 'write' ? 'Recorded.' : `Dry run: ${vars.needle}`;
  const stats = {
    subtype: 'dry-run',
    costUsd: 0,
    inputTokens: 0,
    uncachedInputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    turns: 0,
    toolCalls: {},
    models: [],
  };
  return { answer, stats, messages: [] };
}

function readKey() {
  if (!existsSync(KEY_FILE)) return null;
  const line = readFileSync(KEY_FILE, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith('ANTHROPIC_API_KEY='));
  return line
    ? line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^["']|["']$/g, '') || null
    : null;
}

/** Tool calls by name, counted from the assistant messages. */
function toolCalls(messages) {
  const counts = {};
  for (const m of messages) {
    if (m.type !== 'assistant') continue;
    for (const block of m.message?.content ?? []) {
      if (block.type === 'tool_use') counts[block.name] = (counts[block.name] ?? 0) + 1;
    }
  }
  return counts;
}

function markdownHas(dir, needle) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .some((f) => readFileSync(join(dir, f), 'utf8').toLowerCase().includes(needle.toLowerCase()));
}

/** Reads the session's database back through MCPedia's own export. */
function graphHas(dbPath, needle) {
  return exportGraph(dbPath).toLowerCase().includes(needle.toLowerCase());
}

function exportGraph(dbPath) {
  return execFileSync(process.execPath, [SERVER, 'export'], {
    env: { ...process.env, MCPEDIA_DB: dbPath },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}
