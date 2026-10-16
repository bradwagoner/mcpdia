# 0002: Free-form types with soft guardrails

- Status: Accepted; the "did you mean" hint is replaced by ADR 0018
- Date: 2026-10-06

## Context
Different users describe different domains, so node types and edge types cannot be fixed in code. But an LLM is the main writer, and unconstrained LLM writers drift: `ticket`, `Ticket`, `jira-ticket`, and `issue` all end up meaning the same thing, and searches miss most of them. Edge-type drift is worse, because traversal ("what does this depend on?") returns incomplete answers.

## Decision
- Node and edge types are **free-form strings**. No enumerated list in code.
- **Normalize only trivially safe things on write:** case, whitespace, separators.
- **Make the vocabulary visible:** a `list_types` tool returns types with usage counts. Tool descriptions tell the LLM to check it before inventing a type.
- **Suggest, never block:** if a new type looks close to an existing one, the write succeeds and the response includes a "did you mean?" hint.
- **Optional type definitions:** a type may have a description, suggested properties, and expected edges. Absence never breaks anything.
- Ship a **small starter vocabulary** as suggestions, not rules. Edges: `related_to`, `part_of`, `depends_on`, `supersedes`, `example_of`, `references`. Nodes: `concept`, `note`, `decision`, `how-to`.
- Cleanup is **feature-rich rather than rigid**: duplicate-candidate finders, health reports, and bulk operations (`merge_nodes`, `rename_type`, `merge_types`) with dry-run mode. Packaged MCP prompts guide an LLM through cleanup passes.

## Alternatives considered
- **Hard-coded enums:** rigid; contradicts the goal of letting any user describe their data.
- **Auto-merging near-duplicate types:** convenient but can be wrong. Rejected in favor of flagging plus easy, reversible bulk operations.

## Consequences
- Maximum flexibility; packs can carry their own vocabulary.
- Some drift will happen. We accept that and invest in detection and cleanup tooling instead of prevention.
- Soft-delete and versioning (see schema) make every cleanup reversible.
