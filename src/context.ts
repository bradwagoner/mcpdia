/**
 * Who is calling and what they can see. Every core call takes one.
 * Solo mode uses a constant; team mode (v0.3) will build it from auth.
 */
export interface Context {
  /** Stamped on writes as author / updated_by. */
  caller: string;
  /** Namespaces visible to reads. A list from day one (ADR 0007). */
  namespaces: string[];
  /** Namespace new nodes and edges are written to. */
  writeNamespace: string;
}

/** The only place the default namespace is spelled out. */
export const DEFAULT_NAMESPACE = 'default';

export function soloContext(): Context {
  return { caller: 'local', namespaces: [DEFAULT_NAMESPACE], writeNamespace: DEFAULT_NAMESPACE };
}
