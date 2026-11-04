import { fail, integer, parseNodeId } from '../errors.js';
import { bounded, jsonBytes } from '../limits.js';
import type {
  Endpoint,
  ExecutionEdge,
  ExecutionOperation,
  FailureLocation,
  IncidentOverview,
  OverviewOptions,
} from '../types/index.js';
import type { RetrievalContext } from './context.js';
import type { Cursors } from './cursors.js';
import { page as makePage } from './pages.js';

interface EdgeRow {
  data: string;
  from_offset: number | null;
  to_offset: number | null;
  from_state: Endpoint['resolution'];
  to_state: Endpoint['resolution'];
}
interface FailureRow {
  data: string;
  operation_offset: number | null;
  resolution: Endpoint['resolution'];
}
const page = (...args: Parameters<typeof makePage>) =>
  makePage(args[0], args[1], args[2], args[3], args[4], true);
export function overview(
  context: RetrievalContext,
  options: OverviewOptions,
  budget: number,
  cursors: Cursors,
): IncidentOverview {
  const capture = context.capture.metadata;
  const operationLimit = integer(options.operationLimit, 25, 1, 1000);
  const relationshipLimit = integer(options.relationshipLimit, 50, 1, 1000);
  const failureLimit = integer(options.failureLimit, 10, 1, 1000);
  let focus: number | null = null;
  if (options.focusOperationId !== undefined) {
    const parsed = parseNodeId(options.focusOperationId);
    if (
      parsed.capture !== capture.captureId ||
      !context.db
        .prepare('SELECT 1 FROM operations WHERE offset=?')
        .get(parsed.offset)
    )
      fail('INVALID_ARGUMENT');
    focus = parsed.offset;
  }
  const binding = (part: string): string =>
    `overview:${capture.captureId}:${part}:${focus ?? ''}`;
  const starts = {
    operations: cursors.decode(options.operationCursor, binding('operations')),
    relationships: cursors.decode(
      options.relationshipCursor,
      binding('relationships'),
    ),
    failures: cursors.decode(options.failureCursor, binding('failures')),
  };
  const result: IncidentOverview = {
    captureId: capture.captureId,
    rootEvidenceId: capture.rootEvidenceId,
    captureComplete: true,
    captureNotes: [
      'The received JSON was fully validated and committed. Completeness of the captured runtime is not established; explicit availability markers are summarized separately.',
    ],
    responseComplete: false,
    availabilityCounts: capture.availabilityCounts,
    failures: [],
    failurePage: page(
      cursors,
      binding('failures'),
      capture.counts.failures,
      starts.failures,
      0,
    ),
    graph: {
      operations: [],
      relationships: [],
      operationPage: page(
        cursors,
        binding('operations'),
        capture.counts.operations,
        starts.operations,
        0,
      ),
      relationshipPage: page(
        cursors,
        binding('relationships'),
        capture.counts.relationships,
        starts.relationships,
        0,
      ),
      completeness: capture.graphCompleteness,
      unresolvedEndpoints: capture.unresolvedGraphEndpoints,
      notes: [
        capture.graphCompleteness === 'unavailable'
          ? 'No execution metadata is defined by the selected adapter.'
          : 'Only explicitly recorded execution relationships are represented; source graph completeness is not established.',
      ],
    },
  };
  bounded(result, budget);
  // Reserve independent budget shares so no category can starve another continuation.
  const baseSize = jsonBytes(result);
  const active =
    Number(starts.failures < capture.counts.failures) +
    Number(starts.operations < capture.counts.operations) +
    Number(starts.relationships < capture.counts.relationships);
  const share = Math.floor((budget - baseSize) / Math.max(1, active));
  let allowed = baseSize;
  function failures(): void {
    if (starts.failures >= capture.counts.failures) return;
    allowed += share;
    const rows = context.db
      .prepare(
        'SELECT data,operation_offset,resolution FROM failures ORDER BY offset LIMIT ? OFFSET ?',
      )
      .iterate(failureLimit, starts.failures);
    for (const raw of rows) {
      const row = raw as unknown as FailureRow;
      const value = JSON.parse(row.data) as FailureLocation;
      value.operation.resolution = row.resolution;
      if (row.operation_offset !== null)
        value.operation.operationId = context.id(row.operation_offset);
      result.failures.push(value);
      result.failurePage = page(
        cursors,
        binding('failures'),
        capture.counts.failures,
        starts.failures,
        result.failures.length,
      );
      if (jsonBytes(result) > allowed) {
        result.failures.pop();
        result.failurePage = page(
          cursors,
          binding('failures'),
          capture.counts.failures,
          starts.failures,
          result.failures.length,
        );
        break;
      }
    }
  }
  function operations(): void {
    if (starts.operations >= capture.counts.operations) return;
    allowed += share;
    const query =
      focus === null
        ? context.db
            .prepare(
              'SELECT data FROM operations ORDER BY priority,offset LIMIT ? OFFSET ?',
            )
            .iterate(operationLimit, starts.operations)
        : context.db
            .prepare(
              `SELECT data FROM operations ORDER BY CASE WHEN offset=? THEN 0 WHEN offset IN (SELECT from_offset FROM relationships WHERE to_offset=? UNION SELECT to_offset FROM relationships WHERE from_offset=?) THEN 1 ELSE 2 END, priority,offset LIMIT ? OFFSET ?`,
            )
            .iterate(focus, focus, focus, operationLimit, starts.operations);
    for (const row of query) {
      result.graph.operations.push(
        JSON.parse(row.data as string) as ExecutionOperation,
      );
      result.graph.operationPage = page(
        cursors,
        binding('operations'),
        capture.counts.operations,
        starts.operations,
        result.graph.operations.length,
      );
      if (jsonBytes(result) > allowed) {
        result.graph.operations.pop();
        result.graph.operationPage = page(
          cursors,
          binding('operations'),
          capture.counts.operations,
          starts.operations,
          result.graph.operations.length,
        );
        break;
      }
    }
  }
  function relationships(): void {
    if (starts.relationships >= capture.counts.relationships) return;
    allowed = budget;
    const query =
      focus === null
        ? context.db
            .prepare(
              'SELECT * FROM relationships ORDER BY priority,offset LIMIT ? OFFSET ?',
            )
            .iterate(relationshipLimit, starts.relationships)
        : context.db
            .prepare(
              'SELECT * FROM relationships ORDER BY CASE WHEN from_offset=? OR to_offset=? THEN 0 ELSE 1 END,priority,offset LIMIT ? OFFSET ?',
            )
            .iterate(focus, focus, relationshipLimit, starts.relationships);
    for (const raw of query) {
      const row = raw as unknown as EdgeRow;
      const value = JSON.parse(row.data) as ExecutionEdge;
      value.from.resolution = row.from_state;
      value.to.resolution = row.to_state;
      if (row.from_offset !== null)
        value.from.operationId = context.id(row.from_offset);
      if (row.to_offset !== null)
        value.to.operationId = context.id(row.to_offset);
      result.graph.relationships.push(value);
      result.graph.relationshipPage = page(
        cursors,
        binding('relationships'),
        capture.counts.relationships,
        starts.relationships,
        result.graph.relationships.length,
      );
      if (jsonBytes(result) > allowed) {
        result.graph.relationships.pop();
        result.graph.relationshipPage = page(
          cursors,
          binding('relationships'),
          capture.counts.relationships,
          starts.relationships,
          result.graph.relationships.length,
        );
        break;
      }
    }
  }
  failures();
  operations();
  relationships();
  result.responseComplete =
    !result.failurePage.remaining &&
    !result.graph.operationPage.remaining &&
    !result.graph.relationshipPage.remaining;
  if (
    !result.responseComplete &&
    result.failures.length +
      result.graph.operations.length +
      result.graph.relationships.length ===
      0
  )
    fail('RESOURCE_LIMIT');
  return bounded(result, budget);
}
