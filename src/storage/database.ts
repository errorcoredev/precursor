import { DatabaseSync } from 'node:sqlite';
import type { SemanticRecord } from '../types/index.js';

export function database(path: string, readOnly = false): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly });
  db.exec(
    'PRAGMA busy_timeout=5000; PRAGMA cache_size=-2048; PRAGMA temp_store=FILE;',
  );
  return db;
}
export function createDatabase(path: string): DatabaseSync {
  const db = database(path);
  db.exec(`
    PRAGMA journal_mode=DELETE;
    PRAGMA synchronous=FULL;
    CREATE TABLE nodes(offset INTEGER PRIMARY KEY);
    CREATE TABLE operations(offset INTEGER PRIMARY KEY, source_key TEXT, data TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 3);
    CREATE INDEX operation_sources ON operations(source_key);
    CREATE INDEX operation_order ON operations(priority, offset);
    CREATE TABLE relationships(offset INTEGER PRIMARY KEY, from_key TEXT, to_key TEXT, from_offset INTEGER, to_offset INTEGER, from_state TEXT, to_state TEXT, type TEXT NOT NULL, data TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 3);
    CREATE INDEX edge_from ON relationships(from_offset);
    CREATE INDEX edge_to ON relationships(to_offset);
    CREATE INDEX edge_order ON relationships(priority,offset);
    CREATE TABLE failures(offset INTEGER PRIMARY KEY, operation_key TEXT, operation_offset INTEGER, resolution TEXT, data TEXT NOT NULL);
    CREATE INDEX failure_operation ON failures(operation_offset);
    CREATE TABLE availability(offset INTEGER PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
  `);
  return db;
}

export function semanticSink(
  db: DatabaseSync,
): (record: SemanticRecord) => void {
  const node = db.prepare('INSERT OR IGNORE INTO nodes VALUES (?)');
  const operation = db.prepare(
    'INSERT INTO operations(offset,source_key,data) VALUES (?,?,?)',
  );
  const relationship = db.prepare(
    'INSERT INTO relationships(offset,from_key,to_key,type,data) VALUES (?,?,?,?,?)',
  );
  const failure = db.prepare(
    'INSERT INTO failures(offset,operation_key,operation_offset,data) VALUES (?,?,?,?)',
  );
  const availability = db.prepare('INSERT INTO availability VALUES (?,?,?)');
  return (record) => {
    node.run(record.offset);
    switch (record.type) {
      case 'operation':
        operation.run(
          record.offset,
          record.sourceKey ?? null,
          JSON.stringify(record.data),
        );
        break;
      case 'relationship':
        relationship.run(
          record.offset,
          record.fromKey ?? null,
          record.toKey ?? null,
          record.data.type,
          JSON.stringify(record.data),
        );
        break;
      case 'failure':
        failure.run(
          record.offset,
          record.operationKey ?? null,
          record.directOperation ?? null,
          JSON.stringify(record.data),
        );
        break;
      case 'availability':
        availability.run(
          record.offset,
          record.data.status,
          JSON.stringify(record.data),
        );
        break;
    }
  };
}

export function cacheDatabase(path: string): DatabaseSync {
  const db = database(path);
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS nodes(offset INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS checkpoints(parent INTEGER NOT NULL, ordinal INTEGER NOT NULL, offset INTEGER NOT NULL, PRIMARY KEY(parent,ordinal));
  `);
  return db;
}

export function count(
  db: DatabaseSync,
  table: 'operations' | 'relationships' | 'failures',
): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
}
