# Errorcore Runtime Evidence Engine

A Node.js 24 / strict TypeScript library that stores received JSON bytes unchanged, builds a sparse hierarchical evidence index, and exposes source-supported execution records through bounded retrieval APIs. It performs no inference, root-cause analysis, or additional redaction.

The generic adapter accepts any valid UTF-8 JSON document. The included `errorcore-example-v1` adapter is **illustrative**, not Errorcore's production schema.

## Run

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm test
npm run example
npm run benchmark -- --size=10mb
npm run benchmark -- --size=100mb
# Optional; not run during delivery:
npm run benchmark -- --size=1gb
```

Dependencies and the lockfile are pinned. npm scripts use the project-local Node 24.22.2 binary. On this Windows PowerShell installation, use `npm.cmd run benchmark -- --size=100mb` to preserve argument forwarding; the host's `npm` PowerShell wrapper consumes `--size`.

The example prints an overview first, follows a failed operation into its snapshot, retrieves an observed exception message and explicit redaction metadata, demonstrates pagination and generic JSON, then retrieves evidence in a new Node process. It prints and retains a temporary store. Benchmarks retain artifacts under ignored `.benchmark/` directories and publish measurements in `benchmarks/results/`.

## Use

```ts
import { createReadStream } from 'node:fs';
import {
  createEvidenceEngine,
  LocalEvidenceStorage,
} from './dist/src/index.js';

const storage = new LocalEvidenceStorage('./evidence-store');
const engine = createEvidenceEngine({ storage });
const manifest = await engine.compileRuntimeState(
  createReadStream('tests/fixtures/runtime.json'),
  { adapterId: 'errorcore-example-v1' },
);

// First debugging-agent call:
const overview = await engine.getOverview(manifest.captureId);
const failed = overview.graph.operations.find(
  (operation) => operation.id === overview.failures[0]?.operation.operationId,
);
const snapshot = await engine.inspectNode(failed!.snapshotId!);
const child = snapshot.children[0]!.node;
const evidence = await engine.getEvidence(child.id);

// Optional full integrity verification (reads all three immutable data files):
await storage.verify(manifest.captureId);
```

The four functions also have top-level exports using a lazy default store at `.errorcore-evidence` relative to the process working directory. Prefer configured instances in applications. Reopening the same storage directory preserves capture IDs, node IDs and cursors.

| API                                     | Important options                                                                 | Result                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `compileRuntimeState(stream, options?)` | `adapterId`, `signal`, `maxBytes` (input byte ceiling)                            | Committed manifest, integrity hashes, counts and metrics                                                                      |
| `getOverview(captureId, options?)`      | `maxBytes`, operation/relationship/failure limits and cursors, `focusOperationId` | Failure locations, bounded graph projection, evidence references and exact remaining counts                                   |
| `inspectNode(nodeId, options?)`         | `maxBytes`, `limit`, `depth`, `cursor`                                            | Node metadata and children; shared entry budget across recursive expansion                                                    |
| `getEvidence(nodeId, options?)`         | `maxBytes`, `limit`, `sliceUnits`, `cursor`, `part`                               | Scalar, number lexeme/string slice, ordered collection references, captured-value reference, or explicit unavailable metadata |

Retrieval defaults to 64 KiB serialized JSON, with a configurable hard maximum of 1 MiB. The minimum requested budget is 4 KiB. The engine can reject a budget with `RESOURCE_LIMIT` if a minimal record will not fit. Defaults are 25 graph operations, 50 relationships, 10 failures, 50 inspection/collection entries, inspection depth 1 and 4,096 scalar units. Every page/slice reports completeness and a continuation when needed.

Numbers are strings labeled `encoding: "number-lexeme"`; this preserves unsafe integers, negative zero, exponents and formatting. Strings paginate by UTF-16 code unit, including lone surrogates. A page can split a surrogate pair: concatenate slice strings before interpreting the completed text. Collection results are ordered child references, preserving duplicate object members; they never assemble an entire runtime object.

For a wrapper such as `{ "$availability": "truncated", "value": [1, 2] }`, `getEvidence` returns `kind: "reference"`, a resolvable `valueId`, and `sourceComplete: false`. Follow the reference for the captured page; its source incompleteness is retained. Redacted, uncaptured, unknown and unresolved wrappers return `kind: "unavailable"`. An observed wrapper without an explicit `value` returns unresolved availability. Literal marker-looking strings and JSON null remain ordinary observations. Inspection exposes original source structure, including wrapper metadata, without fabricating an unavailable runtime value.

Long keys and paths have labeled previews. Retrieve their complete text with `getEvidence(nodeId, { part: "key" | "pointer" })`. Paths containing object members have conservative `ambiguity: "possible"`, because duplicate keys are legal and uniqueness is not globally indexed. Use node IDs and member ordinals for occurrence identity.

## Continue a graph projection

Overview sections paginate independently. Pass each section's `endCursor`, including exhausted sections, to avoid restarting completed pages. `nextCursor` is present only when that section has more records.

```ts
let options = {};
while (true) {
  const view = await engine.getOverview(manifest.captureId, options);
  // Process view.failures, view.graph.operations and view.graph.relationships.
  if (view.responseComplete) break;
  options = {
    failureCursor: view.failurePage.endCursor,
    operationCursor: view.graph.operationPage.endCursor,
    relationshipCursor: view.graph.relationshipPage.endCursor,
  };
}
```

A focused overview starts a new pagination sequence with `focusOperationId`. Cursors are signed and bound to capture/node, depth, evidence part or focus. Page sizes and output budgets can change between pages. Invalid identifiers, cursor reuse across queries and traversal-shaped IDs fail with typed `EvidenceError.code` values. Error text never includes parser excerpts or raw evidence.

## Storage and limits

Compilation streams original bytes to `source.json` and unpacked parser tokens to `structure.bin`. A separate strict JSON verifier and fatal UTF-8 decoder reject invalid input. String-mode streams and a leading BOM are rejected. Staging publication occurs only after validation, fsync, database commit and closed handles, using a same-volume directory rename. Killed ingestions can leave unreachable staging directories; they are never returned as committed captures.

SQLite contains graph records, explicit availability metadata, and a shallow evidence index. Mutable inspected-node caches/checkpoints live outside committed evidence. No compile-time SQLite row is required for each array element. Structural records still cost 64 bytes per value, plus keys and scalar content; see the measured storage overhead below. Original files, structure and semantic database are immutable through the API. The local filesystem owner is trusted. Per-call retrieval checks sizes/format; full checksums require `storage.verify()`.

The default ingestion limits are nesting 256, decoded key size 64 KiB, and pointer size 256 KiB, counting key/path UTF-16 bytes. `createEvidenceEngine({ limits: { ... } })` can configure these within hard ceilings of 1,024 levels, 1 MiB per key and 2 MiB per pointer. Scalar length and collection length are not packed into memory; storage size is limited by disk capacity and safe integer addressing. Caller-owned input chunks remain outside the engine memory guarantee.

Process-crash visibility is tested. Portable power-loss durability is not claimed. Synchronous structural writes and SQLite work run in process and can block the event loop during chunks and graph finalization. First access to an uncached node may scan preceding siblings. Graph offsets/focus queries may scan or sort large persisted sets. The sparse design does not promise constant retrieval latency for every uncached query.

## Verification and integration

The delivery suite contains 41 tests across structural correctness, evidence semantics, malformed input, resource limits, exact bytes/hash, authenticated cursors, backpressure, immutable-file checks, graph pagination, restart, and real process-kill publication tests. Build, typecheck, lint, tests and the executable example have been run. The runtime dependency audit has zero findings; full development-tool audit findings are recorded in the implementation plan.

Actual 10 MiB and 100 MiB measurements, environment, storage sizes and cold/warm timings are in [benchmarks/RESULTS.md](benchmarks/RESULTS.md), with raw JSON alongside it. The 1 GiB command is implemented but has not been run. These are synthetic workload measurements, not production capacity claims.

For production integration, implement a versioned `CaptureSchemaAdapter` using the bounded structural-event contract in [src/types/index.ts](src/types/index.ts), register it through `createEvidenceEngine({ storage, adapters: [adapter] })`, and add real fixtures. The adapter must map explicit source IDs, relationships, failures, availability and runtime encodings without assembling arbitrary runtime objects. Source IDs above 1,024 code units remain referenceable but unresolved in the illustrative adapter. Ambiguous source IDs never merge operations.

See [the specification](docs/SPEC.md), [architecture and binary format](docs/ARCHITECTURE.md), and [implementation checklist](docs/IMPLEMENTATION_PLAN.md). Production-schema integration remains outstanding because no production schema or fixture was supplied.
