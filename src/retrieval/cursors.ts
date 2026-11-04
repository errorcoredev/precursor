import { createHmac, timingSafeEqual } from 'node:crypto';
import { fail } from '../errors.js';

interface CursorPayload {
  v: 1;
  binding: string;
  position: number;
}
export class Cursors {
  constructor(private readonly key: Buffer) {}
  encode(binding: string, position: number): string {
    const body = Buffer.from(
      JSON.stringify({ v: 1, binding, position }),
    ).toString('base64url');
    const mac = createHmac('sha256', this.key).update(body).digest('base64url');
    return `${body}.${mac}`;
  }
  decode(cursor: unknown, binding: string): number {
    if (cursor === undefined) return 0;
    if (
      typeof cursor !== 'string' ||
      cursor.length > 2048 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)
    )
      fail('INVALID_CURSOR');
    const [body, signature] = cursor.split('.') as [string, string];
    const mac = createHmac('sha256', this.key).update(body).digest();
    const received = Buffer.from(signature, 'base64url');
    if (
      received.length !== mac.length ||
      received.toString('base64url') !== signature ||
      !timingSafeEqual(received, mac)
    )
      fail('INVALID_CURSOR');
    let payload: CursorPayload;
    try {
      payload = JSON.parse(
        Buffer.from(body, 'base64url').toString('utf8'),
      ) as CursorPayload;
    } catch {
      fail('INVALID_CURSOR');
    }
    if (
      payload.v !== 1 ||
      payload.binding !== binding ||
      !Number.isSafeInteger(payload.position) ||
      payload.position < 0
    )
      fail('INVALID_CURSOR');
    return payload.position;
  }
}
