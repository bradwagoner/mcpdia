import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { files, nodes, questions, renderMarkdown } from '../../bench/dataset/index.js';
import { searchWords } from '../../bench/strategies.js';

/** The benchmark is only as good as its data (ADR 0013). */
describe('demo dataset', () => {
  const keys = new Set(nodes.map((n) => n.key));

  it('has unique keys, known files and links to nodes that exist', () => {
    expect(keys.size).toBe(nodes.length);
    for (const node of nodes) {
      expect(
        files.map((f) => f.name),
        node.key,
      ).toContain(node.file);
      for (const [, to] of node.links ?? []) expect(keys, `${node.key} → ${to}`).toContain(to);
    }
  });

  it('puts every needle in the node that answers its question', () => {
    for (const q of questions) {
      const node = nodes.find((n) => n.key === q.answer);
      expect(node, q.answer).toBeDefined();
      expect(`${node!.summary}\n${node!.body}`.toLowerCase(), q.question).toContain(q.needle.toLowerCase());
      expect(searchWords(q.question).length, q.question).toBeGreaterThan(0);
    }
  });

  it('keeps the committed markdown in sync with the source (npm run demo:markdown)', () => {
    const dir = resolve(import.meta.dirname, '../../bench/dataset/markdown');
    for (const [name, text] of renderMarkdown()) {
      expect(readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n'), name).toBe(text);
    }
  });
});
