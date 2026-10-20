# 0023: The headline comes from live sessions

- Status: Accepted
- Date: 2026-10-20
- Supersedes: 0013

## Context
ADR 0013 proposed a headline from a scripted, deterministic retrieval benchmark: fixed policies replay `search` then `get` against an oracle choice of markdown file, and count the tokens each side reads. It was never accepted. Its numbers depend on how well the policies model an agent, and the first results charged MCPdia every tool definition in a one-question session, which is not how Claude Code loads tools: MCP tools load on demand.

Since then, `bench/sessions` runs real Claude sessions with promptfoo and the Agent SDK. Each session gets a task (answer a question or record a fact) and a fresh copy of the same facts, kept either in MCPdia or in markdown memory files. Pass or fail, cost and tokens come from the session itself.

## Decision
The README headline comes from **live sessions** (`bench/sessions`), not from the scripted benchmark.

- **Sides:** MCPdia; a `CLAUDE.md` index with topic files read on demand; and one `CLAUDE.md` holding everything.
- **What is compared:** tasks passed, and cost per session in dollars, as reported by the API. Cost already weighs cached and uncached tokens the way a bill does, so it is the fairest single number.
- **What the README states:** the model, the number of tasks and repeats, and the dataset size, next to the result, with a link to the per-session CSV (`bench/sessions/data/sessions.csv`).
- **Headline:** the comparison with the one-file side, since that is the memory most people start with; the split-file side is shown in the same table.
- **Paid runs** have a cost cap and run only when started on purpose.

The scripted benchmark (`npm run bench`) stays as a free, deterministic check of retrieval cost per question. Its results are not the headline.

## Alternatives considered
- **Accept ADR 0013 as written:** free and reproducible, but it measures a model of an agent, and its one-question, everything-loaded setup is the case least like real use.
- **Headline against split files only:** the strongest markdown baseline, but it assumes someone maintains an index and topic files by hand; the table shows it anyway.

## Consequences
- Rerunning the headline costs money (cents per run) and needs an Anthropic API key.
- Live results vary between runs; more repeats and multi-question sessions would tighten them and are the next step for the benchmark.
