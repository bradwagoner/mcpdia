import { UserError } from './core/errors.js';

/**
 * Who is calling and what they can see. Every core call takes one.
 * Solo mode uses a constant; team mode (v0.3) will build it from auth.
 */
export interface Context {
  /** Stamped on writes as author / updated_by. */
  caller: string;
  /** Namespaces visible to reads. A list from day one (ADR 0007). */
  namespaces: string[];
  /** Namespace new nodes and edges are written to. */
  writeNamespace: string;
}

/** The only place the default namespace is spelled out. */
export const DEFAULT_NAMESPACE = 'default';

export function soloContext(): Context {
  return { caller: 'local', namespaces: [DEFAULT_NAMESPACE], writeNamespace: DEFAULT_NAMESPACE };
}

/** A starter set from MCPDIA_STARTERS: the namespace it loads into and where it comes from. */
export interface Starter {
  name: string;
  source: string;
}

export interface Config {
  ctx: Context;
  starters: Starter[];
}

/** Namespace names: letters, digits, `-` and `_`. No `:` or `/`, which keys use. */
const NAMESPACE = /^[a-z0-9][a-z0-9_-]*$/i;

export function checkNamespace(name: string, setting: string): string {
  if (!NAMESPACE.test(name)) {
    throw new UserError(`${setting}: "${name}" is not a namespace name.`, 'Use letters, digits, - and _.');
  }
  return name;
}

/**
 * The solo context with the namespaces from the environment (ADR 0026):
 * MCPDIA_WRITE_NAMESPACE picks where writes go, MCPDIA_NAMESPACES adds read
 * namespaces, and MCPDIA_STARTERS (`name=source,...`) adds starter sets.
 */
export function configFromEnv(env: NodeJS.ProcessEnv): Config {
  const writeNamespace = checkNamespace(
    env.MCPDIA_WRITE_NAMESPACE?.trim() || DEFAULT_NAMESPACE,
    'MCPDIA_WRITE_NAMESPACE',
  );
  const extra = list(env.MCPDIA_NAMESPACES).map((ns) => checkNamespace(ns, 'MCPDIA_NAMESPACES'));
  const starters = list(env.MCPDIA_STARTERS).map(parseStarter);

  const names = starters.map((s) => s.name);
  const twice = names.find((name, i) => names.indexOf(name) !== i);
  if (twice) throw new UserError(`MCPDIA_STARTERS names "${twice}" twice.`, 'Give each starter set its own name.');
  if (names.includes(writeNamespace)) {
    throw new UserError(
      `Starter set "${writeNamespace}" is also the write namespace.`,
      'A reload would overwrite your work. Pick another name, or set MCPDIA_WRITE_NAMESPACE.',
    );
  }

  const ctx: Context = {
    ...soloContext(),
    namespaces: [...new Set([writeNamespace, ...extra, ...names])],
    writeNamespace,
  };
  return { ctx, starters };
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseStarter(entry: string): Starter {
  const eq = entry.indexOf('=');
  if (eq <= 0 || eq === entry.length - 1) {
    throw new UserError(`MCPDIA_STARTERS: "${entry}" is not name=source.`, 'Example: mcpdia=./starters/mcpdia.jsonl');
  }
  return { name: checkNamespace(entry.slice(0, eq).trim(), 'MCPDIA_STARTERS'), source: entry.slice(eq + 1).trim() };
}
