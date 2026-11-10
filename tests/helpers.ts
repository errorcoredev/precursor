import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import {
  createEvidenceEngine,
  LocalEvidenceStorage,
  type EvidenceEngine,
  type EvidenceNode,
  type Limits,
} from '../src/index.js';

export async function setup(limits?: Partial<Limits>) {
  const directory = await mkdtemp(join(tmpdir(), 'errorcore-test-'));
  const storage = new LocalEvidenceStorage(directory);
  return {
    directory,
    storage,
    engine: createEvidenceEngine({ storage, limits }),
    cleanup: async () => {
      // Only the exact fresh test directory created above is removed.
      if (
        dirname(resolve(directory)) !== resolve(tmpdir()) ||
        !directory.includes('errorcore-test-')
      )
        throw new Error('Unsafe cleanup');
      await rm(directory, { recursive: true, force: true });
    },
  };
}
export const input = (value: unknown): Readable =>
  Readable.from([Buffer.from(JSON.stringify(value))]);
export function split(bytes: Buffer, seed = 7, maximum = 29): Readable {
  return Readable.from(
    (function* () {
      let at = 0;
      while (at < bytes.length) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const end = Math.min(bytes.length, at + 1 + (seed % maximum));
        yield bytes.subarray(at, end);
        at = end;
      }
    })(),
  );
}
export async function children(
  engine: EvidenceEngine,
  id: string,
  limit = 7,
): Promise<EvidenceNode[]> {
  const nodes: EvidenceNode[] = [];
  let cursor: string | undefined;
  do {
    const view = await engine.inspectNode(id, { limit, cursor });
    nodes.push(...view.children.map((c) => c.node));
    cursor = view.page.nextCursor;
  } while (cursor);
  return nodes;
}
export async function child(
  engine: EvidenceEngine,
  id: string,
  key: string | number,
): Promise<EvidenceNode> {
  const nodes = await children(engine, id);
  const result = nodes.find((node) =>
    typeof key === 'number' ? node.ordinal === key : node.key?.preview === key,
  );
  if (!result) throw new Error('Missing fixture child');
  return result;
}
export async function text(
  engine: EvidenceEngine,
  id: string,
  sliceUnits = 113,
): Promise<string> {
  let result = '';
  let cursor: string | undefined;
  do {
    const page = await engine.getEvidence(id, { sliceUnits, cursor });
    if (page.kind !== 'text') throw new Error('Expected text');
    result += page.value;
    cursor = page.nextCursor;
  } while (cursor);
  return result;
}
