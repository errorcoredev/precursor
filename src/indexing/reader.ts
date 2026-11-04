import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { fail } from '../errors.js';
import {
  dataOffset,
  FILE_HEADER,
  HEADER_SIZE,
  KINDS,
  RECORD_MAGIC,
  type StructuralRecord,
} from './format.js';

export class StructureReader {
  private readonly fd: number;
  readonly size: number;
  constructor(path: string) {
    this.fd = openSync(path, 'r');
    this.size = fstatSync(this.fd).size;
    try {
      if (!this.bytes(0, 16).equals(FILE_HEADER)) fail('UNSUPPORTED_VERSION');
    } catch (error) {
      closeSync(this.fd);
      throw error;
    }
  }
  close(): void {
    closeSync(this.fd);
  }
  private bytes(offset: number, length: number): Buffer {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      length > 2097152 ||
      offset < 0 ||
      offset + length > this.size
    )
      fail('INTEGRITY_ERROR');
    const bytes = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const n = readSync(this.fd, bytes, read, length - read, offset + read);
      if (!n) fail('INTEGRITY_ERROR');
      read += n;
    }
    return bytes;
  }
  record(offset: number): StructuralRecord {
    const b = this.bytes(offset, HEADER_SIZE);
    const kind = KINDS[b.readUInt8(4)];
    if (
      b.readUInt32LE(0) !== RECORD_MAGIC ||
      !kind ||
      b.readDoubleLE(56) !== offset
    )
      fail('NODE_NOT_FOUND');
    const r: StructuralRecord = {
      offset,
      kind,
      end: b.readDoubleLE(8),
      parent: b.readDoubleLE(16),
      ordinal: b.readDoubleLE(24),
      count: b.readDoubleLE(32),
      length: b.readDoubleLE(40),
      keyUnits: b.readUInt32LE(48),
      booleanValue: b.readUInt8(5) === 1,
    };
    for (const n of [r.end, r.parent, r.ordinal, r.count, r.length])
      if (!Number.isSafeInteger(n)) fail('INTEGRITY_ERROR');
    if (
      r.parent < -1 ||
      r.parent >= offset ||
      r.ordinal < 0 ||
      r.count < 0 ||
      r.length < 0 ||
      r.keyUnits > 524288 ||
      r.end < dataOffset(r) ||
      r.end > this.size
    )
      fail('INTEGRITY_ERROR');
    if (
      kind !== 'object' &&
      kind !== 'array' &&
      r.end !== dataOffset(r) + r.length * (kind === 'string' ? 2 : 1)
    )
      fail('INTEGRITY_ERROR');
    return r;
  }
  key(r: StructuralRecord): string {
    return this.bytes(r.offset + HEADER_SIZE, r.keyUnits * 2).toString(
      'utf16le',
    );
  }
  scalar(r: StructuralRecord, start: number, units: number): string {
    const n = Math.min(units, r.length - start);
    if (start < 0 || n < 0) fail('INVALID_CURSOR');
    const width = r.kind === 'string' ? 2 : 1;
    return this.bytes(dataOffset(r) + start * width, n * width).toString(
      width === 2 ? 'utf16le' : 'ascii',
    );
  }
  *children(
    r: StructuralRecord,
    ordinal = 0,
    offset = dataOffset(r),
  ): Generator<StructuralRecord> {
    if (r.kind !== 'object' && r.kind !== 'array') return;
    while (ordinal < r.count) {
      const child = this.record(offset);
      if (
        child.parent !== r.offset ||
        child.ordinal !== ordinal ||
        child.end > r.end
      )
        fail('INTEGRITY_ERROR');
      yield child;
      offset = child.end;
      ordinal++;
    }
    if (offset !== r.end) fail('INTEGRITY_ERROR');
  }
  pointer(r: StructuralRecord): { text: string; ambiguous: boolean } {
    const segments: string[] = [];
    let current = r;
    let ambiguous = false;
    while (current.parent !== -1) {
      if (segments.length >= 1024) fail('INTEGRITY_ERROR');
      const parent = this.record(current.parent);
      if (parent.kind === 'object') {
        segments.push(
          this.key(current).replace(/~/g, '~0').replace(/\//g, '~1'),
        );
        ambiguous = true;
      } else if (parent.kind === 'array')
        segments.push(String(current.ordinal));
      else fail('INTEGRITY_ERROR');
      current = parent;
    }
    if (current.offset !== 16) fail('NODE_NOT_FOUND');
    return {
      text: segments.length ? `/${segments.reverse().join('/')}` : '',
      ambiguous,
    };
  }
}
