# Contributing to Precursor

Precursor is an in-process evidence engine. Contributions should preserve deterministic access to captured facts, explicit availability semantics, bounded retrieval and immutable committed evidence.

## Development setup

Use Node.js 24 with the version specified in `.node-version`.

```sh
npm ci
npm run check
```

`npm run check` typechecks all TypeScript sources, checks lint and formatting, runs tests, builds the public library and executes the investigation example. CI is configured to run this command on Windows and Linux. Large benchmarks run separately.

## Repository layout

| Directory        | Responsibility                                                 |
| ---------------- | -------------------------------------------------------------- |
| `src/compiler/`  | Streaming validation, ingestion and commit orchestration.      |
| `src/indexing/`  | Binary structural records, readers and writers.                |
| `src/storage/`   | Filesystem staging, publication, SQLite and integrity checks.  |
| `src/adapters/`  | Schema-specific interpretation of explicit source metadata.    |
| `src/graph/`     | Resolution and ordering of source-supported graph records.     |
| `src/retrieval/` | Bounded overview, inspection and evidence responses.           |
| `src/types/`     | Public contracts and adapter interfaces.                       |
| `examples/`      | Executable workflows and the shared synthetic capture.         |
| `tests/`         | Unit and integration verification using synthetic inputs.      |
| `benchmarks/`    | Incremental capture generation and isolated measurement tools. |
| `docs/`          | Public design, API and operational documentation.              |

## Making a change

1. Read the specification and relevant implementation before editing code.
2. Update `docs/SPEC.md` and `docs/IMPLEMENTATION_PLAN.md` before implementation changes.
3. Keep changes focused. Preserve the public contract unless a documented change is intentional.
4. Add regression coverage when behavior changes. Use synthetic inputs and include boundary cases relevant to the change.
5. Run `npm run format`, then `npm run check`.
6. Run the 10 MiB and 100 MiB benchmarks when changing parsing, indexing, graph processing, storage or retrieval performance. Report actual measurements and the environment.
7. Update affected documentation and record verification results.

Describe the problem, resulting behavior and validation in the pull request. State any untested behavior or remaining limitation explicitly.

## Evidence requirements

- Preserve received JSON bytes exactly. Do not add redaction, masking or secret detection.
- Keep observed `null`, unavailable values and unresolved references distinct.
- Construct graph records only from explicit source execution metadata.
- Preserve provenance and resolvable references for returned evidence.
- Maintain bounded buffers, backpressure, output budgets and continuation behavior.
- Do not log raw capture values in routine library paths or error messages.
- Use the adapter boundary for schema-specific behavior.

Private capture files belong in `localTests/` or outside the repository. Do not attach private captures, generated stores, environment files or captured terminal output to commits or public issues. The command-line examples deliberately print evidence when run.

## Documentation style

Use formal, direct language. Describe implemented behavior and its limitations. Do not use emojis or em dashes. Keep installation steps platform-neutral, identify Windows-specific commands where needed, and link only to resources included in the repository or available publicly.

## Licensing

No repository license has been selected. Maintainers must establish the intended license and contribution terms before accepting external code for redistribution. The package remains private to npm; this repository does not define a release process.
