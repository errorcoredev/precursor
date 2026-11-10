# Operations

Precursor stores evidence on a local filesystem in the current implementation. Applications configure a storage root and control access to that directory. The library provides no authentication, tenancy or network service.

## Storage layout

```text
<storage root>/
  cursor.key
  staging/<capture UUID>/
  captures/<capture UUID>/
    source.json
    structure.bin
    evidence.sqlite
    manifest.json
  cache/<capture UUID>.sqlite
```

`source.json` contains the exact received bytes. `structure.bin` contains the versioned structural representation. `evidence.sqlite` contains semantic records and the initial sparse index. The manifest records versions, sizes, hashes, counts and metrics. These committed files are immutable through the API.

The mutable cache stores encountered evidence nodes and child checkpoints. It is separate from committed evidence. `cursor.key` signs continuation cursors; retain it when moving or backing up a store if existing cursors must remain valid.

## Publication and interruption

Compilation writes to an internally generated staging directory. It validates the complete stream, flushes source and structural files, commits and closes SQLite, writes and flushes the manifest, then renames the directory into `captures` on the same filesystem.

Public retrieval opens only committed capture directories. Invalid JSON, adapter rejection, cancellation and ordinary storage errors do not publish a successful capture. A process killed before publication can leave an orphan staging directory. Automatic orphan cleanup is not implemented. Confirm no ingestion is using a stage before performing any manual removal.

The atomic rename is the publication boundary. Cancellation that races this boundary cannot revoke a completed capture. Process interruption and fresh-process recovery are tested. Portable durability after hardware failure or power loss is not guaranteed on every filesystem.

## Integrity and backup

Normal retrieval checks sizes, format versions and structural boundaries. Run `LocalEvidenceStorage.verify(captureId)` when full content verification is needed. It reads the three immutable data files and compares their SHA-256 hashes with the manifest. This is a linear read of the stored representations.

Filesystem owners remain trusted. The manifest is not externally signed, and ordinary retrieval does not detect every same-size modification. Protect the store using the surrounding application's filesystem permissions and access policy.

A backup should preserve complete committed capture directories and `cursor.key`. Coordinate backup with ingestion and retrieval if taking a filesystem-wide snapshot that includes mutable caches or staging files. Validate restored captures before serving them. The library does not implement retention or deletion policies.

## Resource planning

- Reserve disk space for the original input, structural representation, semantic database and any generated input file used by benchmarks.
- Structural records require a 64-byte header per value plus keys and scalar data. Strings use UTF-16LE. Small-value workloads may have considerably greater overhead than text-heavy captures.
- Ingestion buffers are bounded, but caller-owned stream chunks remain outside that guarantee. Configure an input-byte limit with `CompileOptions.maxBytes` where appropriate.
- Default nesting, key/path and output limits are documented in the [API reference](API.md). Exceeding a limit fails explicitly.
- Node's synchronous structural and SQLite operations can block the event loop. Applications requiring responsiveness under load should evaluate worker or process isolation.
- First uncached node access may scan preceding siblings. Focused graph projections and large offsets can scan or sort persisted records. Bounded memory does not imply constant query latency.

The [benchmark report](../benchmarks/RESULTS.md) documents the measured synthetic workload, storage overhead and limitations. It does not establish production capacity.

## Input and output handling

Input must already have undergone the upstream handling required by the application. Precursor performs no redaction, masking or secret detection. It preserves input bytes exactly, and only the selected adapter interprets explicit availability metadata.

Routine library errors and metrics exclude raw source values. The file runner and investigation example intentionally print evidence to standard output. Treat their output according to the capture's handling requirements.

Keep private inputs in `localTests/` or outside the repository. Default generated stores and benchmark directories are ignored by Git. A custom store path may require an additional ignore rule.

## Versioning and integration

The current persisted format version is 1. Unsupported formats fail explicitly; no storage migration tool is included. Back up evidence before changing storage-format code.

`EvidenceStorage` abstracts staging, publication, opening and cursor-key access, but currently exposes materialized local filenames. Remote object storage would require local staging/materialization, and a Postgres metadata backend would require replacing SQLite-specific helpers and queries. Neither backend is implemented.

The next schema integration step is to provide a real production adapter and sanitized fixtures using the [adapter contract](ADAPTERS.md). The generic and illustrative adapters do not establish the shape or completeness of a production runtime capture.
