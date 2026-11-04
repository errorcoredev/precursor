import { fail, integer, optionsObject } from './errors.js';
import type { Limits } from './types/index.js';

export function limitsFor(options: Partial<Limits> = {}): Limits {
  optionsObject(options);
  const maxOutputBytes = integer(
    options.maxOutputBytes,
    1048576,
    4096,
    1048576,
  );
  return {
    maxOutputBytes,
    outputBytes: integer(
      options.outputBytes,
      Math.min(65536, maxOutputBytes),
      4096,
      maxOutputBytes,
    ),
    maxDepth: integer(options.maxDepth, 256, 1, 1024),
    maxKeyBytes: integer(options.maxKeyBytes, 65536, 2, 1048576),
    maxPathBytes: integer(options.maxPathBytes, 262144, 2, 2097152),
  };
}
export const outputBudget = (value: unknown, limits: Limits): number =>
  integer(value, limits.outputBytes, 4096, limits.maxOutputBytes);
export const jsonBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value));
export function bounded<T>(value: T, budget: number): T {
  if (jsonBytes(value) > budget) fail('RESOURCE_LIMIT');
  return value;
}
