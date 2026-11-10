import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createEvidenceEngine, LocalEvidenceStorage } from '../../src/index.js';
import { child, input, setup, split } from '../helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture(limits?: Parameters<typeof setup>[0]) {
  const s = await setup(limits);
  cleanups.push(s.cleanup);
  return s;
}

it.each([
  '',
  '{',
  '[1,]',
  '{"a":1,}',
  '01',
  '+1',
  '1.',
  '1e+',
  'NaN',
  'true false',
  '"\n"',
  '"\\x00"',
  '{"a" 1}',
  '[}',
  '"\\uZZZZ"',
  '\ufeff{}',
  '\u00a0{}',
])('invalid JSON never publishes: case %#', async (value) => {
  const { engine, directory } = await fixture();
  await expect(
    engine.compileRuntimeState(split(Buffer.from(value), 5, 1)),
  ).rejects.toMatchObject({ code: 'INVALID_JSON' });
  expect(await readdir(join(directory, 'captures'))).toEqual([]);
  expect(await readdir(join(directory, 'staging'))).toEqual([]);
});

it('rejects invalid UTF-8, string streams, byte limits, stream failures and cancellation', async () => {
  const { engine, directory } = await fixture();
  await expect(
    engine.compileRuntimeState(Readable.from([Buffer.from([34, 0xc3, 34])])),
  ).rejects.toMatchObject({ code: 'INVALID_JSON' });
  await expect(
    engine.compileRuntimeState(Readable.from(['{}'])),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const encoded = input({});
  encoded.setEncoding('utf8');
  await expect(engine.compileRuntimeState(encoded)).rejects.toMatchObject({
    code: 'INVALID_INPUT',
  });
  await expect(
    engine.compileRuntimeState(input({ x: 10 }), { maxBytes: 3 }),
  ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  const broken = Readable.from(
    (async function* () {
      yield Buffer.from('[1,');
      throw new Error('private input content');
    })(),
  );
  await expect(engine.compileRuntimeState(broken)).rejects.toMatchObject({
    code: 'INVALID_INPUT',
    message: 'INVALID_INPUT',
  });
  const controller = new AbortController();
  const aborted = Readable.from(
    (async function* () {
      yield Buffer.from('[1,');
      controller.abort();
      yield Buffer.from('2]');
    })(),
  );
  await expect(
    engine.compileRuntimeState(aborted, { signal: controller.signal }),
  ).rejects.toMatchObject({ code: 'ABORTED' });
  expect(await readdir(join(directory, 'captures'))).toEqual([]);
});

it('enforces depth, key and path limits explicitly', async () => {
  const { engine } = await fixture({
    maxDepth: 12,
    maxKeyBytes: 20,
    maxPathBytes: 100,
  });
  const nested = (n: number) =>
    Readable.from([Buffer.from('['.repeat(n) + '0' + ']'.repeat(n))]);
  await engine.compileRuntimeState(nested(11));
  await expect(engine.compileRuntimeState(nested(12))).rejects.toMatchObject({
    code: 'RESOURCE_LIMIT',
  });
  await expect(
    engine.compileRuntimeState(input({ ['a'.repeat(11)]: 1 })),
  ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  const pathLimited = await fixture({ maxPathBytes: 40 });
  await expect(
    pathLimited.engine.compileRuntimeState(
      input({ ['a'.repeat(10)]: { ['b'.repeat(10)]: 0 } }),
    ),
  ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
  const deep = await fixture();
  await deep.engine.compileRuntimeState(nested(255));
  await expect(
    deep.engine.compileRuntimeState(nested(256)),
  ).rejects.toMatchObject({ code: 'RESOURCE_LIMIT' });
});

it('validates IDs, missing references, limits and authenticated cursor bindings', async () => {
  const { engine } = await fixture();
  const manifest = await engine.compileRuntimeState(
    input({ a: [1, 2, 3], b: [4, 5] }),
  );
  for (const id of ['../escape', 'C:\\secret', `${manifest.captureId}/..`])
    await expect(engine.getOverview(id)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  await expect(engine.getOverview(randomUUID())).rejects.toMatchObject({
    code: 'CAPTURE_NOT_FOUND',
  });
  await expect(
    engine.getEvidence(`${manifest.captureId}:17`),
  ).rejects.toMatchObject({ code: 'NODE_NOT_FOUND' });
  for (const limit of [-1, 0, 1.5, NaN, Infinity, 1001])
    await expect(
      engine.inspectNode(manifest.rootEvidenceId, { limit }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  for (const maxBytes of [1, NaN, 1048577])
    await expect(
      engine.getOverview(manifest.captureId, { maxBytes }),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  const a = await child(engine, manifest.rootEvidenceId, 'a');
  const b = await child(engine, manifest.rootEvidenceId, 'b');
  const view = await engine.inspectNode(a.id, { limit: 1 });
  const cursor = view.page.nextCursor!;
  await expect(engine.inspectNode(b.id, { cursor })).rejects.toMatchObject({
    code: 'INVALID_CURSOR',
  });
  await expect(
    engine.inspectNode(a.id, { cursor, depth: 2 }),
  ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  await expect(engine.getEvidence(a.id, { cursor })).rejects.toMatchObject({
    code: 'INVALID_CURSOR',
  });
  await expect(
    engine.inspectNode(a.id, { cursor: `${cursor.slice(0, -3)}BAD` }),
  ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  await expect(
    engine.inspectNode(a.id, { cursor: 'x'.repeat(10000) }),
  ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
});

it('keeps failed commits and arbitrary staging directories invisible', async () => {
  const s = await fixture();
  class BrokenStorage extends LocalEvidenceStorage {
    override async commit(): Promise<void> {
      throw new Error('injected private path');
    }
  }
  const engine = createEvidenceEngine({
    storage: new BrokenStorage(s.directory),
  });
  await expect(
    engine.compileRuntimeState(input({ x: 1 })),
  ).rejects.toMatchObject({ code: 'STORAGE_ERROR', message: 'STORAGE_ERROR' });
  expect(await readdir(join(s.directory, 'captures'))).toEqual([]);
  const stage = await s.storage.stage();
  await writeFile(stage.manifest, '{}');
  await expect(s.engine.getOverview(stage.captureId)).rejects.toMatchObject({
    code: 'CAPTURE_NOT_FOUND',
  });
});

it('recognizes structural versions and length corruption', async () => {
  const { engine, storage } = await fixture();
  const manifest = await engine.compileRuntimeState(input({ x: 1 }));
  const stored = await storage.open(manifest.captureId);
  const bytes = await readFile(stored.structure);
  bytes[0] = 0;
  await writeFile(stored.structure, bytes);
  await expect(engine.getOverview(manifest.captureId)).rejects.toMatchObject({
    code: 'UNSUPPORTED_VERSION',
  });
  await writeFile(stored.source, '{}');
  await expect(engine.getOverview(manifest.captureId)).rejects.toMatchObject({
    code: 'INTEGRITY_ERROR',
  });
});
