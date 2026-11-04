import { open } from 'node:fs/promises';

/** Writes exactly targetBytes; retains only one small operation/relationship at a time. */
export async function generate(
  path: string,
  targetBytes: number,
): Promise<{ bytes: number; operations: number }> {
  const file = await open(path, 'wx');
  let bytes = 0;
  let operations = 0;
  async function write(text: string): Promise<void> {
    const buffer = Buffer.from(text);
    let offset = 0;
    while (offset < buffer.length)
      offset += (await file.write(buffer, offset, buffer.length - offset))
        .bytesWritten;
    bytes += buffer.length;
  }
  try {
    await write('{"$schema":"errorcore.example/v1","operations":[');
    const detail = 'captured runtime text; '.repeat(370);
    while (true) {
      const record = JSON.stringify({
        id: `op-${operations}`,
        label: 'handle captured request',
        correlationId: `trace-${Math.floor(operations / 8)}`,
        snapshot: {
          request: {
            route: '/orders',
            attempt: operations % 3,
            elapsed: 1.25,
            absent: null,
          },
          values: Array.from({ length: 24 }, (_, i) => i),
          detail,
          upstream: {
            $availability: 'redacted',
            reason: 'already sanitized upstream',
          },
        },
      });
      if (
        bytes + Buffer.byteLength(record) + (operations + 1) * 110 + 1024 >=
        targetBytes
      )
        break;
      await write((operations ? ',' : '') + record);
      operations++;
    }
    await write('],"relationships":[');
    for (let i = 1; i < operations; i++)
      await write(
        (i > 1 ? ',' : '') +
          JSON.stringify({ from: `op-${i - 1}`, to: `op-${i}`, type: 'await' }),
      );
    await write(
      '],"failures":[' +
        JSON.stringify({
          operationId: `op-${operations - 1}`,
          message: 'explicit recorded failure',
          primary: true,
        }) +
        '],"padding":"',
    );
    while (bytes < targetBytes - 2)
      await write('p'.repeat(Math.min(65536, targetBytes - 2 - bytes)));
    await write('"}');
    await file.sync();
    return { bytes, operations };
  } finally {
    await file.close();
  }
}
