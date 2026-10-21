# 0020: Snippets show the match

- Status: Accepted
- Date: 2026-10-19
- Amends: ADR 0004 (the `snippet` level)

## Context
A `snippet` was the first 300 characters of the body. Search matches the whole body, so a node can match on a word the snippet never shows. In a bench session the model asked for the prefix of live API keys: search ranked the right node second, but the answer (`kst_live_`) started 21 characters past the cut, and the model answered from the stub without calling `get`. Most demo nodes are 300 to 450 characters, so the cut usually hides the last paragraph, where specific facts tend to sit.

## Decision
**In `search`, a snippet shows the text around a searched word that would otherwise be cut off.**
- If every searched word is in the title, summary or the first 300 characters, the snippet is unchanged.
- Otherwise it is about 100 characters of intro, ` … `, then about 200 characters starting a little before the first hidden word, both cut at whole words, ending with `(+N chars)` for what was left out.
- A word counts as present the way the index matches it: any case, at the start of a word, with `_` and punctuation as breaks. So `live` is found in `kst_live_`.

Same budget as before. `get` at `snippet` level has no query, so it keeps the plain first 300 characters.

## Alternatives considered
- **Show short bodies whole.** Fixes this case but returns as soon as a node is a little longer.
- **FTS5's `snippet()`.** It picks the fragment with the most matches, which here was the opening text full of "key".
- **Only say the body was cut.** Cheap, but the model still has to guess whether `get` is worth it.

## Consequences
A stub carries the fact a search word points to, at about the same cost. If you expected the plain first 300 characters, use `get` with `level: snippet`.

Update 2026-10-20: inside a long word or URL, the window cuts mid-word rather than skip past the match. The match is found with a light suffix strip (`-s`, `-es`, `-ed`, `-ing`), so "permissions" finds "permission" the way the index does; exact stem positions from the index are a later step.
