import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path))
    hash.update(bytes as Buffer);
  return hash.digest('hex');
}
