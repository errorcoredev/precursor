import { fail } from '../errors.js';
import type { PageState } from '../types/index.js';
import type { Cursors } from './cursors.js';
export function page(
  cursors: Cursors,
  binding: string,
  total: number,
  start: number,
  returned: number,
  keepEndCursor = false,
): PageState {
  if (start > total || start + returned > total) fail('INVALID_CURSOR');
  const remaining = total - start - returned;
  return {
    total,
    returned,
    remaining,
    nextCursor: remaining
      ? cursors.encode(binding, start + returned)
      : undefined,
    endCursor: keepEndCursor
      ? cursors.encode(binding, start + returned)
      : undefined,
  };
}
