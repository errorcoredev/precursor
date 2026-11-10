# Implementation plan

This checklist records the implementation and the work required for a reproducible public repository. The [specification](SPEC.md) defines behavioral requirements.

## Engine implementation

- [x] Implement strict streaming JSON and UTF-8 validation with backpressure.
- [x] Preserve original bytes and publish validated captures atomically.
- [x] Persist structural records, semantic metadata and a sparse evidence index.
- [x] Implement generic JSON and illustrative Errorcore schema adapters.
- [x] Resolve source operation IDs and preserve unresolved or ambiguous endpoints.
- [x] Expose overview, inspection and evidence retrieval with bounded responses.
- [x] Authenticate continuation cursors and validate caller-controlled identifiers.
- [x] Provide executable investigation and file ingestion examples.
- [x] Implement structural, semantic, failure, integrity and restart tests.
- [x] Provide incremental 10 MiB, 100 MiB and optional 1 GiB benchmarks.

## Public repository preparation

- [x] Inspect tracked files, implementation, verification assets and Git remote.
- [x] Update the specification and this plan before implementation changes.
- [x] Include synthetic verification sources and configurations in the public checkout.
- [x] Preserve private captures locally and exclude generated artifacts.
- [x] Consolidate the synthetic fixture and clarify public API comments.
- [x] Add CLI regression coverage and Windows/Linux CI configuration.
- [x] Rewrite public documentation and contribution guidance.
- [x] Complete package metadata and document the existing unlicensed status.
- [x] Run checks, the executable example and 10 MiB/100 MiB benchmarks.
- [x] Verify a clean checkout containing only publication files.
- [x] Review publication files for GitHub delivery.

## Acceptance criteria

A fresh checkout must support every documented npm command using Node.js 24. Synthetic tests and examples must not depend on private captures. Public documentation must link to shipped resources and describe API contracts, evidence semantics, pagination, storage guarantees, resource limits and remaining integration work. Prose must contain no emojis or em dashes.

The cleanup preserves the storage format, evidence semantics and four public operations. It does not add root-cause analysis, redaction, hosted infrastructure or a production capture schema. Publishing repository contents does not authorize an npm release or a Git history rewrite.

## Verification record

Verification performed on 2026-11-10 using the pinned Node.js 24.22.2 runtime on Windows:

- `npm run check`: passed typechecking, ESLint, Prettier, 53 tests across six files and the executable example. The example retrieved observed/redacted evidence, demonstrated generic graph absence and reopened committed storage in a fresh process.
- `npm run benchmark -- --size=10mb`: 10,485,760 source bytes, 0.510 seconds compilation, 84.60 MiB peak RSS.
- `npm run benchmark -- --size=100mb`: 104,857,600 source bytes, 3.427 seconds compilation, 153.61 MiB peak RSS; warm overview median 8.91 ms.
- The [benchmark report](../benchmarks/RESULTS.md) includes methodology, retrieval timings, storage overhead and reviewed machine-readable reports.
- Publication review: all local Markdown links resolve to tracked files; no emojis, em dashes, private capture inputs, local agent instructions or generated stores are included.
- `npm audit --omit=dev --json`: zero findings. Full `npm audit --json`: nine moderate development-tool findings associated with minimatch through ESLint and typescript-eslint; no high or critical findings. npm proposes major-version changes for a full remediation. No forced dependency downgrade or override was applied.

An isolated checkout of the publication files passed `npm ci --no-audit --no-fund` and `npm run check`, including all 53 tests. The README's JavaScript example was extracted and executed successfully in that checkout, including full integrity verification. These checks used no private captures, original build output or original installed dependencies. Windows/Linux CI is configured; hosted results are available through the repository's Actions page after publication.

## Remaining integration work

- Implement a production schema adapter using real schema documentation and sanitized fixtures.
- Run the optional 1 GiB benchmark before making any capacity claim for that size.
- Assess uncached sibling scans, focused graph queries and event-loop blocking against application requirements.
- Define application-level access control, retention and backup policies outside this library.
- Filesystem owners and adapter implementations remain trusted. Portable power-loss durability and automatic orphan-stage cleanup are not implemented.
