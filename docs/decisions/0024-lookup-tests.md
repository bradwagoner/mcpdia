# 0024: Lookup tests without a model

- Status: Proposed
- Date: 2026-10-22
- Builds on: ADR 0023 (the headline comes from live sessions)

## Context
The live sessions (ADR 0023) show that MCPdia gets tasks right at a low cost, but each run costs money and covers 10 tasks. They can't tell us, cheaply and on every change, whether search still finds the right node, what each render level costs, whether an old fact can pass as current, or how lookups hold up as a graph grows.

## Decision
**A set of lookup checks that call the real server in memory, with no model**, in `bench/lookups.ts`:

- **Retrieval.** The 40 Kestrel questions, the same 40 reworded (`bench/dataset/paraphrases.ts`), and 10 questions the dataset can't answer. Search words come from the question mechanically, as in the scripted benchmark. Scores are hit@1, hit@3 and MRR. A question with no answer passes when search says no node matched every word.
- **Render levels.** Tokens returned by a five-result search, and by a get of the answer, at `title`, `summary`, `snippet` and `full`.
- **Stale facts.** On a seeded graph, supersede 5 facts, delete 3 and flag 3 as wrong. Then check every read: the old node is left out of search or marked, `get` says superseded or deleted at every level, and the replacement ranks no lower than the old node did.
- **Cost as memory grows.** The dataset plus generated filler at 82 to 1,600 nodes, kept both as a graph and as markdown, with the scripted strategies from `npm run bench`: median tokens read to answer one question, per strategy. `npm run bench:growth` writes `bench/growth.md` and `bench/growth.json`.
- **Scaling.** The dataset hidden among 1,000 to 100,000 generated nodes, with latency, database size and retrieval at each size. Generated text samples real words at their natural frequency, with no facts. Two kinds: **other topics** (this repo's docs), and **same topic** (the dataset's own words) as a worst case.

`test/bench/lookups.test.ts` runs the fast part on every `npm test`, with floors set to today's scores. `npm run bench:lookups` runs everything, including the 100k graph, and writes `bench/lookups.md` and `bench/lookups.json`.

The reworded questions were written once and are not tuned to make search pass. A floor goes up when search gets better; a drop is a regression to look at, not a number to lower.

## Alternatives considered
- **More live sessions only:** real, but cents per run and too slow for every change.
- **Distractors from random words:** they share nothing with the questions, so they test nothing. Sampling at natural frequency keeps common words common and rare words rare.
- **Embedding-based paraphrase generation:** adds a model and a dependency for 40 sentences.

## Consequences
- Search changes now show their effect on retrieval in the test run.
- The same-topic case shows where keyword search runs out: with thousands of look-alike nodes, the answer drops out of the top 3 more often, most of all for reworded questions. The numbers give future work, such as aliases or ranking changes, something to measure against.
- Latency depends on the machine; `bench/lookups.md` records the platform it ran on.
