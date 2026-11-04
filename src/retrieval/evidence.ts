import { fail, integer } from '../errors.js';
import { bounded, jsonBytes } from '../limits.js';
import type { StructuralRecord } from '../indexing/format.js';
import type { EvidenceOptions, EvidenceResult } from '../types/index.js';
import type { RetrievalContext } from './context.js';
import type { Cursors } from './cursors.js';
import { page } from './pages.js';

export function evidence(
  context: RetrievalContext,
  record: StructuralRecord,
  options: EvidenceOptions,
  budget: number,
  cursors: Cursors,
): EvidenceResult {
  const limit = integer(options.limit, 50, 1, 1000);
  const units = integer(options.sliceUnits, 4096, 1, 262144);
  const part = options.part ?? 'value';
  if (!['value', 'key', 'pointer'].includes(part)) fail('INVALID_ARGUMENT');
  const binding = `evidence:${context.id(record.offset)}:${part}`;
  const start = cursors.decode(options.cursor, binding);
  const node = context.node(record);
  const base = {
    node,
    sourceComplete: context.sourceComplete(record),
    responseComplete: true,
  };
  if (part === 'value' && node.availability.provenance) {
    if (start !== 0) fail('INVALID_CURSOR');
    const availability = node.availability;
    if (
      availability.status === 'observed' ||
      availability.status === 'truncated'
    ) {
      if (availability.valueId)
        return bounded(
          { ...base, kind: 'reference', valueId: availability.valueId },
          budget,
        );
      return bounded(
        {
          ...base,
          sourceComplete: false,
          kind: 'unavailable',
          availability: {
            status: 'unresolved',
            provenance: availability.provenance!,
          },
        },
        budget,
      );
    }
    return bounded({ ...base, kind: 'unavailable', availability }, budget);
  }
  if (
    part !== 'value' ||
    record.kind === 'string' ||
    record.kind === 'number'
  ) {
    let text: string | undefined;
    if (part === 'pointer') text = context.reader.pointer(record).text;
    if (part === 'key') {
      if (
        record.parent === -1 ||
        context.reader.record(record.parent).kind !== 'object'
      )
        fail('INVALID_ARGUMENT');
      text = context.reader.key(record);
    }
    const total = text?.length ?? record.length;
    if (start > total) fail('INVALID_CURSOR');
    let length = Math.min(units, total - start);
    while (true) {
      const end = start + length;
      const result: EvidenceResult = {
        ...base,
        kind: 'text',
        part,
        encoding:
          record.kind === 'number' && part === 'value'
            ? 'number-lexeme'
            : 'utf16-code-units',
        value:
          text === undefined
            ? context.reader.scalar(record, start, length)
            : text.slice(start, end),
        start,
        total,
        responseComplete: end === total,
        nextCursor: end < total ? cursors.encode(binding, end) : undefined,
      };
      if (jsonBytes(result) <= budget) return result;
      if (length <= 1) fail('RESOURCE_LIMIT');
      length = Math.max(1, Math.floor(length / 2));
    }
  }
  if (record.kind === 'null' || record.kind === 'boolean') {
    if (start !== 0) fail('INVALID_CURSOR');
    return bounded(
      {
        ...base,
        kind: 'scalar',
        value: record.kind === 'null' ? null : record.booleanValue,
      },
      budget,
    );
  }
  const result: EvidenceResult = {
    ...base,
    responseComplete: start === record.count,
    kind: 'collection',
    entries: [],
    page: page(cursors, binding, record.count, start, 0),
  };
  for (const child of context.children(record, start)) {
    if (result.entries.length >= limit) break;
    result.entries.push(context.node(child));
    result.page = page(
      cursors,
      binding,
      record.count,
      start,
      result.entries.length,
    );
    if (jsonBytes(result) > budget) {
      result.entries.pop();
      result.page = page(
        cursors,
        binding,
        record.count,
        start,
        result.entries.length,
      );
      break;
    }
  }
  if (record.count > start && result.entries.length === 0)
    fail('RESOURCE_LIMIT');
  result.responseComplete = result.page.remaining === 0;
  return bounded(result, budget);
}
