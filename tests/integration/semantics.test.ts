import { afterEach, expect, it } from 'vitest';
import { createReadStream } from 'node:fs';
import { child, children, input, setup, text } from '../helpers.js';
import type { IncidentOverview } from '../../src/index.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const s = await setup();
  cleanups.push(s.cleanup);
  return s;
}

it('distinguishes every availability state from observed null, missing fields and marker strings', async () => {
  const { engine } = await fixture();
  const manifest = await engine.compileRuntimeState(
    createReadStream('examples/runtime.json'),
    { adapterId: 'errorcore-example-v1' },
  );
  const overview = await engine.getOverview(manifest.captureId);
  expect(overview.failures).toHaveLength(2);
  expect(overview.failures.filter((f) => f.primary)).toHaveLength(1);
  expect(overview.graph.relationships.map((e) => e.type)).toEqual([
    'await',
    'trigger',
    'call',
  ]);
  expect(overview.graph.operations[0]!.sourceId?.preview).toBe('write-3');
  expect(overview.graph.completeness).toBe('partial');
  const runtime = await child(engine, manifest.rootEvidenceId, 'runtime');
  for (const [key, status] of [
    ['missing', 'not_captured'],
    ['uncertain', 'unknown'],
    ['reference', 'unresolved'],
  ]) {
    const node = await child(engine, runtime.id, key!);
    expect(await engine.getEvidence(node.id)).toMatchObject({
      kind: 'unavailable',
      availability: { status },
      sourceComplete: false,
    });
  }
  expect(
    await text(engine, (await child(engine, runtime.id, 'literalMarker')).id),
  ).toBe('[REDACTED]');
  expect(
    await engine.getEvidence((await child(engine, runtime.id, 'nullValue')).id),
  ).toMatchObject({ kind: 'scalar', value: null });
  expect(
    (await children(engine, runtime.id)).some(
      (c) => c.key?.preview === 'absent',
    ),
  ).toBe(false);
  const encoded = await engine.getEvidence(
    (await child(engine, runtime.id, 'undefinedValue')).id,
  );
  expect(encoded).toMatchObject({
    kind: 'reference',
    node: {
      availability: {
        status: 'observed',
        runtimeType: { preview: 'undefined' },
      },
    },
  });
  if (encoded.kind !== 'reference') throw new Error('Wrong result');
  expect(await engine.getEvidence(encoded.valueId)).toMatchObject({
    kind: 'scalar',
    value: null,
  });
  const ops = await child(engine, manifest.rootEvidenceId, 'operations');
  const load = await child(engine, ops.id, 1);
  const snapshot = await child(engine, load.id, 'snapshot');
  const order = await child(engine, snapshot.id, 'order');
  const customer = await child(engine, order.id, 'customer');
  expect(await engine.getEvidence(customer.id)).toMatchObject({
    kind: 'unavailable',
    availability: {
      status: 'redacted',
      reason: { preview: 'upstream policy' },
    },
  });
  const failedSnapshot = overview.graph.operations[0]!.snapshotId!;
  const partial = await engine.getEvidence(
    (await child(engine, failedSnapshot, 'partial')).id,
  );
  expect(partial).toMatchObject({ kind: 'reference', sourceComplete: false });
  if (partial.kind !== 'reference') throw new Error('Wrong result');
  expect(await engine.getEvidence(partial.valueId)).toMatchObject({
    kind: 'collection',
    sourceComplete: false,
  });
  expect(overview.availabilityCounts).toMatchObject({
    redacted: 1,
    truncated: 1,
    unknown: 1,
    not_captured: 1,
    unresolved: 1,
    observed: 1,
  });
});

it('keeps duplicate/missing/oversized operation IDs unresolved and paginates the whole graph', async () => {
  const { engine } = await fixture();
  const operations = Array.from({ length: 41 }, (_, n) => ({
    id: `op-${n}`,
    label: 'operation',
    snapshot: { n },
  }));
  operations.push({ id: 'op-0', label: 'duplicate', snapshot: { n: 41 } });
  operations.push({
    id: 'x'.repeat(1500),
    label: 'oversized',
    snapshot: { n: 42 },
  });
  const relationships = [
    { from: 'op-0', to: 'op-1', type: 'sequence' },
    { from: 'absent', to: 'op-2', type: 'dependency' },
    { from: 'x'.repeat(1500), to: 'op-3', type: 'parent' },
    ...Array.from({ length: 36 }, (_, i) => ({
      from: `op-${i + 1}`,
      to: `op-${i + 2}`,
      type: 'await',
    })),
  ];
  const failures = Array.from({ length: 16 }, (_, n) => ({
    operationId: `op-${n + 3}`,
    message: `recorded-${n}`,
  }));
  const manifest = await engine.compileRuntimeState(
    input({
      $schema: 'errorcore.example/v1',
      operations,
      relationships,
      failures,
    }),
    { adapterId: 'errorcore-example-v1' },
  );
  let opCursor: string | undefined;
  let edgeCursor: string | undefined;
  let failureCursor: string | undefined;
  const ops: string[] = [];
  const edges: string[] = [];
  const fails: string[] = [];
  let last: IncidentOverview;
  do {
    last = await engine.getOverview(manifest.captureId, {
      operationLimit: 5,
      relationshipLimit: 6,
      failureLimit: 2,
      operationCursor: opCursor,
      relationshipCursor: edgeCursor,
      failureCursor,
      maxBytes: 16384,
    });
    expect(Buffer.byteLength(JSON.stringify(last))).toBeLessThanOrEqual(16384);
    ops.push(...last.graph.operations.map((n) => n.id));
    edges.push(...last.graph.relationships.map((n) => n.id));
    fails.push(...last.failures.map((n) => n.id));
    opCursor = last.graph.operationPage.endCursor;
    edgeCursor = last.graph.relationshipPage.endCursor;
    failureCursor = last.failurePage.endCursor;
  } while (
    ops.length < operations.length ||
    edges.length < relationships.length ||
    fails.length < failures.length
  );
  expect(new Set(ops).size).toBe(operations.length);
  expect(new Set(edges).size).toBe(relationships.length);
  expect(new Set(fails).size).toBe(failures.length);
  expect(last.responseComplete).toBe(true);
  const first = await engine.getOverview(manifest.captureId, {
    maxBytes: 1048576,
  });
  for (const [source, resolution] of [
    ['op-0', 'ambiguous'],
    ['absent', 'missing'],
    ['x'.repeat(256), 'unresolved'],
  ]) {
    expect(
      first.graph.relationships.find((r) => r.from.sourceId?.preview === source)
        ?.from.resolution,
    ).toBe(resolution);
  }
  expect(first.graph.unresolvedEndpoints).toBe(3);
  expect(first.failures.every((f) => f.primary === false)).toBe(true);
  const focusId = first.graph.operations.at(-1)!.id;
  expect(
    (
      await engine.getOverview(manifest.captureId, {
        focusOperationId: focusId,
      })
    ).graph.operations[0]!.id,
  ).toBe(focusId);
});

it('all metadata/evidence references resolve, including bounded metadata previews', async () => {
  const { engine } = await fixture();
  const manifest = await engine.compileRuntimeState(
    input({
      $schema: 'errorcore.example/v1',
      operations: [
        { id: 'a', label: '\u0001'.repeat(20000), snapshot: { x: 9 } },
      ],
      failures: [
        { operationId: 'a', message: 'large'.repeat(10000), primary: true },
      ],
    }),
    { adapterId: 'errorcore-example-v1' },
  );
  const overview = await engine.getOverview(manifest.captureId);
  const ids = new Set<string>();
  function collect(value: unknown): void {
    if (typeof value === 'string' && /^[a-f0-9-]{36}:\d+$/.test(value))
      ids.add(value);
    else if (value && typeof value === 'object')
      for (const v of Object.values(value)) collect(v);
  }
  collect(overview);
  for (const id of ids) expect((await engine.inspectNode(id)).node.id).toBe(id);
  expect(overview.graph.operations[0]!.label?.complete).toBe(false);
  expect(
    await text(engine, overview.graph.operations[0]!.label!.evidenceId, 12000),
  ).toBe('\u0001'.repeat(20000));
});

it('generic mode never interprets illustrative markers and example mode requires its version', async () => {
  const { engine } = await fixture();
  const manifest = await engine.compileRuntimeState(
    input({
      $availability: 'redacted',
      value: null,
      operations: [{ status: 'failed' }],
    }),
  );
  expect(await engine.getEvidence(manifest.rootEvidenceId)).toMatchObject({
    kind: 'collection',
    node: { availability: { status: 'observed' } },
  });
  expect((await engine.getOverview(manifest.captureId)).failures).toEqual([]);
  await expect(
    engine.compileRuntimeState(input({ operations: [] }), {
      adapterId: 'errorcore-example-v1',
    }),
  ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
});
