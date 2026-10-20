# Side-by-side sessions

Real Claude sessions answer the same questions and record the same facts twice: once with MCPedia, once with markdown memory files (a `CLAUDE.md` index that loads at session start, plus topic files read on demand). Both sides start from the Kestrel dataset in `../dataset`, and every session gets a fresh copy, so one session's writes never reach the next.

A third side, `markdown-onefile`, puts the same facts in a single `CLAUDE.md` that loads whole at session start. `node run.mjs onefile` runs the step 6 tests on it alone, to set beside a step 6 run.

## Run it

```bash
# from the repo root
npm run build
npm run bench:build

# from bench/sessions
npm install
npm run setup     # builds fixtures/ from the dataset, no model calls
npm run check     # dry run: wiring, copies and checks, no model calls
node run.mjs step3          # prints what it would run and its cost cap
node run.mjs step3 --yes    # runs it
```

Paid steps read `ANTHROPIC_API_KEY` from `~/.mcpdia-secrets/bench.env` (or `bench.env.txt`) (set `MCPEDIA_BENCH_ENV_FILE` to use another file) and never fall back to a Claude login. Each step has a hard spending cap; the run stops starting sessions once it is reached.

Everything a run produces is kept in `results/`, which is never cleaned up:

- `sessions.jsonl`: one line per paid session (answer, input, cached and output tokens, cost, turns, tool calls by name, model), appended across runs.
- `transcripts/`: every message of every session.
- `metrics/`: MCPedia's own per-call log for each MCPedia session (`MCPEDIA_METRICS=1`).
- `end-state/`: for write sessions, the memory as the session left it.
- `<run>.json`: promptfoo's report for the run, with pass or fail per test.

`npm run export` turns those into `data/sessions.csv`: one row per paid session with its pass or fail, cost, tokens, turns and tool calls. It holds no answers or paths, so unlike `results/` it is committed; rerun it after a run to refresh it.

`results/` is gitignored because transcripts carry local paths; back it up or copy it somewhere safe before deleting the folder. The model is Claude Haiku 5.5, and MCPedia's tools load on demand, as they do in Claude Code.
