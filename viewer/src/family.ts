// The family tree around a selected node, shared by both renderers.
// Each layer is split into groups by how its nodes hang off the layer above (part_of, comments_on, ...).
// Ancestors sit above it a generation per row (parents, then grandparents, up to the top),
// siblings sit beside it (and each ancestor's siblings beside that ancestor), and descendants sit below it a generation per row. Every other
// neighbor (references, related_to, ...) gets a group per type on the far left and right.
// Positions are in screen pixels, relative to the selected node's center.

// Edges that put a node under another one: the hierarchy the tree follows.
export const UNDER_EDGES = new Set(['part_of', 'comments_on', 'candidate_for']);

export interface FamilyGraph {
  parents(id: string): string[];
  children(id: string): string[];
  neighbors(id: string): string[];
  title(id: string): string;
  type(id: string): string;
  // How `other` relates to `id`, e.g. "references →" or "← depends_on".
  relation(id: string, other: string): string;
  visible(id: string): boolean;
  // The hierarchy edge from `child` up to `parent` (one of UNDER_EDGES), or '' when there is none.
  underKind(child: string, parent: string): string;
}

export const SIZES = {
  boxWidth: 200,
  boxHeight: 25,
  selectedWidth: 240,
  rowGap: 6,
  columnGap: 12,
  generationGap: 48, // between rows of the tree, leaving room for each row's header
  sideGap: 70, // between the tree and the groups on the sides
  groupGap: 34,
  rowColumns: 5, // a generation wraps into more rows past this many boxes
  siblingColumns: 2, // per side
  sideRows: 16, // side groups wrap into another column past this many rows
  maxBelow: 80, // descendants shown, across all generations
  maxSiblings: 40,
};
export type Sizes = typeof SIZES;

export type Member = { id: string; x: number; y: number };
// left/top: the top-left corner of the boxes; the header sits just above `top`.
export type Cluster = {
  label: string;
  type?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  members: Member[];
};
export type Family = {
  clusters: Cluster[];
  ids: string[];
  ancestors: string[][];
  descendants: string[][];
};

const UP = ['parents', 'grandparents', 'great-grandparents'];
const DOWN = ['children', 'grandchildren', 'great-grandchildren'];
const generationName = (names: string[], k: number, arrow: string) =>
  `${arrow} ${names[k] ?? `${k + 1} generations ${arrow === '↑' ? 'up' : 'down'}`}`;

export function family(node: string, g: FamilyGraph, sizes: Partial<Sizes> = {}): Family {
  const s = { ...SIZES, ...sizes };
  const byTitle = (a: string, b: string) => g.title(a).localeCompare(g.title(b));
  const byTypeThenTitle = (a: string, b: string) => g.type(a).localeCompare(g.type(b)) || byTitle(a, b);
  const kinds = [...UNDER_EDGES];
  const rank = (kind: string) => (kinds.includes(kind) ? kinds.indexOf(kind) : kinds.length);
  const seen = new Set([node]);

  // Walk up and down a generation at a time. A node reachable two ways shows once, at its first generation.
  const generations = (step: (id: string) => string[], limit: number) => {
    const rows: string[][] = [];
    let count = 0;
    let frontier = [node];
    while (frontier.length && count < limit) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const n of step(id)
          .filter((n) => !seen.has(n) && g.visible(n))
          .sort(byTitle)) {
          if (count >= limit) break;
          if (seen.has(n)) continue; // two hierarchy edges between the same pair list it twice
          seen.add(n);
          next.push(n);
          count++;
        }
      }
      if (next.length) rows.push(next);
      frontier = next;
    }
    return rows;
  };
  const ancestors = generations(g.parents, Infinity);
  const descendants = generations(g.children, s.maxBelow);
  // Siblings: the other children of a row's parents. The node's own come first, then each ancestor's.
  const childrenOf = (parents: string[] = []) => {
    const ids = parents
      .flatMap((p) => g.children(p))
      .filter((n, i, all) => all.indexOf(n) === i && !seen.has(n) && g.visible(n))
      .sort(byTitle)
      .slice(0, s.maxSiblings);
    ids.forEach((n) => seen.add(n));
    return ids;
  };
  const siblings = childrenOf(ancestors[0]);
  const ancestorSiblings = ancestors.map((_ids, k) => childrenOf(ancestors[k + 1]));
  const byGroup = new Map<string, string[]>();
  for (const n of g.neighbors(node)) {
    if (seen.has(n) || !g.visible(n)) continue;
    const key = `${g.type(n)} · ${g.relation(node, n)}`;
    byGroup.set(key, [...(byGroup.get(key) ?? []), n]);
    seen.add(n);
  }

  // A grid of boxes, filled row by row (columnFirst: column by column).
  const grid = (label: string, ids: string[], columns: number, columnFirst = false, type?: string): Cluster => {
    const rows = columnFirst ? Math.min(ids.length, columns) : Math.ceil(ids.length / columns);
    const cols = columnFirst ? Math.ceil(ids.length / columns) : Math.min(ids.length, columns);
    const members = ids.map((id, i) => {
      const col = columnFirst ? Math.floor(i / rows) : i % cols;
      const row = columnFirst ? i % rows : Math.floor(i / cols);
      return {
        id,
        x: col * (s.boxWidth + s.columnGap) + s.boxWidth / 2,
        y: row * (s.boxHeight + s.rowGap) + s.boxHeight / 2,
      };
    });
    return {
      label,
      type,
      left: 0,
      top: 0,
      width: cols * (s.boxWidth + s.columnGap) - s.columnGap,
      height: rows * (s.boxHeight + s.rowGap) - s.rowGap,
      members,
    };
  };
  const place = (c: Cluster, left: number, top: number) => {
    c.left = left;
    c.top = top;
    c.members = c.members.map((m) => ({
      id: m.id,
      x: m.x + left,
      y: m.y + top,
    }));
    return c;
  };
  const clusters: Cluster[] = [];

  // A layer split by edge kind: `ids` hang off `parents` (up: `ids` are the parents of `lower` instead).
  // Each group is sorted by type, so the colors sit together.
  type Group = { label: string; ids: string[] };
  const byKind = (name: string, ids: string[], other: string[], up = false): Group[] => {
    const groups = new Map<string, string[]>();
    for (const id of ids) {
      const kind =
        other
          .map((o) => (up ? g.underKind(o, id) : g.underKind(id, o)))
          .filter(Boolean)
          .sort((a, b) => rank(a) - rank(b))[0] ?? 'other';
      groups.set(kind, [...(groups.get(kind) ?? []), id]);
    }
    return [...groups]
      .sort((a, b) => rank(a[0]) - rank(b[0]))
      .map(([kind, list]) => ({
        label: `${name} · ${kind}`,
        ids: list.sort(byTypeThenTitle),
      }));
  };

  // Groups side by side, centered on the node.
  const row = (groups: Group[]) => {
    const cs = groups.map((gr) => grid(gr.label, gr.ids, s.rowColumns));
    const width = cs.reduce((w, c) => w + c.width + s.groupGap, -s.groupGap);
    return {
      height: Math.max(0, ...cs.map((c) => c.height)),
      place(top: number) {
        let x = -width / 2;
        for (const c of cs) {
          clusters.push(place(c, x, top));
          x += c.width + s.groupGap;
        }
        return width;
      },
    };
  };
  // Groups on either side of a row whose middle part is `innerHalfWidth` wide, alternating left and right
  // and working outwards. A single group is split across both sides.
  const besides = (groups: Group[]) => {
    let parts = groups;
    if (parts.length === 1) {
      const { label, ids } = parts[0];
      const half = Math.ceil(ids.length / 2);
      parts = [
        { label, ids: ids.slice(0, half) },
        { label, ids: ids.slice(half) },
      ].filter((p) => p.ids.length);
    }
    const cs = parts.map((p) => grid(p.label, p.ids, s.siblingColumns));
    return {
      height: Math.max(0, ...cs.map((c) => c.height)),
      place(innerHalfWidth: number, top: number) {
        let left = innerHalfWidth + s.columnGap * 3;
        let right = left;
        cs.forEach((c, i) => {
          if (i % 2 === 0) {
            clusters.push(place(c, -left - c.width, top));
            left += c.width + s.groupGap;
          } else {
            clusters.push(place(c, right, top));
            right += c.width + s.groupGap;
          }
        });
      },
    };
  };

  // The selected node's row.
  const rowTop = -s.boxHeight / 2;
  const sibs = besides(byKind('siblings', siblings, ancestors[0] ?? []));
  sibs.place(s.selectedWidth / 2, rowTop);
  const rowBottom = rowTop + Math.max(s.boxHeight, sibs.height);

  // Generations above, nearest first, each row centered over the node with its own siblings beside it.
  let top = rowTop;
  ancestors.forEach((ids, k) => {
    const r = row(byKind(generationName(UP, k, '↑'), ids, k === 0 ? [node] : ancestors[k - 1], true));
    const aside = besides(byKind(`${UP[k] ?? 'ancestors'}' siblings`, ancestorSiblings[k], ancestors[k + 1] ?? []));
    top -= s.generationGap + Math.max(r.height, aside.height);
    aside.place(r.place(top) / 2, top);
  });
  // Generations below.
  let bottom = rowBottom;
  descendants.forEach((ids, k) => {
    const r = row(byKind(generationName(DOWN, k, '↓'), ids, k === 0 ? [node] : descendants[k - 1]));
    r.place(bottom + s.generationGap);
    bottom += s.generationGap + r.height;
  });

  // Everything else: one group per type and relationship, biggest first, alternating left and right
  // of the tree, each side stacked and centered on the node.
  const treeHalfWidth = Math.max(s.selectedWidth / 2, ...clusters.map((c) => Math.max(-c.left, c.left + c.width)));
  const sides = [...byGroup]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([label, ids]) => grid(label, ids.sort(byTitle), s.sideRows, true, g.type(ids[0])));
  for (const side of [-1, 1]) {
    const list = sides.filter((_c, i) => (i % 2 === 0) === side < 0);
    const total = list.reduce((sum, c) => sum + c.height + s.groupGap, -s.groupGap);
    let y = -total / 2;
    for (const c of list) {
      const x = side < 0 ? -treeHalfWidth - s.sideGap - c.width : treeHalfWidth + s.sideGap;
      clusters.push(place(c, x, y));
      y += c.height + s.groupGap;
    }
  }

  return {
    clusters,
    ids: clusters.flatMap((c) => c.members.map((m) => m.id)),
    ancestors,
    descendants,
  };
}

// The edge between two nodes, in words: "part_of →" when it goes from `id` to `other`.
export function relationText(out: string[], incoming: string[]) {
  return [...new Set([...out.map((t) => `${t} →`), ...incoming.map((t) => `← ${t}`)])].join(', ');
}
