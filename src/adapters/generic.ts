import type { CaptureSchemaAdapter } from '../types/index.js';
export const genericJsonAdapter: CaptureSchemaAdapter = {
  id: 'generic-json',
  create: () => ({ start() {}, end() {}, finish() {} }),
};
