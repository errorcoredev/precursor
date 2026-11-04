import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { genericJsonAdapter } from './adapters/generic.js';
import { exampleErrorcoreAdapter } from './adapters/example.js';
import { compile } from './compiler/compile.js';
import {
  captureId,
  fail,
  optionsObject,
  parseNodeId,
  safeError,
} from './errors.js';
import { limitsFor, outputBudget } from './limits.js';
import { RetrievalContext } from './retrieval/context.js';
import { Cursors } from './retrieval/cursors.js';
import { evidence } from './retrieval/evidence.js';
import { inspect } from './retrieval/inspect.js';
import { overview } from './retrieval/overview.js';
import { LocalEvidenceStorage } from './storage/local.js';
import type { EvidenceStorage } from './storage/contracts.js';
import type {
  CaptureSchemaAdapter,
  CompileOptions,
  EvidenceEngine,
  EvidenceOptions,
  InspectOptions,
  Limits,
  OverviewOptions,
} from './types/index.js';

export interface EngineOptions {
  storage: EvidenceStorage;
  adapters?: CaptureSchemaAdapter[];
  limits?: Partial<Limits>;
}
export function createEvidenceEngine(options: EngineOptions): EvidenceEngine {
  optionsObject(options);
  const limits = limitsFor(options.limits);
  const adapters = new Map<string, CaptureSchemaAdapter>();
  for (const adapter of [
    genericJsonAdapter,
    exampleErrorcoreAdapter,
    ...(options.adapters ?? []),
  ]) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(adapter.id) || adapters.has(adapter.id))
      fail('INVALID_ARGUMENT');
    adapters.set(adapter.id, adapter);
  }
  async function retrieve<T>(
    id: string,
    action: (context: RetrievalContext, cursors: Cursors) => T,
  ): Promise<T> {
    captureId(id);
    let context: RetrievalContext | undefined;
    try {
      const stored = await options.storage.open(id);
      const cursors = new Cursors(await options.storage.cursorKey());
      context = new RetrievalContext(stored);
      return action(context, cursors);
    } catch (error) {
      throw safeError(error, 'STORAGE_ERROR');
    } finally {
      try {
        context?.close();
      } catch (error) {
        throw safeError(error, 'STORAGE_ERROR');
      }
    }
  }
  return {
    async compileRuntimeState(input, opts = {}) {
      optionsObject(opts);
      const adapter = adapters.get(opts.adapterId ?? 'generic-json');
      if (!adapter) fail('INVALID_ARGUMENT');
      try {
        return await compile(input, opts, options.storage, adapter, limits);
      } catch (error) {
        throw safeError(error, 'STORAGE_ERROR');
      }
    },
    async getOverview(id, opts = {}) {
      optionsObject(opts);
      const budget = outputBudget(opts.maxBytes, limits);
      return retrieve(id, (context, cursors) =>
        overview(context, opts, budget, cursors),
      );
    },
    async inspectNode(id, opts = {}) {
      optionsObject(opts);
      const parsed = parseNodeId(id);
      const budget = outputBudget(opts.maxBytes, limits);
      return retrieve(parsed.capture, (context, cursors) =>
        inspect(context, context.get(parsed.offset), opts, budget, cursors),
      );
    },
    async getEvidence(id, opts = {}) {
      optionsObject(opts);
      const parsed = parseNodeId(id);
      const budget = outputBudget(opts.maxBytes, limits);
      return retrieve(parsed.capture, (context, cursors) =>
        evidence(context, context.get(parsed.offset), opts, budget, cursors),
      );
    },
  };
}

let defaultEngine: EvidenceEngine | undefined;
function engine(): EvidenceEngine {
  return (defaultEngine ??= createEvidenceEngine({
    storage: new LocalEvidenceStorage(resolve('.errorcore-evidence')),
  }));
}
export const compileRuntimeState = (
  input: Readable,
  options?: CompileOptions,
) => engine().compileRuntimeState(input, options);
export const getOverview = (captureId: string, options?: OverviewOptions) =>
  engine().getOverview(captureId, options);
export const inspectNode = (nodeId: string, options?: InspectOptions) =>
  engine().inspectNode(nodeId, options);
export const getEvidence = (nodeId: string, options?: EvidenceOptions) =>
  engine().getEvidence(nodeId, options);
export { LocalEvidenceStorage, genericJsonAdapter, exampleErrorcoreAdapter };
export { EvidenceError } from './errors.js';
export type * from './types/index.js';
export type * from './storage/contracts.js';
