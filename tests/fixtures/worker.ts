import { Readable } from 'node:stream';
import {
  createEvidenceEngine,
  LocalEvidenceStorage,
  type CaptureFiles,
  type EvidenceManifest,
} from '../../src/index.js';

const [mode, directory, id] = process.argv.slice(2);
if (!directory) throw new Error('Missing test store');
class PausingStorage extends LocalEvidenceStorage {
  override async commit(
    stage: CaptureFiles,
    manifest: EvidenceManifest,
  ): Promise<void> {
    if (mode === 'after') await super.commit(stage, manifest);
    process.send?.({ captureId: stage.captureId, phase: mode });
    await new Promise<void>(() => {
      setInterval(() => {}, 1000);
    });
  }
}
const storage =
  mode === 'read'
    ? new LocalEvidenceStorage(directory)
    : new PausingStorage(directory);
const engine = createEvidenceEngine({ storage });
if (mode === 'read') {
  const overview = await engine.getOverview(id!);
  const inspection = await engine.inspectNode(overview.rootEvidenceId);
  const evidence = await engine.getEvidence(inspection.children[0]!.node.id);
  process.send?.({ captureId: overview.captureId, evidence });
  process.disconnect?.();
} else {
  await engine.compileRuntimeState(
    Readable.from([Buffer.from('{"answer":42}')]),
  );
}
