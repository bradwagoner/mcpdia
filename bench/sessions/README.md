# Side-by-side sessions

Real Claude sessions answer the same questions and record the same facts twice: once with MCPedia, once with markdown memory files (a `CLAUDE.md` index that loads at session start, plus topic files read on demand). Both sides start from the Kestrel dataset in `../dataset`, and every session gets a fresh copy, so one session's writes never reach the next.

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

`results/` is gitignored because transcripts carry local paths; back it up or copy it somewhere safe before deleting the folder. The model is Claude Haiku 5.5, and MCPedia's tools load on demand, as they do in Claude Code.
