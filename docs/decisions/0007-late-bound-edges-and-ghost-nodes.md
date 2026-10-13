# 0007: Late-bound edges and ghost nodes

- Status: Accepted (schema ships in v0.1; ghost-node read behavior is phase 2)
- Date: 2026-10-06

## Context
In the first-draft schema, an edge pointed at node rows by foreign key. That means an edge cannot exist unless both of its nodes are loaded. This breaks three things we want:

- **Partial loads:** connecting with only the `dev` namespace loaded when `dev` nodes link to `product` nodes.
- **Import ordering:** a pack whose edges arrive before their target nodes.
- **Cross-pack links:** a team pack referencing nodes in a pack the user hasn't installed.

We would rather handle the missing-target case when reading than prevent it from occurring.

## Decision
- An edge's real reference to each end is its **namespace and key** (`from_namespace`, `from_key`, `to_namespace`, `to_key`). These are the stable identities from ADR 0003.
- `from_id` and `to_id` are **nullable resolved shortcuts**, filled in when the node exists. When a node is created or imported, waiting edges are resolved.
- A null `to_id` means the target is not loaded.

**Phase 2 read behavior:** a traversal that hits an unresolved edge returns a **ghost** in place of the node, for example:

```
{ ref: "product:concept/billing", status: "unloaded", via: "depends_on", load_hint: "pack:product-v2" }
```

- Ghosts are **collapsed by default** ("3 links into unloaded namespace `product`"), with individual refs on request, to protect token budgets.
- `load_hint` comes from a **namespace-to-pack catalog** (a settings entry or a manifest inside exported packs). With no match, the ghost simply says "unloaded".

## Alternatives considered
- **Forbid cross-namespace edges:** simple, but it blocks legitimate links and doesn't fix import ordering.
- **Keep foreign keys and drop edges on partial load:** silently loses data.
- **Insert placeholder node rows for unloaded targets:** pollutes counts, search, and type registries with fake nodes.

## Consequences
- Four extra text columns on `edges`, plus a resolution step when nodes are created or imported.
- Reads join on ids when present, so the common path stays fast.
- v0.1 assumes a single dataset, but the schema does not need to change when more arrive.
- Code conventions that keep multi-dataset support cheap: `context.namespaces` is a list, `'default'` is never hard-coded outside context defaults, and displayed keys are namespace-qualified (`dev:concept/permissions`).
