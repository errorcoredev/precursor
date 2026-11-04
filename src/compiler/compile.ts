import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { performance } from 'node:perf_hooks';
import { parser } from 'stream-json/parser.js';
import { verifier } from 'stream-json/utils/verifier.js';
import { EvidenceError, fail, integer, nodeId, safeError } from '../errors.js';
import { bounded } from '../limits.js';
import { StructureWriter, type Token } from '../indexing/writer.js';
import { count, createDatabase, semanticSink } from '../storage/database.js';
import type { EvidenceStorage } from '../storage/contracts.js';
import { resolveGraph } from '../graph/resolve.js';
import type {
  AvailabilityStatus,
  CaptureSchemaAdapter,
  CompileOptions,
  EvidenceManifest,
  Limits,
} from '../types/index.js';
import { hashFile } from '../storage/integrity.js';

export async function compile(
  input: Readable,
  options: CompileOptions,
  storage: EvidenceStorage,
  adapter: CaptureSchemaAdapter,
  limits: Limits,
): Promise<EvidenceManifest> {
  if (!(input instanceof Readable) || input.readableEncoding !== null)
    fail('INVALID_INPUT');
  const maxBytes = integer(
    options.maxBytes,
    Number.MAX_SAFE_INTEGER,
    1,
    Number.MAX_SAFE_INTEGER,
  );
  if (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    fail('INVALID_ARGUMENT');
  if (options.signal?.aborted) fail('ABORTED');
  const started = performance.now();
  await storage.cursorKey();
  const stage = await storage.stage();
  let db: ReturnType<typeof createDatabase> | undefined;
  let source: Awaited<ReturnType<typeof open>> | undefined;
  let structure: StructureWriter | undefined;
  const validation = verifier.asStream({ ignoreBOM: true });
  validation.on('error', () => {});
  validation.resume();
  let peakHeap = process.memoryUsage().heapUsed;
  let peakRss = process.memoryUsage().rss;
  let bytes = 0;
  const hash = createHash('sha256');
  try {
    db = createDatabase(stage.database);
    db.exec('BEGIN');
    const index = db.prepare('INSERT OR IGNORE INTO nodes VALUES (?)');
    const session = adapter.create({
      captureId: stage.captureId,
      emit: semanticSink(db),
    });
    structure = new StructureWriter(
      stage.structure,
      limits,
      session,
      (offset) => {
        index.run(offset);
      },
    );
    source = await open(stage.source, 'wx', 0o600);
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const sourceFile = source;
    async function* chunks(): AsyncGenerator<Buffer> {
      try {
        for await (const raw of input) {
          if (!(raw instanceof Uint8Array)) fail('INVALID_INPUT');
          const buffer = Buffer.from(
            raw.buffer,
            raw.byteOffset,
            raw.byteLength,
          );
          for (let start = 0; start < buffer.length; start += 65536) {
            if (options.signal?.aborted) fail('ABORTED');
            const piece = buffer.subarray(start, start + 65536);
            bytes += piece.length;
            if (!Number.isSafeInteger(bytes) || bytes > maxBytes)
              fail('RESOURCE_LIMIT');
            try {
              decoder.decode(piece, { stream: true });
            } catch {
              fail('INVALID_JSON');
            }
            await new Promise<void>((resolve, reject) =>
              validation.write(piece, (error) =>
                error ? reject(new EvidenceError('INVALID_JSON')) : resolve(),
              ),
            );
            try {
              let written = 0;
              while (written < piece.length)
                written += (
                  await sourceFile.write(piece, written, piece.length - written)
                ).bytesWritten;
            } catch {
              fail('STORAGE_ERROR');
            }
            hash.update(piece);
            const memory = process.memoryUsage();
            peakHeap = Math.max(peakHeap, memory.heapUsed);
            peakRss = Math.max(peakRss, memory.rss);
            yield piece;
          }
        }
        try {
          decoder.decode();
        } catch {
          fail('INVALID_JSON');
        }
        const verified = finished(validation);
        validation.end();
        try {
          await verified;
        } catch {
          fail('INVALID_JSON');
        }
      } catch (error) {
        throw safeError(error, 'INVALID_INPUT');
      }
    }
    const structuralWriter = structure;
    const sink = new Writable({
      objectMode: true,
      highWaterMark: 16,
      write(token: Token, _encoding, callback) {
        try {
          structuralWriter.accept(token);
          callback();
        } catch (error) {
          callback(safeError(error, 'STORAGE_ERROR'));
        }
      },
    });
    try {
      await pipeline(
        Readable.from(chunks()),
        parser.asStream({
          packValues: false,
          streamValues: true,
          ignoreBOM: true,
        }),
        sink,
        { signal: options.signal },
      );
    } catch (error) {
      if (options.signal?.aborted) fail('ABORTED');
      throw safeError(error, 'INVALID_JSON');
    }
    structure.finish();
    await source.sync();
    await source.close();
    source = undefined;
    resolveGraph(db);
    const counts = {
      nodes: structure.nodeCount,
      operations: count(db, 'operations'),
      relationships: count(db, 'relationships'),
      failures: count(db, 'failures'),
    };
    const unresolved = db
      .prepare(
        "SELECT COALESCE(SUM((from_state!='resolved')+(to_state!='resolved')),0) AS n FROM relationships",
      )
      .get() as { n: number };
    const availabilityCounts: Partial<Record<AvailabilityStatus, number>> = {};
    for (const row of db
      .prepare('SELECT status,COUNT(*) AS n FROM availability GROUP BY status')
      .all() as { status: AvailabilityStatus; n: number }[])
      availabilityCounts[row.status] = row.n;
    db.exec('COMMIT');
    db.close();
    db = undefined;
    const structureHash = await hashFile(stage.structure);
    const databaseHash = await hashFile(stage.database);
    const databaseBytes = (await stat(stage.database)).size;
    const manifest: EvidenceManifest = {
      formatVersion: 1,
      captureId: stage.captureId,
      adapterId: adapter.id,
      createdAt: new Date().toISOString(),
      rootEvidenceId: nodeId(stage.captureId, 16),
      source: { file: 'source.json', bytes, sha256: hash.digest('hex') },
      structure: {
        file: 'structure.bin',
        bytes: structure.size,
        sha256: structureHash,
      },
      database: {
        file: 'evidence.sqlite',
        bytes: databaseBytes,
        sha256: databaseHash,
      },
      counts,
      availabilityCounts,
      captureComplete: true,
      graphCompleteness:
        adapter.id === 'generic-json' ? 'unavailable' : 'partial',
      unresolvedGraphEndpoints: unresolved.n,
      metrics: {
        durationMs: performance.now() - started,
        sourceBytes: bytes,
        structuralBytes: structure.size,
        nodeCount: structure.nodeCount,
        maxDepth: structure.maxDepth,
        peakRssBytes: Math.max(peakRss, process.resourceUsage().maxRSS * 1024),
        peakHeapBytes: peakHeap,
      },
    };
    bounded(manifest, limits.outputBytes);
    if (options.signal?.aborted) fail('ABORTED');
    await storage.commit(stage, manifest);
    return manifest;
  } catch (error) {
    input.destroy();
    validation.destroy();
    try {
      structure?.abort();
    } catch {
      /* Preserve the original failure. */
    }
    try {
      if (db) db.close();
    } catch {
      /* The stage is not published. */
    }
    try {
      await source?.close();
    } catch {
      /* Best-effort cleanup. */
    }
    try {
      await storage.discard(stage);
    } catch {
      /* An orphan stage remains invisible. */
    }
    throw safeError(error, 'STORAGE_ERROR');
  }
}
