# 0012: Readable keys and normalization rules

- Status: Accepted
- Date: 2026-10-07

## Context
ADR 0003 makes `(namespace, key)` the stable identity and says the core suggests keys from titles. ADR 0008 says notes get "a generated key". Two details were left open: how keys are built, and exactly what "normalize case, whitespace and separators" means when the starter vocabulary mixes `how-to` with `depends_on`.

## Decision
**Keys are built from words, not random ids.** A key is `<type>/<slug>`, where the slug is the first six words of the title, lowercased, accents stripped, joined by hyphens, at most 48 characters: `how-to/granting-admin-access`. Notes will follow the same rule from their text (`note/permissions-cache-is-5-min`). A random 26-character ULID costs many tokens and means nothing to the model.

**Collisions.** When `upsert` is called without a key and the derived key belongs to an active node, the write stops and says so, with the key to pass to update it instead. That is the search-before-write check. A derived key held by a deleted or superseded node gets a `-2`, `-3` suffix. Notes, which are many and never meant to merge, always take the suffix.

**Keys are stored as given** apart from trimming. They are identities (`ticket/PROJ-123`), not vocabulary.

**Normalization** changes only case, surrounding whitespace and separators:
- Node types and tags use hyphens: `Jira_Ticket` becomes `jira-ticket`.
- Edge types use underscores: `Depends On` becomes `depends_on`.
- Aliases keep their spaces and only lose case and extra whitespace, since they are matched against people's words.

**Type hints** fire when a type is new to the graph and is within two edits of an existing or starter type, or equal to one after dropping separators and a trailing "s". The write always succeeds (ADR 0002).

**Refinement after first use (2026-10-07).** A note's key came out as `note/recommendation-sigma-js-graphology-fed-by`, cut mid-phrase. Slugs now come from the text's lead clause (up to the first `.`, `,`, `:`, `;`, ` - ` or line break that leaves at least two words), and never end on a filler word such as "by", "of" or "the". That text gives `note/recommendation-sigma-js-graphology`.

## Alternatives considered
- **ULID keys for notes:** no collisions ever, but expensive to tokenize and unreadable.
- **One separator for all types:** simpler, but would rename either `how-to` or `depends_on` in the starter vocabulary.
- **Tags looser than types:** no clear benefit; one rule is easier to explain.

## Consequences
- Keys read well in every response and in links.
- Retitling a node does not change its key. That is deliberate, since keys are identities.
- Close-but-different types (`note` and `node`) may draw a false "did you mean". It is only a hint.
