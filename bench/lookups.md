# Lookup results

Method: [ADR 0024](../docs/decisions/0024-lookup-tests.md). No model: every number is the real server's answer to a scripted call. Dataset: 82 Kestrel nodes, 40 questions, the same questions reworded, and 10 questions it can't answer. Tokens: estimate (characters / 4).

Token counts are estimates (characters / 4). Retrieval and timing numbers are exact.

## Retrieval

Where the answer lands when the question's words are searched. hit@3 means the answer is in the top three results.

| Questions | hit@1 | hit@3 | MRR |
|---|---|---|---|
| As written | 33/40 | 39/40 | 0.90 |
| Reworded | 27/40 | 34/40 | 0.78 |

**Says when nothing matches:** 10/10 questions with no answer in the graph got "no match" instead of a hit.

Not in the top 3:

- Which email provider sends invoice emails?
- How can you tell a production API key from its prefix?
- How often do we retry a webhook that failed?
- Where is data for European customers hosted?
- How far back can the Postgres database be restored?
- What uptime target does the public API have?
- Which service delivers invoice email?

## Tokens per render level

Median over the 40 questions: a five-result search, and a get of the node that answers it.

| Level | Search, 5 results | Get, 1 node |
|---|---|---|
| title | 131 | 12 |
| summary | 261 | 37 |
| snippet | 628 | 113 |
| full | 834 | 158 |

## Stale facts

52/52 checks passed after superseding 5 facts, deleting 3 and flagging 3 as wrong: an old fact never reads as current.

## Scaling

The dataset hidden among generated nodes: text sampled at natural word frequency, with no real facts. **Other topics** samples this repo's docs, the everyday case of a graph that holds more than one project. **Same topic** samples the dataset's own words, the worst case: thousands of nodes that look like the answers. Latency is per tool call through MCP on the other-topic graph, 3 passes over the 40 questions.

| Nodes | Search p50 / p95 ms | Get p50 / p95 ms | DB size | Other topics: hit@3 | reworded | Same topic: hit@3 | reworded |
|---|---|---|---|---|---|---|---|
| 82 | 2.03 / 3.29 | 0.11 / 0.19 | 0.5 MB | 39/40 | 34/40 | - | - |
| 1,082 | 2.25 / 3.92 | 0.11 / 0.21 | 3.9 MB | 40/40 | 33/40 | 33/40 | 21/40 |
| 10,082 | 9.63 / 22.29 | 0.15 / 0.24 | 33.1 MB | 39/40 | 32/40 | 27/40 | 14/40 |
| 100,082 | 338.82 / 755.16 | 0.18 / 0.22 | 327.3 MB | 38/40 | 29/40 | 21/40 | 7/40 |

Machine: win32, Node v24.19.0.
