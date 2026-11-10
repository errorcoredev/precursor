import { afterEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { child, children, input, setup, split, text } from '../helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const s = await setup();
  cleanups.push(s.cleanup);
  return s;
}

describe('lossless structural evidence', () => {
  it('preserves bytes, exact numeric lexemes, duplicate keys, null, empty values and pointer escaping', async () => {
    const { engine, storage } = await fixture();
    const bytes = Buffer.from(
      ' \n{"a/b~c": [null,{},[],true,false,-0,90071992547409931234,1.2300e+40],"dup":1,"dup":2,"__proto__":"safe","str":"\\ud800𐐷\\u0000\\n"} \t',
    );
    const manifest = await engine.compileRuntimeState(split(bytes));
    const stored = await storage.open(manifest.captureId);
    expect(await readFile(stored.source)).toEqual(bytes);
    expect(manifest.source.sha256).toBe(
      createHash('sha256').update(bytes).digest('hex'),
    );
    const overview = await engine.getOverview(manifest.captureId);
    expect(overview.graph.operations).toEqual([]);
    expect(overview.graph.completeness).toBe('unavailable');
    const rootChildren = await children(engine, manifest.rootEvidenceId, 2);
    expect(rootChildren.map((c) => c.key?.preview)).toEqual([
      'a/b~c',
      'dup',
      'dup',
      '__proto__',
      'str',
    ]);
    expect(rootChildren[1]!.id).not.toBe(rootChildren[2]!.id);
    expect(rootChildren[1]!.pointer.preview).toBe('/dup');
    expect(rootChildren[2]!.pointer.ambiguity).toBe('possible');
    const values = await children(engine, rootChildren[0]!.id, 3);
    expect(values[0]!.pointer.preview).toBe('/a~1b~0c/0');
    expect(await engine.getEvidence(values[0]!.id)).toMatchObject({
      kind: 'scalar',
      value: null,
      node: { availability: { status: 'observed' } },
    });
    expect((await engine.inspectNode(values[1]!.id)).children).toEqual([]);
    expect((await engine.inspectNode(values[2]!.id)).children).toEqual([]);
    expect(await engine.getEvidence(values[3]!.id)).toMatchObject({
      kind: 'scalar',
      value: true,
    });
    expect(await engine.getEvidence(values[4]!.id)).toMatchObject({
      kind: 'scalar',
      value: false,
    });
    expect(await text(engine, values[5]!.id)).toBe('-0');
    expect(await text(engine, values[6]!.id)).toBe('90071992547409931234');
    expect(await text(engine, values[7]!.id)).toBe('1.2300e+40');
    expect(await text(engine, rootChildren[4]!.id, 1)).toBe('\ud800𐐷\0\n');
    const db = new DatabaseSync(stored.database, { readOnly: true });
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM nodes').get() as { n: number }).n,
    ).toBe(6);
    db.close();
  });

  it('pages large arrays without gaps and expands lazily without changing immutable files', async () => {
    const { engine, storage } = await fixture();
    const manifest = await engine.compileRuntimeState(
      input({
        entries: Array.from({ length: 311 }, (_, i) => ({ i, nested: [i] })),
      }),
    );
    const files = await storage.open(manifest.captureId);
    const before = await Promise.all([
      readFile(files.structure),
      readFile(files.database),
    ]);
    const entries = await child(engine, manifest.rootEvidenceId, 'entries');
    const page = await engine.inspectNode(entries.id, { limit: 13, depth: 4 });
    const count = (view: typeof page): number =>
      view.children.reduce((n, c) => n + 1 + count(c), 0);
    expect(count(page)).toBeLessThanOrEqual(13);
    const all = await children(engine, entries.id, 19);
    expect(all.map((c) => c.ordinal)).toEqual(
      Array.from({ length: 311 }, (_, i) => i),
    );
    expect(new Set(all.map((c) => c.id)).size).toBe(311);
    expect(
      await engine.inspectNode(entries.id, { limit: 13, depth: 4 }),
    ).toEqual(page);
    const last = await child(engine, all.at(-1)!.id, 'i');
    expect(await text(engine, last.id)).toBe('310');
    expect(
      await Promise.all([readFile(files.structure), readFile(files.database)]),
    ).toEqual(before);
  });

  it('slices long strings/numbers across storage boundaries within serialized budgets', async () => {
    const { engine } = await fixture();
    const value = 'A𐐷\ud800\n"\\'.repeat(17000);
    const number = '1' + '0'.repeat(70000) + 'e-9';
    const bytes = Buffer.from(
      `{"text":${JSON.stringify(value)},"number":${number}}`,
    );
    const manifest = await engine.compileRuntimeState(
      Readable.from(
        (function* () {
          for (let i = 0; i < bytes.length; i += 63001)
            yield bytes.subarray(i, i + 63001);
        })(),
      ),
    );
    const stringNode = await child(engine, manifest.rootEvidenceId, 'text');
    let cursor: string | undefined;
    let reconstructed = '';
    do {
      const page = await engine.getEvidence(stringNode.id, {
        sliceUnits: 262144,
        maxBytes: 4096,
        cursor,
      });
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(4096);
      if (page.kind !== 'text') throw new Error('wrong result');
      reconstructed += page.value;
      cursor = page.nextCursor;
    } while (cursor);
    expect(reconstructed).toBe(value);
    expect(
      await text(
        engine,
        (await child(engine, manifest.rootEvidenceId, 'number')).id,
        10000,
      ),
    ).toBe(number);
  });

  it('reconstructs oversized keys and pointers through bounded parts', async () => {
    const { engine } = await fixture();
    const key = 'a/~𐐷'.repeat(300);
    const manifest = await engine.compileRuntimeState(input({ [key]: 7 }));
    const node = (await children(engine, manifest.rootEvidenceId))[0]!;
    expect(node.key?.complete).toBe(false);
    for (const part of ['key', 'pointer'] as const) {
      let cursor: string | undefined;
      let result = '';
      do {
        const response = await engine.getEvidence(node.id, {
          part,
          sliceUnits: 63,
          cursor,
        });
        if (response.kind !== 'text') throw new Error('wrong result');
        result += response.value;
        cursor = response.nextCursor;
      } while (cursor);
      expect(result).toBe(
        part === 'key'
          ? key
          : `/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`,
      );
    }
  });

  it('handles seeded and bytewise splits inside UTF-8 and JSON escapes', async () => {
    const { engine } = await fixture();
    const bytes = Buffer.from(
      '{"a\\u002fb":"अ𐐷\\ud800\\n\\\"", "n":-12.300e-2}',
    );
    for (const seed of [1, 8, 432, 99999]) {
      const manifest = await engine.compileRuntimeState(
        split(bytes, seed, seed === 1 ? 1 : 17),
      );
      const node = await child(engine, manifest.rootEvidenceId, 'a/b');
      expect(await text(engine, node.id, 1)).toBe('अ𐐷\ud800\n"');
    }
  });
});
