import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  createEvidenceEngine,
  EvidenceError,
  LocalEvidenceStorage,
} from '../src/index.js';

const usage =
  'Usage: npm run capture -- <file.json> [--adapter=errorcore-example-v1]';

async function run(): Promise<void> {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs({
      options: {
        adapter: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch {
    throw new EvidenceError('INVALID_ARGUMENT');
  }
  if (args.values.help) {
    console.log(usage);
    return;
  }
  if (args.positionals.length !== 1)
    throw new EvidenceError('INVALID_ARGUMENT');
  const inputPath = resolve(args.positionals[0]!);
  if (!(await stat(inputPath)).isFile())
    throw new EvidenceError('INVALID_INPUT');
  const storageDirectory = resolve('.errorcore-evidence');
  const engine = createEvidenceEngine({
    storage: new LocalEvidenceStorage(storageDirectory),
  });
  const stream = createReadStream(inputPath);
  // Preserve asynchronous open/read errors until the compiler attaches its pipeline.
  stream.on('error', () => {});
  try {
    const manifest = await engine.compileRuntimeState(stream, {
      adapterId: args.values.adapter as string | undefined,
    });
    const overview = await engine.getOverview(manifest.captureId);
    const inspection = await engine.inspectNode(overview.rootEvidenceId, {
      limit: 10,
    });
    const selectedId =
      inspection.children[0]?.node.id ?? overview.rootEvidenceId;
    const evidence = await engine.getEvidence(selectedId, {
      limit: 10,
      sliceUnits: 1024,
    });
    console.log(
      JSON.stringify(
        { storageDirectory, manifest, overview, inspection, evidence },
        null,
        2,
      ),
    );
  } finally {
    stream.destroy();
  }
}

try {
  await run();
} catch (error) {
  const fileCode = (error as NodeJS.ErrnoException)?.code;
  const code =
    error instanceof EvidenceError
      ? error.code
      : fileCode === 'ENOENT'
        ? 'INPUT_FILE_NOT_FOUND'
        : fileCode === 'EACCES' || fileCode === 'EPERM'
          ? 'INPUT_FILE_UNREADABLE'
          : 'STORAGE_ERROR';
  console.error(JSON.stringify({ error: code }));
  if (code === 'INVALID_ARGUMENT') console.error(usage);
  process.exitCode = 1;
}
