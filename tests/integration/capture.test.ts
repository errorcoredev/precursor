import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setup } from '../helpers.js';
import type { EvidenceManifest, IncidentOverview } from '../../src/index.js';

const runner = resolve('dist/examples/capture-file.js');
const sample = resolve('examples/runtime.json');
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture() {
  const state = await setup();
  cleanups.push(state.cleanup);
  return state;
}

function run(directory: string, ...args: string[]) {
  return spawnSync(process.execPath, [runner, ...args], {
    cwd: directory,
    encoding: 'utf8',
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
}

it('prints help without creating an evidence store', async () => {
  const { directory } = await fixture();
  const result = run(directory, '--help');
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('Usage: npm run capture');
  await expect(
    readFile(join(directory, '.errorcore-evidence/cursor.key')),
  ).rejects.toMatchObject({ code: 'ENOENT' });
});

it('ingests a path containing spaces and reopens its exact persisted source', async () => {
  const { directory } = await fixture();
  const file = join(directory, 'capture with spaces.json');
  const bytes = Buffer.from(' \n{"value":null,"status":"failed"}\t');
  await writeFile(file, bytes);
  const result = run(directory, file);
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout) as {
    manifest: EvidenceManifest;
    overview: IncidentOverview;
    evidence: { kind: string; value: unknown };
  };
  expect(output.overview.graph.completeness).toBe('unavailable');
  expect(output.overview.failures).toEqual([]);
  expect(output.evidence).toMatchObject({ kind: 'scalar', value: null });
  expect(
    await readFile(
      join(
        directory,
        '.errorcore-evidence',
        'captures',
        output.manifest.captureId,
        'source.json',
      ),
    ),
  ).toEqual(bytes);
});

it('requires explicit adapter selection for illustrative graph semantics', async () => {
  const { directory } = await fixture();
  const result = run(directory, sample, '--adapter=errorcore-example-v1');
  expect(result.status).toBe(0);
  const output = JSON.parse(result.stdout) as { overview: IncidentOverview };
  expect(output.overview.graph.completeness).toBe('partial');
  expect(output.overview.failures.length).toBeGreaterThan(0);
});

it.each(['null', '{}', '[]'])(
  'retrieves the root for input %s',
  async (source) => {
    const { directory } = await fixture();
    const file = join(directory, 'input.json');
    await writeFile(file, source);
    const result = run(directory, file);
    expect(result.status).toBe(0);
    const output = JSON.parse(result.stdout) as {
      manifest: EvidenceManifest;
      evidence: { node: { id: string } };
    };
    expect(output.evidence.node.id).toBe(output.manifest.rootEvidenceId);
  },
);

it.each([
  { args: [], code: 'INVALID_ARGUMENT' },
  { args: ['--invalid'], code: 'INVALID_ARGUMENT' },
  { args: ['one.json', 'two.json'], code: 'INVALID_ARGUMENT' },
  { args: ['missing.json'], code: 'INPUT_FILE_NOT_FOUND' },
  { args: ['.'], code: 'INVALID_INPUT' },
])('returns a fixed error for $code with $args', async ({ args, code }) => {
  const { directory } = await fixture();
  const result = run(directory, ...args);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stderr.split(/\r?\n/)[0]!)).toEqual({ error: code });
  expect(result.stdout).toBe('');
});

it('rejects malformed input without including source content in errors', async () => {
  const { directory } = await fixture();
  const file = join(directory, 'invalid.json');
  await writeFile(file, '{"private-marker":');
  const result = run(directory, file);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('"error":"INVALID_JSON"');
  expect(result.stderr).not.toContain('private-marker');
  expect(result.stdout).toBe('');
});
