# 0021: Search tops up short results with partial matches

- Status: Accepted
- Date: 2026-10-19
- Builds on: ADR 0016 (partial matches are labelled)

## Context
`search` falls back to any-word matches only when no node matches every word. In bench step 6 that hid the answer twice. "EU workspaces AWS region" matched one node in full, a decision about receipt OCR that happens to mention AWS, the workspace region and EU residency. The node that answers the question never says "AWS", so it was left out, although any-word search ranks it third. "API availability SLO" did the same: the alerts node has all three words, while the SLO node says "Service level objectives". In both cases the model read the one full hit and reported the fact as missing.

## Decision
**When fewer nodes match every word than the limit, the remaining places go to any-word matches.**
- Full matches come first, in their own ranking. Partial matches follow, ranked by relevance, each labelled with the words it matched, as in ADR 0016.
- The result never holds more than `limit` nodes and never repeats one. A one-word query has nothing to top up.
- The header counts both: `1 result for "billing roles", then 2 partial matches; check them before relying on them:`.

If you only want nodes with every word, read the hits without a `matched:` label; they always come first.

## Alternatives considered
- **Keep the fallback for empty results only.** One stray full hit keeps hiding better answers.
- **Rank everything together by how many words matched.** FTS5 doesn't report that per row, and full matches would lose their clear place at the top.
- **Add aliases to the data** (e.g. "SLO" on the SLO node). Fixes one node, not the pattern.

## Consequences
A short result shows the runners-up instead of empty room, for a few more lines only when the full matches are few. Labelling the partial hits costs one extra query per word, as before. `orient`'s focus list uses the same search and gets the same top-up.
