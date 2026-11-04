import type { JsonKind } from '../types/index.js';
export const FILE_HEADER = Buffer.from('ERCORE-TOK-v1\0\0\0', 'ascii');
export const RECORD_MAGIC = 0xec0de001;
export const HEADER_SIZE = 64;
export const KINDS: JsonKind[] = [
  'object',
  'array',
  'string',
  'number',
  'null',
  'boolean',
];
export interface StructuralRecord {
  offset: number;
  kind: JsonKind;
  parent: number;
  ordinal: number;
  end: number;
  count: number;
  length: number;
  keyUnits: number;
  booleanValue: boolean;
}
export const dataOffset = (record: StructuralRecord): number =>
  record.offset + HEADER_SIZE + record.keyUnits * 2;
export function header(record: StructuralRecord): Buffer {
  const bytes = Buffer.alloc(HEADER_SIZE);
  bytes.writeUInt32LE(RECORD_MAGIC, 0);
  bytes.writeUInt8(KINDS.indexOf(record.kind), 4);
  bytes.writeUInt8(record.booleanValue ? 1 : 0, 5);
  bytes.writeDoubleLE(record.end, 8);
  bytes.writeDoubleLE(record.parent, 16);
  bytes.writeDoubleLE(record.ordinal, 24);
  bytes.writeDoubleLE(record.count, 32);
  bytes.writeDoubleLE(record.length, 40);
  bytes.writeUInt32LE(record.keyUnits, 48);
  bytes.writeDoubleLE(record.offset, 56);
  return bytes;
}
