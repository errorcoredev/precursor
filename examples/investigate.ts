import { createReadStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import {
  createEvidenceEngine,
  LocalEvidenceStorage,
  type EvidenceEngine,
  type EvidenceNodeView,
} from '../src/index.js';

async function named(
  engine: EvidenceEngine,
  view: EvidenceNodeView,
  key: string,
): Promise<EvidenceNodeView> {
  const child = view.children.find((child) => child.node.key?.preview === key);
  if (!child) throw new Error('Example fixture is missing a member');
  return engine.inspectNode(child.node.id);
}

if (process.argv[2] === '--reopen') {
  const engine = createEvidenceEngine({
    storage: new LocalEvidenceStorage(process.argv[3]!),
  });
  const overview = await engine.getOverview(process.argv[4]!);
  const result = await engine.getEvidence(process.argv[5]!);
  console.log(
    JSON.stringify(
      { freshProcess: true, captureId: overview.captureId, result },
      null,
      2,
    ),
  );
} else {
  const directory = await mkdtemp(join(tmpdir(), 'errorcore-example-'));
  const engine = createEvidenceEngine({
    storage: new LocalEvidenceStorage(directory),
  });
  const manifest = await engine.compileRuntimeState(
    createReadStream(resolve('tests/fixtures/runtime.json')),
    { adapterId: 'errorcore-example-v1' },
  );
  const overview = await engine.getOverview(manifest.captureId); // Always the first debugging call.
  console.log('Overview (recorded failures, not a root-cause assertion):');
  console.log(JSON.stringify(overview, null, 2));
  const failedOperation = overview.graph.operations.find(
    (operation) => operation.id === overview.failures[0]!.operation.operationId,
  )!;
  const snapshot = await engine.inspectNode(failedOperation.snapshotId!);
  const exception = await named(engine, snapshot, 'exception');
  const message = await named(engine, exception, 'message');
  console.log('Observed exception message with provenance:');
  console.log(
    JSON.stringify(await engine.getEvidence(message.node.id), null, 2),
  );
  const load = overview.graph.operations.find(
    (operation) => operation.sourceId?.preview === 'load-2',
  )!;
  const loadSnapshot = await engine.inspectNode(load.snapshotId!);
  const order = await named(engine, loadSnapshot, 'order');
  const customer = await named(engine, order, 'customer');
  console.log('Explicit upstream redaction:');
  console.log(
    JSON.stringify(await engine.getEvidence(customer.node.id), null, 2),
  );
  const bounded = await engine.inspectNode(overview.rootEvidenceId, {
    limit: 1,
    maxBytes: 4096,
  });
  console.log(
    JSON.stringify({
      boundedBytes: Buffer.byteLength(JSON.stringify(bounded)),
      nextCursor: bounded.page.nextCursor,
    }),
  );
  const generic = await engine.compileRuntimeState(
    Readable.from([Buffer.from('{"value":null,"status":"failed"}')]),
  );
  console.log('Generic JSON has no execution graph:');
  console.log(
    JSON.stringify(await engine.getOverview(generic.captureId), null, 2),
  );
  const reopened = spawnSync(
    process.execPath,
    [
      fileURLToPath(import.meta.url),
      '--reopen',
      directory,
      manifest.captureId,
      message.node.id,
    ],
    { encoding: 'utf8' },
  );
  if (reopened.status !== 0) throw new Error('Fresh-process example failed');
  console.log(reopened.stdout);
  console.log(`Example store retained at ${directory}`);
}
