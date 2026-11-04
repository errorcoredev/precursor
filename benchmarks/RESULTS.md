# Measured benchmark results

Measured 2026-11-04 on Windows 10.0.26300 x64, Node v24.22.2, Intel Core i7-11800H @ 2.30 GHz (16 logical CPUs), 25,597,108,224 bytes physical RAM. The store was on the local `D:` filesystem. Disk model/filesystem cache state were not controlled or measured.

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
| Compilation wall time              |        0.516 s |         3.378 s |
| Peak RSS                           |      82.81 MiB |      178.72 MiB |
| Sampled peak heap                  |      14.27 MiB |       40.08 MiB |
| Structural file bytes              |     23,856,152 |     238,558,460 |
| Immutable SQLite bytes             |      2,396,160 |      25,104,384 |
| Manifest bytes                     |            950 |             971 |
| Mutable retrieval cache bytes      |         16,384 |          16,384 |
| Total immutable storage / source   |         3.504× |          3.514× |
| Overview response bytes            |         55,232 |          55,522 |
| Cold overview                      |       33.10 ms |        33.45 ms |
| First uncached snapshot inspection |       14.27 ms |        12.36 ms |
| First text evidence page           |        3.74 ms |         3.31 ms |
| Warm overview median / p95         | 8.70 / 9.86 ms |  8.63 / 9.65 ms |
| Cached inspection median / p95     | 3.38 / 4.31 ms |  3.38 / 3.76 ms |
| Cached evidence median / p95       | 2.78 / 3.47 ms |  2.86 / 3.04 ms |

All initial targets passed on this workload: 100 MiB peak RSS below 256 MiB, warm overview below 100 ms, and cached inspection/evidence below 50 ms. This table records the final compilation run for each size, with 20 warm retrieval samples; it does not establish a universal throughput or memory bound. Earlier implementation runs showed variation in latency and RSS, so these values should be treated as local workload measurements.

Storage overhead is substantial: the structural format preserves UTF-16 string data and a 64-byte header per value, while SQLite stores semantic references and their provenance. Captures dominated by tiny numbers/booleans can have a much larger representation/source ratio than these text-heavy snapshots. The sparse index avoids database rows for every array value, but does not avoid structural records on disk. Long uncached sibling scans, dense graphs, deep paths, and focus queries were not comprehensively benchmarked.

Raw evidence of these measurements is retained in [10mb.json](results/10mb.json) and [100mb.json](results/100mb.json), including hashes, exact timestamps and all reported fields. Benchmark data directories are ignored by Git.

The **1 GiB run was not executed**. It uses the same incremental generator and isolated worker flow:

```powershell
npm.cmd run benchmark -- --size=1gb
```

It requires room for the generated input, preserved source, structural representation, semantic database and staging overhead. Production-schema performance remains unmeasured because no production schema or captures were supplied.
