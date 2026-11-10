# Measured benchmark results

Measured 2026-11-10 on Windows 10.0.26300 x64, Node v24.22.2, Intel Core i7-11800H @ 2.30 GHz (16 logical CPUs), 25,597,108,224 bytes physical RAM. Disk model and filesystem cache state were not controlled or measured.

Commands executed against the delivered implementation:

```powershell
npm.cmd run benchmark -- --size=10mb
npm.cmd run benchmark -- --size=100mb
```

Each fixture is generated incrementally to an exact byte count. Each operation contains a request snapshot, 24 array values, about 8 KiB of captured text, correlation metadata, and an explicit upstream redaction wrapper. Relationships are explicit awaits between successive operation IDs; one failure record identifies the last operation. A final observed padding string makes the size exact. No whole-document JSON object or large fixture buffer is allocated.

Compilation and retrieval run in separate Node child processes. Wall time covers compilation through publication, including validation, both representation writes, graph resolution, hashing and fsync. Fixture generation is excluded. Peak RSS uses `process.resourceUsage().maxRSS`; heap is sampled once per input segment and may miss brief peaks. The retrieval process starts without a lazy index. "Cold" means process/cache cold, **not** a flushed operating-system page cache. Warm measurements are 20 sequential calls and include opening/closing the storage handles for each API call.

| Measurement                        |         10 MiB |         100 MiB |
| ---------------------------------- | -------------: | --------------: |
| Exact input bytes                  |     10,485,760 |     104,857,600 |
| Operations / relationships         |  1,172 / 1,171 | 11,720 / 11,719 |
| Structural values                  |         50,402 |         503,966 |
| Compilation wall time              |        0.510 s |         3.427 s |
| Peak RSS                           |      84.60 MiB |      153.61 MiB |
| Sampled peak heap                  |      14.43 MiB |       25.56 MiB |
| Structural file bytes              |     23,856,152 |     238,558,460 |
| Immutable SQLite bytes             |      2,396,160 |      25,104,384 |
| Manifest bytes                     |            960 |             962 |
| Mutable retrieval cache bytes      |         16,384 |          16,384 |
| Total immutable storage / source   |         3.504× |          3.514× |
| Overview response bytes            |         55,232 |          55,522 |
| Cold overview                      |       31.94 ms |        37.74 ms |
| First uncached snapshot inspection |       11.47 ms |        13.63 ms |
| First text evidence page           |        3.23 ms |         3.50 ms |
| Warm overview median / p95         | 8.56 / 9.39 ms |  8.91 / 9.47 ms |
| Cached inspection median / p95     | 3.44 / 3.82 ms |  3.67 / 4.15 ms |
| Cached evidence median / p95       | 2.72 / 3.13 ms |  2.88 / 3.27 ms |

All initial targets passed on this workload: 100 MiB peak RSS below 256 MiB, warm overview below 100 ms, and cached inspection/evidence below 50 ms. This table records the final compilation run for each size, with 20 warm retrieval samples; it does not establish a universal throughput or memory bound. Earlier implementation runs showed variation in latency and RSS, so these values should be treated as local workload measurements.

Storage overhead is substantial: the structural format preserves UTF-16 string data and a 64-byte header per value, while SQLite stores semantic references and their provenance. Captures dominated by tiny numbers/booleans can have a much larger representation/source ratio than these text-heavy snapshots. The sparse index avoids database rows for every array value, but does not avoid structural records on disk. Long uncached sibling scans, dense graphs, deep paths, and focus queries were not comprehensively benchmarked.

The reviewed synthetic measurement reports are included at [10 MiB](reports/2026-11-10-10mb.json) and [100 MiB](reports/2026-11-10-100mb.json), including hashes, timestamps and all reported fields. New runs write `result.json` alongside generated input and storage under `.benchmark/<size>-<generated suffix>/`. This working directory is ignored by Git; runs do not overwrite the published reports.

The **1 GiB run was not executed**. It uses the same incremental generator and isolated worker flow:

```powershell
npm.cmd run benchmark -- --size=1gb
```

It requires room for the generated input, preserved source, structural representation, semantic database and staging overhead. Production-schema performance remains unmeasured because no production schema or captures were supplied.
