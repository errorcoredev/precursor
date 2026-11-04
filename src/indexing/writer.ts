import { closeSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { fail } from '../errors.js';
import type {
  AdapterSession,
  JsonKind,
  Limits,
  StructuralEvent,
} from '../types/index.js';
import { FILE_HEADER, header, type StructuralRecord } from './format.js';

class BufferedFile {
  private readonly fd: number;
  private readonly buffer = Buffer.allocUnsafe(65536);
  private used = 0;
  private flushed = 0;
  private closed = false;
  constructor(path: string) {
    this.fd = openSync(path, 'wx', 0o600);
  }
  get position(): number {
    return this.flushed + this.used;
  }
  append(bytes: Buffer): void {
    if (!Number.isSafeInteger(this.position + bytes.length))
      fail('RESOURCE_LIMIT');
    let read = 0;
    while (read < bytes.length) {
      const take = Math.min(
        bytes.length - read,
        this.buffer.length - this.used,
      );
      bytes.copy(this.buffer, this.used, read, read + take);
      this.used += take;
      read += take;
      if (this.used === this.buffer.length) this.flush();
    }
  }
  private write(bytes: Buffer, position: number): void {
    let written = 0;
    while (written < bytes.length)
      written += writeSync(
        this.fd,
        bytes,
        written,
        bytes.length - written,
        position + written,
      );
  }
  patch(position: number, bytes: Buffer): void {
    if (position >= this.flushed) {
      bytes.copy(this.buffer, position - this.flushed);
      return;
    }
    const diskBytes = Math.min(bytes.length, this.flushed - position);
    this.write(bytes.subarray(0, diskBytes), position);
    if (diskBytes < bytes.length) bytes.copy(this.buffer, 0, diskBytes);
  }
  flush(): void {
    this.write(this.buffer.subarray(0, this.used), this.flushed);
    this.flushed += this.used;
    this.used = 0;
  }
  close(sync: boolean): void {
    if (this.closed) return;
    try {
      if (sync) {
        this.flush();
        fsyncSync(this.fd);
      }
    } finally {
      this.closed = true;
      closeSync(this.fd);
    }
  }
}

interface Frame {
  record: StructuralRecord;
  key?: string;
  nextKey?: string;
  pointerBytes: number;
  preview: string;
}
export interface Token {
  name: string;
  value?: string | boolean | null;
}

export class StructureWriter {
  private readonly file: BufferedFile;
  private readonly stack: Frame[] = [];
  private key: string | undefined;
  nodeCount = 0;
  maxDepth = 0;

  constructor(
    path: string,
    private readonly limits: Limits,
    private readonly adapter: AdapterSession,
    private readonly index: (offset: number) => void,
  ) {
    this.file = new BufferedFile(path);
    this.file.append(FILE_HEADER);
  }
  get size(): number {
    return this.file.position;
  }
  private event(frame: Frame): StructuralEvent {
    const r = frame.record;
    return {
      offset: r.offset,
      parent: r.parent,
      ordinal: r.ordinal,
      kind: r.kind,
      key: frame.key,
      depth: this.stack.length - 1,
      preview: frame.preview,
      length: r.length,
      booleanValue: r.booleanValue,
    };
  }
  private start(kind: JsonKind, value = false): void {
    const parent = this.stack.at(-1);
    const key = parent?.record.kind === 'object' ? parent.nextKey : undefined;
    const ordinal = parent ? parent.record.count++ : 0;
    const segment =
      parent?.record.kind === 'array'
        ? String(ordinal)
        : key?.replace(/~/g, '~0').replace(/\//g, '~1');
    const pointerBytes =
      (parent?.pointerBytes ?? 0) +
      (segment === undefined ? 0 : (segment.length + 1) * 2);
    if (
      pointerBytes > this.limits.maxPathBytes ||
      this.stack.length >= this.limits.maxDepth
    )
      fail('RESOURCE_LIMIT');
    if (!parent && this.nodeCount !== 0) fail('INVALID_JSON');
    if (parent?.record.kind === 'object' && key === undefined)
      fail('INVALID_JSON');
    if (parent) parent.nextKey = undefined;
    const record: StructuralRecord = {
      offset: this.file.position,
      kind,
      parent: parent?.record.offset ?? -1,
      ordinal,
      end: 0,
      count: 0,
      length: 0,
      keyUnits: key?.length ?? 0,
      booleanValue: value,
    };
    this.file.append(header(record));
    if (key !== undefined) this.file.append(Buffer.from(key, 'utf16le'));
    const frame: Frame = { record, key, pointerBytes, preview: '' };
    this.stack.push(frame);
    this.nodeCount++;
    this.maxDepth = Math.max(this.maxDepth, this.stack.length);
    if (!parent || (this.stack.length === 2 && ordinal < 50))
      this.index(record.offset);
    this.adapter.start(this.event(frame));
  }
  private end(): void {
    const frame = this.stack.at(-1);
    if (!frame) fail('INVALID_JSON');
    frame.record.end = this.file.position;
    this.file.patch(frame.record.offset, header(frame.record));
    this.adapter.end(this.event(frame));
    this.stack.pop();
  }
  accept(token: Token): void {
    switch (token.name) {
      case 'startKey':
        this.key = '';
        break;
      case 'endKey': {
        const parent = this.stack.at(-1);
        if (!parent) fail('INVALID_JSON');
        parent.nextKey = this.key;
        this.key = undefined;
        break;
      }
      case 'stringChunk':
      case 'numberChunk': {
        if (typeof token.value !== 'string') fail('INVALID_JSON');
        if (this.key !== undefined) {
          if (
            (this.key.length + token.value.length) * 2 >
            this.limits.maxKeyBytes
          )
            fail('RESOURCE_LIMIT');
          this.key += token.value;
        } else {
          const frame = this.stack.at(-1);
          if (!frame) fail('INVALID_JSON');
          frame.record.length += token.value.length;
          if (frame.preview.length < 1024)
            frame.preview += token.value.slice(0, 1024 - frame.preview.length);
          this.file.append(
            Buffer.from(
              token.value,
              token.name === 'numberChunk' ? 'ascii' : 'utf16le',
            ),
          );
        }
        break;
      }
      case 'startObject':
        this.start('object');
        break;
      case 'startArray':
        this.start('array');
        break;
      case 'startString':
        this.start('string');
        break;
      case 'startNumber':
        this.start('number');
        break;
      case 'endObject':
      case 'endArray':
      case 'endString':
      case 'endNumber':
        this.end();
        break;
      case 'nullValue':
        this.start('null');
        this.end();
        break;
      case 'trueValue':
        this.start('boolean', true);
        this.end();
        break;
      case 'falseValue':
        this.start('boolean');
        this.end();
        break;
      default:
        fail('INVALID_JSON');
    }
  }
  finish(): void {
    if (
      this.stack.length !== 0 ||
      this.nodeCount === 0 ||
      this.key !== undefined
    )
      fail('INVALID_JSON');
    this.adapter.finish();
    this.file.close(true);
  }
  abort(): void {
    this.file.close(false);
  }
}
