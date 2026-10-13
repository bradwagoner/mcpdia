# 0011: Compact text responses

- Status: Accepted
- Date: 2026-10-07

## Context
Every tool response lands in the model's context, so its format is a token cost paid on every call. JSON repeats every field name and quote on every result.

## Decision
Tools return **compact plain text**, not JSON:

- One line per result, no field names, no quotes, empty fields left out.
- A stub looks like `concept/permissions [concept] Permission system`, with an indented summary line below it at the `summary` level.
- Errors are one line with MCP's error flag set, plus a hint where one helps.
- The core returns typed objects and only the tool layer turns them into text, so tests check the objects and the format can change in one place.

Values are not hashed or abbreviated: the model has to read the words to decide what to open next.

`get` takes a **list of keys**; one key is a list of one. The list is capped by the `get.max_keys` setting (default 10), a setting rather than a constant so it can be raised without a code change. The cap is a safety rail: 100 nodes at `full` level could run to tens of thousands of tokens, and an unlimited call could dump half the graph into context.

## Alternatives considered
- **JSON:** easier to parse, but the same permissions stub is about 37% more characters (194 vs 123). The model reads, it does not parse.
- **MCP structured content alongside text:** doubles the payload for clients that show both. Can be added later if a client needs it.
- **Uncapped `get`:** simplest to explain, but defeats the purpose of the project in one careless call.

## Consequences
- Responses are cheap and readable. The benchmark harness will measure real tokens.
- Clients that want machine-readable output will need a structured option later.
- The cap may need tuning once real usage shows how many nodes a task fetches.
