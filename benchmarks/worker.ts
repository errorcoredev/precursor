import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { createEvidenceEngine, LocalEvidenceStorage } from '../src/index.js';

const [mode, directory, input] = process.argv.slice(2);
if (!directory || !input) throw new Error('Missing benchmark arguments');
const storage = new LocalEvidenceStorage(directory);
const engine = createEvidenceEngine({ storage });

async function measure<T>(
  fn: () => Promise<T>,
): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
}
if (mode === 'compile') {
  const start = performance.now();
  const manifest = await engine.compileRuntimeState(
    createReadStream(input, { highWaterMark: 65536 }),
    { adapterId: 'errorcore-example-v1' },
  );
  const wallMs = performance.now() - start;
  const files = await storage.open(manifest.captureId);
  const sqliteBytes = (await stat(files.database)).size;
  const manifestBytes = (await stat(files.manifest)).size;
  process.send?.({
    manifest,
    wallMs,
    peakRssBytes: process.resourceUsage().maxRSS * 1024,
    sqliteBytes,
    manifestBytes,
  });
} else if (mode === 'retrieve') {
  const coldOverview = await measure(() => engine.getOverview(input));
  const capture = coldOverview.value;
  const snapshotId = capture.graph.operations[0]!.snapshotId!;
  const uncachedInspect = await measure(() => engine.inspectNode(snapshotId));
  const detail = uncachedInspect.value.children.find(
    (c) => c.node.key?.preview === 'detail',
  )!.node.id;
  const coldEvidence = await measure(() => engine.getEvidence(detail));
  const timings = {
    overview: [] as number[],
    inspect: [] as number[],
    evidence: [] as number[],
  };
  for (let i = 0; i < 20; i++) {
    timings.overview.push((await measure(() => engine.getOverview(input))).ms);
    timings.inspect.push(
      (await measure(() => engine.inspectNode(snapshotId))).ms,
    );
    timings.evidence.push((await measure(() => engine.getEvidence(detail))).ms);
  }
  const stats = (values: number[]) => {
    values.sort((a, b) => a - b);
    return {
      medianMs: values[Math.floor(values.length / 2)],
      p95Ms: values[Math.ceil(values.length * 0.95) - 1],
      samples: values.length,
    };
  };
  const files = await storage.open(input);
  process.send?.({
    coldOverviewMs: coldOverview.ms,
    uncachedInspectMs: uncachedInspect.ms,
    coldEvidenceMs: coldEvidence.ms,
    warmOverview: stats(timings.overview),
    cachedInspect: stats(timings.inspect),
    cachedEvidence: stats(timings.evidence),
    cacheBytes: (await stat(files.cache)).size,
    overviewBytes: Buffer.byteLength(JSON.stringify(capture)),
  });
} else throw new Error('Unknown benchmark mode');
process.disconnect?.();
