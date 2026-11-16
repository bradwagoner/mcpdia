# Cost as memory grows

Method: [ADR 0024](../docs/decisions/0024-lookup-tests.md). The 82 Kestrel facts plus generated filler (text sampled from this repo's docs, no real facts), kept both as an MCPdia graph and as markdown. Each strategy answers the same 40 questions the way `npm run bench` does: no model, tokens read per question. Tokens: claude-haiku-5-5 count_tokens.

Median tokens read to answer one question (answers found in brackets):

| Nodes | MCPdia: search, then get | Index, then the right file | Grep, then files | One file, read whole |
|---|---|---|---|---|
| 82 | 668 (40/40) | 2,660 (40/40) | 3,003 (36/40) | 15,476 (40/40) |
| 200 | 669 (40/40) | 5,228 (40/40) | 5,555 (35/40) | 33,910 (40/40) |
| 400 | 661 (40/40) | 9,724 (40/40) | 10,147 (32/40) | 65,033 (40/40) |
| 800 | 661 (40/40) | 18,472 (40/40) | 18,923 (34/40) | 126,797 (40/40) |
| 1,600 | 661 (40/40) | 36,223 (40/40) | 36,577 (33/40) | 250,471 (40/40) |

MCPdia's fixed cost with every tool definition loaded is 2631 tokens per session, at any size. Claude Code loads tool definitions on demand, so a real session usually pays less.

"Index, then the right file" always opens the file that holds the answer: the best case for split files.
