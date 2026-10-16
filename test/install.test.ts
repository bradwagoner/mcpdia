import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The README promises an install with no build tools (ADR 0010). That holds
 * while better-sqlite3 ships its binaries in the package and runs nothing at
 * install time. These checks fail if an upgrade brings node-gyp back.
 */
const pkgPath = createRequire(import.meta.url).resolve('better-sqlite3/package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { gypfile?: boolean; scripts?: Record<string, string> };

describe('better-sqlite3 installs without build tools', () => {
  it('has no install-time script', () => {
    expect(pkg.gypfile).toBe(false);
    for (const hook of ['preinstall', 'install', 'postinstall']) expect(pkg.scripts?.[hook]).toBeUndefined();
  });

  it('ships a prebuilt binary for this platform', () => {
    // Linux has separate glibc (linux-*) and musl (linuxmusl-*) builds; musl has no glibc version.
    const { header } = process.report.getReport() as { header: { glibcVersionRuntime?: string } };
    const platform = process.platform === 'linux' && !header.glibcVersionRuntime ? 'linuxmusl' : process.platform;
    expect(existsSync(join(dirname(pkgPath), 'prebuilds', `${platform}-${process.arch}.node`))).toBe(true);
  });
});
