# Precursor

Precursor is Errorcore's runtime evidence engine for Node.js and TypeScript. It converts large, already sanitized JSON captures into immutable stored evidence, a navigable hierarchical index, and an execution graph supported by explicit source metadata.

The engine gives debugging tools progressive access to a capture. A session begins with a compact overview, follows evidence references, inspects structure, and retrieves selected values. The complete runtime object is never required in a response.

Precursor provides deterministic evidence access. It does not perform root-cause analysis, generate explanations, or apply additional redaction.

## Project status

The repository provides an in-process library with local filesystem storage. It includes a generic JSON adapter and an illustrative Errorcore adapter. The illustrative adapter is an integration example, not a production capture schema.

The package is marked `private` to prevent accidental npm publication. Use this repository directly. A production schema adapter and application-specific operational controls remain integration work.

## Requirements and installation

- Node.js 24, as specified in [`.node-version`](.node-version).
- npm with support for the committed lockfile.
- Local disk space for the original capture, structural representation and indexes.

```sh
git clone https://github.com/errorcoredev/precursor.git
cd precursor
npm ci
npm run build
npm run example
```

Dependencies are pinned. npm scripts use the project-local Node.js binary installed with development dependencies. The library itself requires Node.js 24 and uses its built-in SQLite module. On Windows PowerShell, use `npm.cmd` if script execution policy blocks `npm`, or when forwarding command options after `--`.

The example compiles [a synthetic capture](examples/runtime.json), calls `getOverview` first, inspects a recorded failure's snapshot, retrieves an observed message and explicit redaction metadata, demonstrates bounded output, and reopens the store in a fresh process. It prints the temporary storage directory and retains it for inspection.

## Ingest a capture file

```sh
npm run capture -- /path/to/capture.json
```

The file runner uses the generic JSON adapter by default. It stores evidence in `.errorcore-evidence` relative to the working directory, then prints a manifest, overview, one root inspection page and one evidence result. Responses retain their limits and continuation metadata. The input file is not modified.

Select the illustrative adapter explicitly for the included synthetic schema:

```sh
npm run capture -- examples/runtime.json --adapter=errorcore-example-v1
npm run capture -- --help
```

Quote paths that contain spaces. The runner intentionally prints captured evidence to standard output. Keep private input files in `localTests/` or outside the repository; `tests/` is public verification source.

## Library usage

After building, save the following as `investigate.mjs` in the repository root and run it with Node.js 24:

```js
import { createReadStream } from 'node:fs';
import {
  createEvidenceEngine,
  LocalEvidenceStorage,
} from './dist/src/index.js';

const storage = new LocalEvidenceStorage('./evidence-store');
const engine = createEvidenceEngine({ storage });

const manifest = await engine.compileRuntimeState(
  createReadStream('examples/runtime.json'),
  { adapterId: 'errorcore-example-v1' },
);

// Begin each debugging session with an overview.
const overview = await engine.getOverview(manifest.captureId);
const failure = overview.failures.find(
  (entry) => entry.operation.resolution === 'resolved',
);
const operation = overview.graph.operations.find(
  (entry) => entry.id === failure?.operation.operationId,
);

if (operation?.snapshotId) {
  const snapshot = await engine.inspectNode(operation.snapshotId);
  const child = snapshot.children[0];
  if (child) {
    const evidence = await engine.getEvidence(child.node.id);
    console.log(JSON.stringify(evidence, null, 2));
  }
}

await storage.verify(manifest.captureId);
```

The four operations are also exported directly from `src/index.ts`. Those exports share a lazy default store at `.errorcore-evidence`. Configured instances are preferable when applications need an explicit storage location or custom limits. Reopening the same store preserves capture IDs, evidence IDs and continuation cursors.

| Operation                              | Purpose                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `compileRuntimeState(input, options?)` | Validate and persist a binary JSON stream, then return a committed manifest.                    |
| `getOverview(captureId, options?)`     | Return recorded failure locations, a bounded execution graph and evidence references.           |
| `inspectNode(nodeId, options?)`        | Return node metadata and a bounded page of child structure.                                     |
| `getEvidence(nodeId, options?)`        | Return an observed scalar, text slice, collection references or explicit availability metadata. |

See the [API reference](docs/API.md) for contracts, limits, pagination and errors.

## How it works

1. **Validate and preserve.** The compiler accepts binary stream chunks, validates UTF-8 and JSON grammar, and stores the original bytes unchanged. It processes input with backpressure and does not parse the complete document into memory.
2. **Write structural evidence.** A versioned binary representation preserves value types, exact numeric lexemes, string code units, object-member order and duplicate keys. References address structural records rather than estimated offsets in the original JSON.
3. **Index progressively.** SQLite stores a shallow evidence index and adapter metadata. Inspection adds encountered nodes and child checkpoints to a separate mutable cache. Committed evidence remains unchanged.
4. **Construct supported relationships.** A selected schema adapter maps explicit operations, relationships, failure markers and availability metadata. Generic JSON produces no execution graph. Missing or ambiguous operation IDs remain explicit.
5. **Publish and retrieve.** Only fully validated captures are published through an atomic directory rename. Retrieval returns bounded projections with provenance and continuation cursors.

An overview identifies where failure was recorded. It does not determine the root cause. Sequence relationships remain sequence relationships; the engine does not convert temporal order into causation.

## Evidence semantics

| Availability              | Meaning                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `observed`                | A captured value is accessible. JSON `null` is an observed value.                                                  |
| `redacted`                | The source explicitly withheld a value. Only metadata is returned for that wrapper.                                |
| `truncated`               | The source explicitly captured a partial value. Available content remains accessible with incompleteness metadata. |
| `not_captured`            | The source explicitly states that capture did not occur.                                                           |
| `unknown` or `unresolved` | The source does not establish availability or a reference cannot be resolved.                                      |

Only a selected schema adapter interprets availability markers. A missing property does not imply `not_captured`, and a string such as `"[REDACTED]"` remains an ordinary string without schema support.

Numbers are returned as exact text with `encoding: "number-lexeme"`, preserving unsafe integers, negative zero and exponent formatting. Strings use bounded UTF-16 code-unit slices. Objects and arrays return ordered child references, preserving duplicate members without reconstructing the entire object. Every evidence result identifies its capture, structural record, path and provenance.

## Verification

```sh
npm run check
```

This command typechecks the library, examples, tests and benchmark sources; checks lint and formatting; runs the unit and integration suite; and builds and executes the investigation example. The tests cover structural boundaries, exact source bytes, availability states, graph provenance, pagination, invalid input, integrity checks, file-runner behavior, process interruption and restart.

| Command                             | Purpose                                                    |
| ----------------------------------- | ---------------------------------------------------------- |
| `npm run build`                     | Emit the library, declarations and examples under `dist/`. |
| `npm run typecheck`                 | Check all TypeScript sources without emitting files.       |
| `npm run lint`                      | Run ESLint and check formatting.                           |
| `npm test`                          | Build development sources and run the test suite.          |
| `npm run format`                    | Apply repository formatting.                               |
| `npm run benchmark -- --size=10mb`  | Generate and measure an exact 10 MiB synthetic capture.    |
| `npm run benchmark -- --size=100mb` | Generate and measure an exact 100 MiB synthetic capture.   |

The 2026-11-10 synthetic runs compiled 10 MiB in 0.510 seconds at 84.60 MiB peak RSS and 100 MiB in 3.427 seconds at 153.61 MiB peak RSS. The optional `--size=1gb` benchmark is available but has not been executed. Benchmarks generate input incrementally and run compilation and retrieval in separate processes. Results and generated stores remain under the ignored `.benchmark/` directory. See [benchmark methodology and measured results](benchmarks/RESULTS.md). Measurements describe the recorded synthetic workload and are not production capacity guarantees.

## Operational limits

- Retrieval defaults to a 64 KiB serialized JSON budget. The hard maximum is 1 MiB. Responses provide continuation metadata or fail explicitly if even a minimal record cannot fit.
- Ingestion defaults to 256 value levels, 64 KiB decoded keys and 256 KiB paths. These limits are configurable within documented hard ceilings.
- Structural records add disk overhead. Text-heavy benchmark captures use approximately 3.5 times the source size in immutable storage; workloads with many small values can require more.
- Synchronous structural and SQLite work can block the event loop. Uncached sibling scans and focused graph queries can be expensive.
- Local filesystem owners and adapter implementations are trusted. Process-crash publication is tested; portable power-loss durability is not guaranteed.
- Authentication, tenant isolation, automatic retention, remote storage and orphan-stage cleanup are outside the current implementation.

See [operations](docs/OPERATIONS.md) for storage, integrity verification and handling guidance.

## Documentation and contribution

- [Documentation index](docs/README.md)
- [API reference](docs/API.md)
- [Schema adapters](docs/ADAPTERS.md)
- [Architecture and storage format](docs/ARCHITECTURE.md)
- [Technical specification](docs/SPEC.md)
- [Implementation status and verification](docs/IMPLEMENTATION_PLAN.md)
- [Contribution guide](CONTRIBUTING.md)

No license has been selected. Public repository access does not grant a license to use, modify or distribute the code.
