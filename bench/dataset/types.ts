/**
 * The demo dataset: knowledge about Kestrel, a fictional invoicing and
 * expense app for small agencies. Written once as nodes, rendered both into
 * an MCPedia graph and into markdown memory files (ADR 0013).
 */
export interface DemoNode {
  /** `<type>/<slug>`; the type is the part before the slash. */
  key: string;
  title: string;
  summary: string;
  body: string;
  /** The markdown topic file this node lives in on the markdown side. */
  file: string;
  tags?: string[];
  aliases?: string[];
  /** `[edgeType, targetKey]` pairs. */
  links?: [string, string][];
}

export type NodeInput = Omit<DemoNode, 'file'>;

export function topic(file: string, nodes: NodeInput[]): DemoNode[] {
  return nodes.map((node) => ({ ...node, file, body: node.body.trim() }));
}

export function typeOf(node: Pick<DemoNode, 'key'>): string {
  return node.key.slice(0, node.key.indexOf('/'));
}
