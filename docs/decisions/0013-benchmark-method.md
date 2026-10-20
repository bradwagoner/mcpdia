# 0013: Benchmark method

- Status: Superseded by 0023
- Date: 2026-10-12

## Context
MCPedia exists to save tokens, and the README headline and the promo video quote one number from the benchmark. That number has to be reproducible, cheap to rerun, and fair to the markdown baseline, or it is marketing rather than a measurement.

Two broad options exist. A **live agent run** gives a real model a question and the tools, and records what it spent. That is realistic but nondeterministic, costs money per run, and mixes MCPedia's cost with the model's search habits. A **scripted retrieval run** replays a fixed, non-oracle retrieval policy for each side and counts the tokens each one puts into the context window. That is deterministic and free, but only as honest as its policies.

## Decision
The headline comes from a **scripted, deterministic retrieval benchmark** over one shared demo dataset (the `plan/demo-dataset` idea): a fictional product's team knowledge, written once as structured nodes and rendered both into an MCPedia graph and into markdown memory files. The same facts exist on both sides.

**Questions.** A fixed list of questions, each with the node that answers it and a short *needle*: a phrase that must appear in what was read for the answer to count as found. Search words are derived from the question text mechanically (lowercase, drop stop words), never hand-tuned per question.

**Markdown strategies** (what an agent does today):
1. `whole-file`: all memory in one file, read in full.
2. `index-then-file`: read a short index, then the one topic file that holds the answer. The file choice is an oracle, so this is the best case for markdown.
3. `grep-then-file`: grep the search words, then read the file with the most matching lines in full. If the needle is not there, read the next file.

**Graph strategy** (MCPedia, through the real MCP server and its exact text responses):
`search` with the derived words at `summary` level, then `get` the top result at `full` level. If the needle is not there, `get` the next result, up to three. No oracle.

**What is counted.** The tokens of every tool response the strategy reads, plus the call arguments. The graph side is also charged a **fixed per-session overhead**: MCPedia's tool definitions and server instructions, plus one `orient` call. Headline figures include that overhead, so it is a fresh-session, one-question comparison, the case where markdown memory hurts most and MCPedia's overhead is least amortized. Results without the overhead are reported alongside.

**Correctness.** Each strategy reports how many needles it found. A question the graph strategy fails still counts every token it spent, and the failure is listed. A strategy that finds fewer answers cannot claim a saving on the ones it missed.

**Token counting.** Exact counts come from Anthropic's `count_tokens` endpoint (through `@anthropic-ai/sdk`, a dev dependency) for the current default model. Without credentials, the harness falls back to a character estimate (characters / 4), labels every result as an estimate, and refuses to rewrite the published results file. Only exact runs feed the README.

**Headline.** The median per-question saving of the graph strategy against `index-then-file` (the strongest markdown baseline), with the other baselines shown next to it. Median rather than mean, so one long node does not set the number.

## Alternatives considered
- **Live agent runs only:** the most realistic, but every rerun costs money and gives a different number; the headline could not be reproduced by a reader. Kept as a possible later addition to sanity-check the scripted policies, not as the headline.
- **Comparing against `whole-file` only:** gives the biggest number and is the least defensible. Teams that care already split memory into topic files.
- **An offline tokenizer (tiktoken and similar):** free and offline, but it is a different tokenizer from Claude's and would produce a number nobody can check against a Claude bill. The character estimate is labeled as rough for exactly that reason.
- **Hand-written search words per question:** would let the author tune each query to the index. Derived words keep the graph side honest.
- **A real employer's knowledge as the corpus:** more realistic, but not publishable.

## Consequences
- Anyone can rerun the benchmark with `npm run bench` and get the same number, given the same tokenizer and dataset.
- Publishing a number needs an Anthropic API key (token counting is free but authenticated).
- The dataset is shared with the README GIFs and the promo video, so changing it changes all three. The generated markdown is committed and a test keeps it in sync with the source.
- Savings depend on corpus size: markdown cost grows with the files, the graph's mostly does not. The results state the corpus size so the number is not read as universal.
- The scripted policies are a model of agent behavior, not a measurement of a specific agent. The README says so.
