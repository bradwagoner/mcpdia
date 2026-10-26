# SQLite and Postgres over HTTP

177 active nodes, copies of one graph. No model. 3 timed passes per latency row.

## 1. Same answers

Of 177 title searches (top 5): identical 9, same set 20, same top hit 164. Identical get text: 137/177.

- "test mcpdia llm": sqlite plan/mcpedia, postgres how-to/test-mcpedia-with-an-llm
- "cytoscape js": sqlite library/cytoscape-js, postgres note/2026-10-15
- "sigma js": sqlite library/sigma-js, postgres note/2026-10-15
- "local ticket branches 2026 10 14": sqlite plan/local-ticket-branches-2026-10-14, postgres plan/ticket-branches-and-merge-order-2026
- "mcpdia": sqlite plan/mcpedia, postgres plan/side-by-side-demo

## 2. Retrieval (hit@1 / hit@3 / MRR, of 177)

| | sqlite | postgres | sqlite +10k | postgres +10k |
|---|---|---|---|---|
| title words | 169 / 177 / 0.97 | 170 / 176 / 0.98 | 163 / 175 / 0.95 | 168 / 173 / 0.96 |
| summary words | 177 / 177 / 1 | 177 / 177 / 1 | 177 / 177 / 1 | 176 / 177 / 1 |

## 3. Latency, ms p50 / p95

| Tool | sqlite | postgres | sqlite +10k | postgres +10k |
|---|---|---|---|---|
| orient | 27.8 / 46.2 | 15.7 / 48.7 | 14.9 / 17.3 | 15.2 / 20.5 |
| search | 31.8 / 75.7 | 38.7 / 62.7 | 81.4 / 157.1 | 120.7 / 195.6 |
| get | 15 / 17.1 | 14.8 / 16.7 | 14.9 / 16.7 | 14.7 / 17.4 |
| recent | 14.8 / 16.6 | 15.1 / 17.5 | 30.6 / 37.8 | 30.6 / 40.8 |

## 4. Writes, ms p50 / p95

| Tool | sqlite | postgres |
|---|---|---|
| upsert | 15 / 17 | 15.3 / 24.3 |
| supersede | 14.6 / 48.5 | 29.2 / 33.5 |
| delete | 14.4 / 21.4 | 15.4 / 24.6 |

Loading 10000 filler nodes one upsert at a time: sqlite 169.4 s, postgres 166.2 s.

## 5. Concurrency: calls per second, p95 ms, errors

| Mix | Clients | sqlite | postgres | sqlite +10k | postgres +10k |
|---|---|---|---|---|---|
| reads | 1 | 48/s, 32.8 | 16/s, 142 | 11/s, 160.2 | 7/s, 209.5 |
| reads | 4 | 96/s, 65.5 | 28/s, 200.7 | 18/s, 396.7 | 33/s, 152.2 |
| reads | 16 | 101/s, 275.6 | 32/s, 786.2 | 18/s, 1637.4 | 59/s, 390.8 |
| 1 write in 4 | 1 | 54/s, 32.6 | 10/s, 162.6 | 14/s, 146.9 | 11/s, 145.4 |
| 1 write in 4 | 4 | 109/s, 84.8 | 30/s, 207.3 | 25/s, 326.5 | 41/s, 151.4 |
| 1 write in 4 | 16 | 144/s, 211.8 | 56/s, 647.6 | 23/s, 1293.8 | 77/s, 375.3 |

Machine: win32, Node v24.19.0, both servers in Docker on the same machine.
