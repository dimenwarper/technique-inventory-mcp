# Technique Inventory MCP

A local MCP server for a growing collection of reusable techniques, results, counterexamples, and research workflows. Search it from any connected project, save a finding when it becomes useful, and revise it as the evidence changes.

The inventory is one readable JSON file per record. It works without an API key, embedding model, database service, or network connection at runtime. The initial collection contains 21 records extracted from an ETH research project; the schema and server are independent of that subject.

## Get started

Requires Node.js 22 or later.

```sh
npm ci
npm run check
```

Connect the built server to your MCP client using an absolute data directory:

```sh
node /absolute/path/to/technique-inventory-mcp/dist/cli.js \
  serve --data-dir /absolute/path/to/technique-inventory-mcp/inventory
```

The client launches this command itself. A local stdio MCP server waits for protocol messages; you do not need to leave a separate server terminal running. [Connect it to Codex](docs/codex-setup.md).

All projects should point to the same data directory. To start your own empty collection, provide a different directory; the server creates its `techniques` subdirectory. You can keep the server code and your inventory in separate repositories.

## Use it during work

Ask your connected assistant:

> Search my technique inventory for exact certificate verification.

> Save the reusable technique from this work, including its assumptions, limitations, source files, and what we actually verified.

> Update the stored result with this counterexample and explain which claim it invalidates.

The intended workflow is:

1. Search for an existing entry before creating one.
2. Read its full statement and limitations before reusing it.
3. Save a self-contained result with evidence and provenance.
4. Revise or link existing records as you learn more; archive superseded material without deleting it.
5. Review and commit the file changes when you want a Git checkpoint.

The server does not run background collection. An assistant saves or revises a record through an explicit tool call. It does not automatically commit, synchronize, or publish changes.

## Tools

| Tool | Purpose |
| --- | --- |
| `search_techniques` | Ranked lexical search with project, tag, kind, evidence, and status filters; compact paginated results. |
| `get_technique` | Read a full record, including sources, caveats, and current revision. |
| `add_technique` | Create a record; reject an existing ID instead of overwriting it. |
| `update_technique` | Replace supplied fields only, with an expected revision to detect stale edits. |
| `inventory_stats` | Counts by project, tags, evidence, kind, and status. |

Search tokens are ANDed, with title and tag matches weighted more heavily. Use a few relevant keywords, or an empty query to browse. All requested tags must match. Results exclude archived records by default; specify `status: "archived"` to find them. `limit` is capped at 100 and `offset` supports pagination. Search is lexical, not semantic similarity.

Resources expose `techniques://guide`, `techniques://schema`, and `techniques://record/{id}`. The `capture_technique` prompt helps an assistant turn completed work into a scoped entry.

Use `--read-only` when a client should only search and read. It omits the two write tools.

## Record format

For `add_technique`, only `title`, `summary`, and `content` are required. Supply the other fields when known; evidence starts as `unassessed`. The server adds timestamps and a revision. See [a complete example](examples/technique.json).

```json
{
  "id": "rational-certificate-replay",
  "title": "Replay numerical witnesses with exact arithmetic",
  "summary": "Use numerical optimization to discover a witness, then check a rational version exactly.",
  "content": "Construct rational witness data and verify the decisive inequality without numerical tolerances.",
  "whenToUse": "Optimization experiments that need independently checkable conclusions.",
  "limitations": "Certifies the stated inequality, not the completeness of the numerical search.",
  "tags": ["certificates", "exact arithmetic"],
  "project": "my-project",
  "kind": "technique",
  "evidence": { "level": "experimental", "details": "Describe the actual checks here." },
  "sources": [{ "project": "my-project", "path": "notes/witness.txt", "line": 12 }]
}
```

- `kind`: `technique`, `result`, `counterexample`, or `workflow`.
- `evidence.level`: `unassessed`, `conjecture`, `experimental`, `exhaustive`, or `proof`. These describe evidence, not a universal ranking of usefulness. A proof label is not a novelty or formal-verification claim.
- `status`: `active`, `superseded`, or `archived`.
- `sources`: project-relative paths, optional line numbers and SHA-256 hashes, web URLs, or provenance notes. Source references are stored as data; the server does not open or execute them.
- `relatedIds`: connections to other records.
- `nextSteps`: a bounded follow-up or extraction idea.

For updates, pass `id`, `expectedRevision`, and `patch`. Arrays and the `evidence` object are replaced as whole fields. A stale revision returns `CONFLICT`; read the new record and reconcile changes before retrying. Do not blindly retry an old patch.

## Storage and Git

```text
inventory/
  README.md
  techniques/
    eth-search-01.json
    eth-alg-01.json
    ...
```

Records are validated on reading and writing. Writes use a same-directory temporary file, flush it, and atomically rename it. A directory lock serializes cooperating server processes, while revisions prevent lost edits between tasks. This is intended for a local filesystem, not network-mounted distributed storage. Readers can see different record revisions during a multi-record import; a single record is the transaction boundary.

Git supplies review and version history:

```sh
git diff -- inventory
git add inventory
git commit -m "Record reusable techniques from the latest project"
```

The server does not make these commits for you. Direct manual edits should increment `revision` and refresh `updatedAt`; avoid manual edits or Git checkout/pull while a tool write is in flight. For collaborative Git changes, merge files normally, validate, and then resume writing.

If a writer is killed, a `.write-lock` directory may remain. A later write fails with a timeout rather than guessing it can take over. Inspect `owner.json`, confirm the writer is no longer running on its recorded host, and remove only that stale lock directory.

## Imported ETH collection

[The collection notes](inventory/README.md) preserve the original survey's scope, evidence policy, and corrections. The 21 records contain portable relative source references and hashes. The original research scripts and raw datasets are not bundled; each record is self-contained enough to assess relevance, with references for deeper verification.

To reproduce the import from the original catalog:

```sh
npm run import:eth -- --catalog /path/to/catalog.json --data-dir ./inventory
```

It validates and preflights all conflicts, skips identical records, and never overwrites changed records. It shares the server's write lock. An interrupted multi-file import can be resumed, but it is not an all-or-nothing transaction.

## Checks and development

```sh
npm run build
npm test
node dist/cli.js validate --data-dir ./inventory
node dist/cli.js stats --data-dir ./inventory
```

Tests cover persistence, malformed records, path handling, search, concurrent writers, revision conflicts, import behavior, and actual MCP stdio clients creating, searching, updating, and reading records after reconnecting. The GitHub workflow runs checks on Node 22 and 24.

The server uses the [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) and its local stdio transport. It never writes logs to the protocol's stdout stream.

## Put it on GitHub

This directory is a standalone repository candidate. Push it as its own repository, including the inventory if you want to publish those records. Runtime dependencies and generated build files are excluded. Machine-specific Codex configuration stays outside the repository.

Publishing the code does not expose a local MCP endpoint or synchronize inventories. Other users install their own copy and choose their own data directory. You can publish the server while keeping your working inventory in a separate private repository.

No public repository is created by setup. The package is marked `private` to prevent accidental npm publication, and no redistribution license has been assigned yet; choose one if you want others to reuse the published code or collection.
