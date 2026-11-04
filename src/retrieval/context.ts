import type { DatabaseSync } from 'node:sqlite';
import { EvidenceError, fail, nodeId } from '../errors.js';
import { StructureReader } from '../indexing/reader.js';
import { dataOffset, type StructuralRecord } from '../indexing/format.js';
import { cacheDatabase, database } from '../storage/database.js';
import type { StoredCapture } from '../storage/contracts.js';
import type {
  AvailabilityMetadata,
  EvidenceNode,
  TextReference,
} from '../types/index.js';

export class RetrievalContext {
  readonly db: DatabaseSync;
  readonly cache: DatabaseSync;
  readonly reader: StructureReader;
  constructor(readonly capture: StoredCapture) {
    this.db = database(capture.database, true);
    try {
      this.cache = cacheDatabase(capture.cache);
    } catch (error) {
      this.db.close();
      throw error;
    }
    try {
      this.reader = new StructureReader(capture.structure);
      this.cache.exec('BEGIN');
    } catch (error) {
      this.cache.close();
      this.db.close();
      throw error;
    }
  }
  close(): void {
    try {
      this.cache.exec('COMMIT');
    } finally {
      this.cache.close();
      this.db.close();
      this.reader.close();
    }
  }
  id(offset: number): string {
    return nodeId(this.capture.captureId, offset);
  }
  remember(offset: number): void {
    this.cache.prepare('INSERT OR IGNORE INTO nodes VALUES (?)').run(offset);
  }
  get(offset: number, depth = 0): StructuralRecord {
    if (depth > 1024 || offset < 16 || offset + 64 > this.reader.size)
      fail('NODE_NOT_FOUND');
    let record: StructuralRecord;
    try {
      record = this.reader.record(offset);
    } catch (error) {
      if (error instanceof EvidenceError && error.code === 'INTEGRITY_ERROR')
        fail('NODE_NOT_FOUND');
      throw error;
    }
    if (
      this.db.prepare('SELECT 1 FROM nodes WHERE offset=?').get(offset) ||
      this.cache.prepare('SELECT 1 FROM nodes WHERE offset=?').get(offset)
    )
      return record;
    if (record.parent === -1) {
      if (offset !== 16) fail('NODE_NOT_FOUND');
    } else {
      const parent = this.get(record.parent, depth + 1);
      let found = false;
      for (const child of this.children(parent, record.ordinal)) {
        found = child.offset === offset;
        break;
      }
      if (!found) fail('NODE_NOT_FOUND');
    }
    this.remember(offset);
    return record;
  }
  *children(
    record: StructuralRecord,
    start: number,
  ): Generator<StructuralRecord> {
    if (!Number.isSafeInteger(start) || start < 0 || start > record.count)
      fail('INVALID_CURSOR');
    const checkpoint = this.cache
      .prepare(
        'SELECT ordinal,offset FROM checkpoints WHERE parent=? AND ordinal<=? ORDER BY ordinal DESC LIMIT 1',
      )
      .get(record.offset, start) as
      { ordinal: number; offset: number } | undefined;
    for (const child of this.reader.children(
      record,
      checkpoint?.ordinal ?? 0,
      checkpoint?.offset ?? dataOffset(record),
    )) {
      if (child.ordinal < start) continue;
      this.remember(child.offset);
      this.cache
        .prepare('INSERT OR IGNORE INTO checkpoints VALUES (?,?,?)')
        .run(record.offset, child.ordinal, child.offset);
      yield child;
    }
  }
  text(
    text: string,
    offset: number,
    part: 'key' | 'pointer' | 'value' = 'value',
  ): TextReference {
    return {
      preview: text.slice(0, 128),
      length: text.length,
      complete: text.length <= 128,
      evidenceId: this.id(offset),
      part,
    };
  }
  availability(offset: number): AvailabilityMetadata {
    const row = this.db
      .prepare('SELECT data FROM availability WHERE offset=?')
      .get(offset) as { data: string } | undefined;
    return row
      ? (JSON.parse(row.data) as AvailabilityMetadata)
      : { status: 'observed' };
  }
  sourceComplete(record: StructuralRecord): boolean {
    if (this.availability(record.offset).status !== 'observed') return false;
    let current = record;
    while (current.parent !== -1) {
      const metadata = this.availability(current.parent);
      // A partial capture remains partial when following its value reference.
      if (
        metadata.status === 'truncated' &&
        metadata.valueId === this.id(current.offset)
      )
        return false;
      current = this.reader.record(current.parent);
    }
    return true;
  }
  node(record: StructuralRecord): EvidenceNode {
    const id = this.id(record.offset);
    const pointer = this.reader.pointer(record);
    return {
      id,
      kind: record.kind,
      parentId: record.parent === -1 ? undefined : this.id(record.parent),
      ordinal: record.ordinal,
      key:
        record.parent !== -1 &&
        this.reader.record(record.parent).kind === 'object'
          ? this.text(this.reader.key(record), record.offset, 'key')
          : undefined,
      pointer: {
        ...this.text(pointer.text, record.offset, 'pointer'),
        ambiguity: pointer.ambiguous ? 'possible' : 'none',
      },
      childCount: record.count,
      availability: this.availability(record.offset),
      payload: {
        format: 'errorcore-structure-v1',
        recordOffset: record.offset,
      },
      provenance: {
        captureId: this.capture.captureId,
        evidenceId: id,
        origin: 'direct_observation',
      },
      structureProvenance: {
        captureId: this.capture.captureId,
        evidenceId: id,
        origin: 'derived_structure',
      },
    };
  }
}
