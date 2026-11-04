import type { DatabaseSync } from 'node:sqlite';

/** Resolve on disk, retaining ambiguous and absent source IDs explicitly. */
export function resolveGraph(db: DatabaseSync): void {
  db.exec(`
    CREATE TEMP TABLE source_ids AS SELECT source_key, COUNT(*) AS n, MIN(offset) AS target FROM operations WHERE source_key IS NOT NULL GROUP BY source_key;
    CREATE UNIQUE INDEX source_lookup ON source_ids(source_key);
    UPDATE relationships SET
      from_state = CASE WHEN from_key IS NULL THEN 'unresolved' WHEN (SELECT n FROM source_ids WHERE source_key=from_key)>1 THEN 'ambiguous' WHEN (SELECT n FROM source_ids WHERE source_key=from_key)=1 THEN 'resolved' ELSE 'missing' END,
      to_state = CASE WHEN to_key IS NULL THEN 'unresolved' WHEN (SELECT n FROM source_ids WHERE source_key=to_key)>1 THEN 'ambiguous' WHEN (SELECT n FROM source_ids WHERE source_key=to_key)=1 THEN 'resolved' ELSE 'missing' END;
    UPDATE relationships SET
      from_offset = CASE WHEN from_state='resolved' THEN (SELECT target FROM source_ids WHERE source_key=from_key) END,
      to_offset = CASE WHEN to_state='resolved' THEN (SELECT target FROM source_ids WHERE source_key=to_key) END;
    UPDATE failures SET resolution = CASE WHEN operation_offset IS NOT NULL THEN 'resolved' WHEN operation_key IS NULL THEN 'unresolved' WHEN (SELECT n FROM source_ids WHERE source_key=operation_key)>1 THEN 'ambiguous' WHEN (SELECT n FROM source_ids WHERE source_key=operation_key)=1 THEN 'resolved' ELSE 'missing' END;
    UPDATE failures SET operation_offset = COALESCE(operation_offset, CASE WHEN resolution='resolved' THEN (SELECT target FROM source_ids WHERE source_key=operation_key) END);
    UPDATE operations SET priority=0 WHERE offset IN (SELECT operation_offset FROM failures WHERE resolution='resolved');
    WITH RECURSIVE ancestors(offset) AS (
      SELECT offset FROM operations WHERE priority=0
      UNION
      SELECT r.from_offset FROM relationships r JOIN ancestors a ON a.offset=r.to_offset WHERE r.type IN ('parent','call') AND r.from_state='resolved' AND r.to_state='resolved'
    ) UPDATE operations SET priority=1 WHERE priority>1 AND offset IN (SELECT offset FROM ancestors);
    UPDATE operations SET priority=2 WHERE priority>2 AND offset IN (
      SELECT r.from_offset FROM relationships r JOIN operations o ON o.offset=r.to_offset WHERE o.priority<2
      UNION SELECT r.to_offset FROM relationships r JOIN operations o ON o.offset=r.from_offset WHERE o.priority<2
    );
    UPDATE relationships SET priority=MIN(COALESCE((SELECT priority FROM operations WHERE offset=from_offset),3), COALESCE((SELECT priority FROM operations WHERE offset=to_offset),3));
    DROP TABLE source_ids;
  `);
}
