// tsc only emits .js, so copy the numbered SQL files next to the compiled store.
// Takes the compiled src root as an argument (default dist; the benchmark uses dist-bench/src).
import { cpSync } from 'node:fs';

const root = process.argv[2] ?? 'dist';
cpSync('src/store/sqlite/migrations', `${root}/store/sqlite/migrations`, { recursive: true });
