import { afterEach, expect, it } from 'vitest';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { input, setup } from '../helpers.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
async function fixture() {
  const s = await setup();
  cleanups.push(s.cleanup);
  return s;
}

it('survives an actual fresh Node process', async () => {
  const { engine, directory } = await fixture();
  const manifest = await engine.compileRuntimeState(input({ answer: 42 }));
  const worker = fork(
    'dist/tests/fixtures/worker.js',
    ['read', directory, manifest.captureId],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] },
  );
  const exit = once(worker, 'exit');
  const [message] = await once(worker, 'message');
  expect(message).toMatchObject({
    captureId: manifest.captureId,
    evidence: { kind: 'text', encoding: 'number-lexeme', value: '42' },
  });
  expect((await exit)[0]).toBe(0);
});

it.each(['before', 'after'])(
  'atomic visibility after a process kill %s publication',
  async (mode) => {
    const { engine, directory } = await fixture();
    const worker = fork('dist/tests/fixtures/worker.js', [mode, directory], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    const exit = once(worker, 'exit');
    const [message] = (await once(worker, 'message')) as [
      { captureId: string },
    ];
    worker.kill('SIGKILL');
    await exit;
    if (mode === 'before') {
      await expect(engine.getOverview(message.captureId)).rejects.toMatchObject(
        { code: 'CAPTURE_NOT_FOUND' },
      );
      expect(await readdir(join(directory, 'captures'))).toEqual([]);
      expect(await readdir(join(directory, 'staging'))).toHaveLength(1);
    } else {
      expect(
        (await engine.getOverview(message.captureId)).captureComplete,
      ).toBe(true);
      expect(await readdir(join(directory, 'staging'))).toEqual([]);
    }
  },
);
