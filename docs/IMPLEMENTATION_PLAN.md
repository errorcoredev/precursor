# Implementation checklist

- [x] Read AGENTS.md; inspect existing repository and tooling (no implementation/schema).
- [x] Write initial specification before application code.
- [x] Pin Node 24/tooling/dependencies; strict ESM TypeScript and npm scripts.
- [x] Domain types, safe errors/limits/IDs, adapter/storage contracts.
- [x] SQLite staging/atomic commit, persisted cursor key and sparse cache.
- [x] Binary structural writer/reader, strict streaming validation and compiler.
- [x] Generic and illustrative streaming adapters; graph resolution.
- [x] Bounded overview/inspection/evidence, authenticated continuations.
- [x] Unit/integration fixtures, failure injection, crash/restart and boundary tests.
- [x] Executable progressive-retrieval example and generic flow.
- [x] Incremental isolated 10 MiB and 100 MiB benchmarks; optional 1 GiB command.
- [x] Run build/typecheck/lint/tests/example; fix defects; record actual results.
- [x] Final README, architecture, contracts, limitations and integration instructions.

## Decisions and deviations

### Follow-up: run a caller-selected JSON file

- [x] Specify a generic file runner before changing implementation.
- [x] Add `npm run capture -- <file.json>` with explicit optional adapter selection and bounded terminal output.
- [x] Document the `test.json` workflow and verify a separate fixture, primitive/empty input, illustrative graph input, and invalid/missing files.
- [x] Run relevant checks and record results. Core storage/parser benchmarks are unchanged by this CLI-only addition.
- [x] Ignore and untrack local tests/benchmarks while preserving their files; isolate their build configuration from the public build.
- [x] Verify the public build/example without local verification assets, then commit public-facing changes only.

The local file-runner smoke check passed 12 cases, including quoted paths, primitive/empty inputs, explicit example-adapter selection and safe errors. The user's `tests/fixtures/test.json` compiled successfully (31,656 bytes, 839 indexed structural values) in generic mode; output is local at `.benchmark/test-file-output.txt`. The 41 existing tests passed after adding the runner. Test and benchmark sources/results are retained locally but removed from current Git tracking; earlier commit history is preserved.

Final verification passed: `npm test` (41 tests), `npm run lint`, `npm run typecheck`, 12 CLI smoke checks, and a separate checkout of the staged public files with no tests/benchmarks/local configurations. That checkout built successfully, ran the demo including fresh-process retrieval, and compiled the chosen external `test.json`. Git ignore checks confirm that local inputs, benchmark results, local configurations and terminal output are excluded. Verification files remain on disk.

- Host default Node is 22.14.0; verification uses the local pinned Node 24.22.2 binary without changing the machine-wide installation.
- SQLite is Node's built-in `node:sqlite`; semantic evidence is separate from mutable lazy-index caches.
- stream-json 3.8.0 is pinned, using `parser.asStream` plus `verifier.asStream`, both with packing disabled where applicable. Initial older tool pins were replaced before delivery; the runtime dependency audit reports zero vulnerabilities.
- One staging SQLite transaction and a 2 MiB configured page cache replace a JavaScript batch queue. Each semantic write completes synchronously before accepting the next token. Temporary graph resolution tables use disk-backed SQLite temporary storage.
- Pointer ambiguity is conservative: paths containing object members report `possible`; exact occurrence identity is always the node ID/member ordinal. Avoiding a global object-key table preserves sparse indexing.
- Observed/truncated availability wrappers return a reference to their explicit `value` member. Source incompleteness follows that reference and its descendants. Inspection still exposes original source members; no incoming bytes are hidden or altered by this library.
- Overview `endCursor` preserves each lane's consumed position even after exhaustion; `nextCursor` remains absent at the end. Cursor query bindings include depth/part/focus, but permit changing page size and output budget.
- Structural parent/path/ordinal metadata has `derived_structure` provenance separate from value observations and adapter metadata.
- Integrity checksums cover source, structural representation and semantic SQLite database. `LocalEvidenceStorage.verify()` opts into a full read; ordinary retrieval verifies sizes/format and uses trusted local immutable files.
- Tests: 41 passing in 5 source test files as of the last implementation run. Vitest explicitly excludes compiled test copies.
- Initial and final 10 MiB/100 MiB runs use real isolated child processes; machine-readable final results are in `benchmarks/results`. The optional 1 GiB run has not been executed.

## Recorded verification

- `npm test`: 41 passing tests in 5 source files; the command builds first.
- `npm run typecheck`: passed.
- `npm run lint`: ESLint and Prettier passed.
- `npm run example`: passed, including observed/redacted evidence, generic graph absence, bounded inspection and a fresh process.
- `npm.cmd run benchmark -- --size=10mb`: 10,485,760 exact bytes, 0.516 s, 82.81 MiB peak RSS.
- `npm.cmd run benchmark -- --size=100mb`: 104,857,600 exact bytes, 3.378 s, 178.72 MiB peak RSS; warm overview median 8.63 ms, cached inspection 3.38 ms, cached evidence 2.86 ms.
- `npm audit --omit=dev --json`: zero findings. Full `npm audit` reports 10 moderate development-tool findings stemming from minimatch through ESLint/typescript-eslint; this advisory remains in the pinned tooling dependency tree. No high/critical findings remain.

## Remaining integration work and limitations

- Add the real production schema adapter and production fixtures when supplied. The example adapter is intentionally synthetic.
- The 1 GiB benchmark is available but unrun; no 1 GiB result or production capacity claim is made.
- Filesystem owners/adapters are trusted. Process-crash atomicity is tested; cross-platform power-loss guarantees and hostile filesystem tampering are outside this implementation.
- An uncached arbitrary node can require a sibling scan, focused graph queries can sort large sets, and synchronous work can block the event loop. Storage overhead on the measured fixture is approximately 3.5 times source bytes; tiny-value workloads can cost more.
- Pointer ambiguity is conservatively marked, not globally deduplicated. Source operation IDs over 1,024 UTF-16 units remain unresolved but fully accessible by evidence reference.
- Orphan staging directories can remain after process termination; automatic recovery cleanup is not implemented.
