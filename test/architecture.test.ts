import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The layer rules from ADR 0001, checked on every test run:
 * tools stay thin, the core knows nothing about MCP or SQL, and only the
 * store layer touches the database.
 */
const SRC = resolve(import.meta.dirname, '../src');

const RULES: { layer: string; forbidden: RegExp[]; why: string }[] = [
  {
    layer: 'core',
    forbidden: [/^@modelcontextprotocol\//, /^zod$/, /^better-sqlite3$/, /\/tools\//, /\/store\/sqlite\//],
    why: 'the core knows nothing about MCP or how data is stored',
  },
  {
    layer: 'store',
    forbidden: [/^@modelcontextprotocol\//, /\/core\//, /\/tools\//],
    why: 'the store layer only stores',
  },
  {
    layer: 'tools',
    forbidden: [/^better-sqlite3$/, /\/store\/sqlite\//],
    why: 'tools reach storage through the core and the GraphStore interface',
  },
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

function imports(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  return [...source.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => {
    const spec = m[1]!;
    // Make relative imports comparable by their path from src/.
    return spec.startsWith('.') ? `/${relative(SRC, resolve(file, '..', spec)).replaceAll('\\', '/')}` : spec;
  });
}

describe('layer boundaries (ADR 0001)', () => {
  for (const rule of RULES) {
    it(`${rule.layer}: ${rule.why}`, () => {
      const violations = files(join(SRC, rule.layer)).flatMap((file) =>
        imports(file)
          .filter((spec) => rule.forbidden.some((re) => re.test(spec)))
          .map((spec) => `${relative(SRC, file)} imports ${spec}`),
      );
      expect(violations).toEqual([]);
    });
  }

  it('keeps SQL inside src/store/sqlite', () => {
    const outside = files(SRC)
      .filter((f) => !relative(SRC, f).replaceAll('\\', '/').startsWith('store/sqlite/'))
      .filter((f) => /\b(SELECT|INSERT INTO|UPDATE \w+ SET|DELETE FROM)\b/.test(readFileSync(f, 'utf8')));
    expect(outside.map((f) => relative(SRC, f))).toEqual([]);
  });
});
