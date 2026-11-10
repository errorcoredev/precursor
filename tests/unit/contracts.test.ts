import { afterEach, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { readFile, writeFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import {
  createEvidenceEngine,
  type CaptureSchemaAdapter,
  type OverviewOptions,
} from '../../src/index.js';
import { Cursors } from '../../src/retrieval/cursors.js';
import { child, input, setup, split } from '../helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const s = await setup();
  cleanups.push(s.cleanup);
  return s;
}

it('authenticates cursor versions, ranges, captures and parts', async () => {
  const { engine, storage } = await fixture();
  const manifest = await engine.compileRuntimeState(input([1, 2, 3]));
  const key = await storage.cursorKey();
  const binding = `inspect:${manifest.rootEvidenceId}:1`;
  await expect(
    engine.inspectNode(manifest.rootEvidenceId, {
      cursor: new Cursors(key).encode(binding, 1000),
    }),
  ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  const body = Buffer.from(
    JSON.stringify({ v: 7, binding, position: 1 }),
  ).toString('base64url');
  const signature = createHmac('sha256', key).update(body).digest('base64url');
  await expect(
    engine.inspectNode(manifest.rootEvidenceId, {
      cursor: `${body}.${signature}`,
    }),
  ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  for (const opts of [null, [], 'x', 1])
    await expect(
      engine.getOverview(
        manifest.captureId,
        opts as unknown as OverviewOptions,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
});

it('verifies hashes and detects same-size corruption without altering originals', async () => {
  const { engine, storage } = await fixture();
  const manifest = await engine.compileRuntimeState(input({ x: 1 }));
  expect(await storage.verify(manifest.captureId)).toEqual({ valid: true });
  const files = await storage.open(manifest.captureId);
  const original = await readFile(files.source);
  const changed = Buffer.from(original);
  changed[changed.indexOf(49)] = 50;
  await writeFile(files.source, changed);
  await expect(storage.verify(manifest.captureId)).rejects.toMatchObject({
    code: 'INTEGRITY_ERROR',
  });
});

it('applies backpressure instead of draining an unbounded input before processing', async () => {
  const { storage } = await fixture();
  let produced = 0;
  let seen = 0;
  const adapter: CaptureSchemaAdapter = {
    id: 'stop-early',
    create: () => ({
      start() {
        if (++seen === 20) throw new Error('private adapter detail');
      },
      end() {},
      finish() {},
    }),
  };
  const engine = createEvidenceEngine({ storage, adapters: [adapter] });
  const source = Readable.from(
    (function* () {
      yield Buffer.from('[');
      for (let i = 0; i < 10000; i++) {
        produced++;
        yield Buffer.from(
          (i ? ',' : '') + JSON.stringify({ i, text: 'x'.repeat(1000) }),
        );
      }
      yield Buffer.from(']');
    })(),
  );
  await expect(
    engine.compileRuntimeState(source, { adapterId: adapter.id }),
  ).rejects.toMatchObject({ code: 'STORAGE_ERROR', message: 'STORAGE_ERROR' });
  expect(produced).toBeLessThan(50);
});

it('handles binary chunk variants, concurrent captures, primitive roots and empty strings', async () => {
  const { engine } = await fixture();
  const manifests = await Promise.all(
    ['null', 'true', '""', '-0', '{}', '[]'].map((value) =>
      engine.compileRuntimeState(
        Readable.from([new Uint8Array(Buffer.from(value))]),
      ),
    ),
  );
  expect(new Set(manifests.map((m) => m.captureId)).size).toBe(6);
  const results = await Promise.all(
    manifests.map((m) => engine.getEvidence(m.rootEvidenceId)),
  );
  expect(results[0]).toMatchObject({ kind: 'scalar', value: null });
  expect(results[2]).toMatchObject({ kind: 'text', value: '', total: 0 });
  expect(results[3]).toMatchObject({ kind: 'text', value: '-0' });
});

it('rejects duplicate reserved semantic fields without rejecting ordinary duplicate keys', async () => {
  const { engine } = await fixture();
  const bad = Buffer.from(
    '{"$schema":"errorcore.example/v1","operations":[{"id":"a","id":"b"}]}',
  );
  await expect(
    engine.compileRuntimeState(split(bad), {
      adapterId: 'errorcore-example-v1',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  const ordinary = Buffer.from(
    '{"$schema":"errorcore.example/v1","runtime":{"x":1,"x":2}}',
  );
  const manifest = await engine.compileRuntimeState(split(ordinary), {
    adapterId: 'errorcore-example-v1',
  });
  const runtime = await child(engine, manifest.rootEvidenceId, 'runtime');
  expect((await engine.inspectNode(runtime.id)).children).toHaveLength(2);
});

it('prioritizes demonstrated ancestors and failure relationships, including cycles', async () => {
  const { engine } = await fixture();
  const manifest = await engine.compileRuntimeState(
    input({
      $schema: 'errorcore.example/v1',
      operations: [
        { id: 'unrelated' },
        { id: 'root' },
        { id: 'middle' },
        { id: 'fail', status: 'failed' },
      ],
      relationships: [
        { from: 'root', to: 'middle', type: 'call' },
        { from: 'middle', to: 'fail', type: 'parent' },
        { from: 'middle', to: 'root', type: 'call' },
      ],
    }),
    { adapterId: 'errorcore-example-v1' },
  );
  const view = await engine.getOverview(manifest.captureId, {
    operationLimit: 3,
    relationshipLimit: 1,
  });
  expect(view.graph.operations.map((o) => o.sourceId?.preview)).toEqual([
    'fail',
    'root',
    'middle',
  ]);
  expect(view.graph.relationships[0]!.to.sourceId?.preview).toBe('fail');
  expect(view.graph.operationPage.remaining).toBe(1);
});

it('bounds tiny overview pages and resumes each independent lane through exhaustion', async () => {
  const { engine } = await fixture();
  const manifest = await engine.compileRuntimeState(
    input({
      $schema: 'errorcore.example/v1',
      operations: [{ id: 'a', status: 'failed' }, { id: 'b' }],
      relationships: [{ from: 'b', to: 'a', type: 'await' }],
      failures: [{ operationId: 'a', message: 'reported' }],
    }),
    { adapterId: 'errorcore-example-v1' },
  );
  let options: OverviewOptions = { maxBytes: 4096 };
  let count = 0;
  const seen = {
    operations: [] as string[],
    edges: [] as string[],
    failures: [] as string[],
  };
  while (true) {
    const view = await engine.getOverview(manifest.captureId, options);
    expect(Buffer.byteLength(JSON.stringify(view))).toBeLessThanOrEqual(4096);
    seen.operations.push(...view.graph.operations.map((o) => o.id));
    seen.edges.push(...view.graph.relationships.map((e) => e.id));
    seen.failures.push(...view.failures.map((f) => f.id));
    if (view.responseComplete) break;
    options = {
      ...options,
      operationCursor: view.graph.operationPage.endCursor,
      relationshipCursor: view.graph.relationshipPage.endCursor,
      failureCursor: view.failurePage.endCursor,
    };
    expect(++count).toBeLessThan(10);
  }
  expect(seen.operations).toHaveLength(2);
  expect(new Set(seen.operations).size).toBe(2);
  expect(seen.edges).toHaveLength(1);
  expect(seen.failures).toHaveLength(2);
});
