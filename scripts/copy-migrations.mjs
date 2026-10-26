// tsc only emits .js, so copy the numbered SQL files next to the compiled stores.
// Takes the compiled src root as an argument (default dist; the benchmark uses dist-bench/src).
import { cpSync } from 'node:fs';

const root = process.argv[2] ?? 'dist';
for (const store of ['sqlite', 'postgres']) {
  cpSync(`src/store/${store}/migrations`, `${root}/store/${store}/migrations`, { recursive: true });
}
