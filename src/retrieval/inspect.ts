import { bounded, jsonBytes } from '../limits.js';
import { fail, integer } from '../errors.js';
import type { StructuralRecord } from '../indexing/format.js';
import type { EvidenceNodeView, InspectOptions } from '../types/index.js';
import type { RetrievalContext } from './context.js';
import type { Cursors } from './cursors.js';
import { page } from './pages.js';

export function inspect(
  context: RetrievalContext,
  record: StructuralRecord,
  options: InspectOptions,
  budget: number,
  cursors: Cursors,
): EvidenceNodeView {
  const limit = integer(options.limit, 50, 1, 1000);
  const depth = integer(options.depth, 1, 1, 4);
  const binding = (r: StructuralRecord, level: number): string =>
    `inspect:${context.id(r.offset)}:${Math.max(level, 1)}`;
  const start = cursors.decode(options.cursor, binding(record, depth));
  let used = 0;
  function empty(
    r: StructuralRecord,
    at: number,
    level: number,
  ): EvidenceNodeView {
    return {
      node: context.node(r),
      children: [],
      page: page(cursors, binding(r, level), r.count, at, 0),
      responseComplete: level === 0 || at === r.count,
    };
  }
  const result = empty(record, start, depth);
  bounded(result, budget);
  function fill(
    view: EvidenceNodeView,
    r: StructuralRecord,
    at: number,
    level: number,
  ): void {
    if (level === 0) return;
    for (const child of context.children(r, at)) {
      if (used >= limit) break;
      const childView = empty(child, 0, level - 1);
      view.children.push(childView);
      view.page = page(
        cursors,
        binding(r, level),
        r.count,
        at,
        view.children.length,
      );
      if (jsonBytes(result) > budget) {
        view.children.pop();
        view.page = page(
          cursors,
          binding(r, level),
          r.count,
          at,
          view.children.length,
        );
        break;
      }
      used++;
      fill(childView, child, 0, level - 1);
    }
    view.responseComplete =
      view.page.remaining === 0 &&
      view.children.every((child) => child.responseComplete);
  }
  fill(result, record, start, depth);
  if (record.count > start && !result.children.length) fail('RESOURCE_LIMIT');
  return bounded(result, budget);
}
