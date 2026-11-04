export type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_CURSOR'
  | 'CAPTURE_NOT_FOUND'
  | 'NODE_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_JSON'
  | 'RESOURCE_LIMIT'
  | 'ABORTED'
  | 'STORAGE_ERROR'
  | 'INTEGRITY_ERROR'
  | 'UNSUPPORTED_VERSION';

export class EvidenceError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'EvidenceError';
  }
}

export function fail(code: ErrorCode): never {
  throw new EvidenceError(code);
}
export function safeError(error: unknown, fallback: ErrorCode): EvidenceError {
  return error instanceof EvidenceError ? error : new EvidenceError(fallback);
}
export function integer(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = value === undefined ? fallback : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < min || n > max)
    fail('INVALID_ARGUMENT');
  return n;
}
export function optionsObject(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_ARGUMENT');
}
export const CAPTURE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function captureId(value: unknown): string {
  if (typeof value !== 'string' || !CAPTURE_RE.test(value))
    fail('INVALID_ARGUMENT');
  return value;
}
export function parseNodeId(value: unknown): {
  capture: string;
  offset: number;
} {
  if (typeof value !== 'string' || value.length > 64) fail('INVALID_ARGUMENT');
  const [capture, location, extra] = value.split(':');
  if (!location || extra !== undefined || !/^(0|[1-9][0-9]*)$/.test(location))
    fail('INVALID_ARGUMENT');
  return {
    capture: captureId(capture),
    offset: integer(Number(location), 0, 16, Number.MAX_SAFE_INTEGER),
  };
}
export const nodeId = (capture: string, offset: number): string =>
  `${capture}:${offset}`;
