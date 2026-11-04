import { fork } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { cpus, platform, release, totalmem, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './generate.js';
import type { EvidenceManifest } from '../src/index.js';

const sizeArg =
  process.argv.find((arg) => arg.startsWith('--size='))?.slice(7) ?? '10mb';
const sizes: Record<string, number> = {
  '10mb': 10 * 1024 ** 2,
  '100mb': 100 * 1024 ** 2,
  '1gb': 1024 ** 3,
};
const size = sizes[sizeArg];
if (!size) throw new Error('Use --size=10mb|100mb|1gb');
await mkdir(resolve('.benchmark'), { recursive: true });
const directory = await mkdtemp(join(resolve('.benchmark'), `${sizeArg}-`));
const input = join(directory, 'input.json');
const generated = await generate(input, size);
const worker = fileURLToPath(new URL('./worker.js', import.meta.url));
async function run<T>(mode: string, arg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = fork(worker, [mode, join(directory, 'store'), arg], {
      stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    });
    let result: T | undefined;
    child.on('message', (message) => {
      result = message as T;
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 && result !== undefined
        ? resolve(result)
        : reject(new Error('Benchmark child failed')),
    );
  });
}
const compilation = await run<{
  manifest: EvidenceManifest;
  wallMs: number;
  peakRssBytes: number;
  sqliteBytes: number;
  manifestBytes: number;
}>('compile', input);
const retrieval = await run<Record<string, unknown>>(
  'retrieve',
  compilation.manifest.captureId,
);
const result = {
  measuredAt: new Date().toISOString(),
  requestedSize: sizeArg,
  generated,
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    logicalCpus: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  compilation,
  retrieval,
  overhead: {
    sourceBytes: compilation.manifest.source.bytes,
    structuralBytes: compilation.manifest.structure.bytes,
    semanticIndexBytes: compilation.sqliteBytes,
    storageRatio:
      (compilation.manifest.source.bytes +
        compilation.manifest.structure.bytes +
        compilation.sqliteBytes +
        compilation.manifestBytes) /
      compilation.manifest.source.bytes,
  },
  notes: [
    'Cold means a fresh process with no lazy index, not flushed OS disk caches.',
    'Peak RSS is process.resourceUsage().maxRSS; heap is sampled once per input segment.',
    'Synthetic runtime snapshots; production-schema integration remains outstanding.',
  ],
};
await writeFile(
  join(directory, 'result.json'),
  JSON.stringify(result, null, 2),
);
await mkdir(resolve('benchmarks/results'), { recursive: true });
await writeFile(
  resolve(`benchmarks/results/${sizeArg}.json`),
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
console.log(`Benchmark artifacts retained at ${directory}`);
