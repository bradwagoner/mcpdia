# 0005: Usefulness feedback as a separate tool

- Status: Accepted
- Date: 2026-10-06

## Context
We want a quality signal on nodes. Read counts mostly measure curiosity and would turn every read into a database write. What matters is whether a node actually helped, and whether it turned out to be wrong.

## Decision
- A dedicated **`feedback(ids, verdict)`** tool with verdicts `useful`, `not_useful`, and `outdated_or_wrong`.
- Stored as **simple counters and a last-useful timestamp** on the node, not an event log.
- Used as a **small ranking boost** in search, a filter for `recent`, a source of cleanup candidates (never useful, repeatedly flagged), and a suggestion source for pinning.
- `outdated_or_wrong` turns every LLM that uses the graph into a staleness detector.
- Kept separate from other tools so their signatures stay clean. To compensate for being easy to forget, it is nudged in three places: `orient`'s workflow line, the tool's own description, and (only if compliance proves poor) a reminder in write responses.

## Alternatives considered
- **Optional parameter on search/write** (e.g. `useful_ids`): more likely to be used, but muddies those tools.
- **Read counts:** noisy and costly.

## Consequences
- The signal is soft. LLMs will sometimes forget, and there is a mild popularity bias (surfaced nodes get more chances to be marked useful), so the ranking boost stays small.
- Feeds directly into the cleanup tooling described in 0002.
