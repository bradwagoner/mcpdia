// Fallback legend text for the (?) buttons, used when the graph's type_defs table
// has no description for a type. Long term these should live in type_defs, where
// LLM clients can read them too.
const NODE_TYPES: Record<string, string> = {
  note: 'A free-form piece of knowledge: a finding, a recommendation, a meeting outcome.',
  task: 'A unit of work with a status. Often part_of a plan and addresses an issue.',
  issue: 'A problem or pain point that was observed, with severity and status.',
  plan: 'A goal with the tasks and notes that belong to it.',
  idea: 'Something worth doing someday. Not committed to yet.',
  research: 'An open question being investigated, with candidates and comparisons.',
  library: 'A third-party library or tool that was evaluated.',
  decision: 'A choice that was made, and why.',
  'how-to': 'Step-by-step instructions for doing something.',
  test: 'A test run or test case and its results.',
  '(ghost)':
    'A ghost node: an edge points here, but the node is not in this graph yet. Edges are late-bound, so links can arrive before their targets (ADR 0007).',
};

const EDGE_TYPES: Record<string, string> = {
  part_of:
    'The source belongs to the target, like a task inside a plan. Nodes that are part_of the same parent are siblings.',
  comments_on: 'The source is a note or annotation about the target.',
  references: 'The source mentions or cites the target.',
  related_to: 'A loose link: the two are connected in some way worth noticing.',
  addresses: 'The source (usually a task) fixes or responds to the target (usually an issue).',
  candidate_for: 'The source is one of the options being considered for the target.',
  depends_on: 'The source cannot finish until the target does.',
  supersedes: 'The source replaces the target, which is now out of date.',
};

export function describeType(kind: 'node' | 'edge', name: string): string {
  const known = kind === 'node' ? NODE_TYPES[name] : EDGE_TYPES[name];
  return known ?? `No description yet for this ${kind} type. Add one to type_defs.`;
}
