import { fail, nodeId } from '../errors.js';
import type {
  AdapterContext,
  AdapterSession,
  AvailabilityMetadata,
  AvailabilityStatus,
  CaptureSchemaAdapter,
  Endpoint,
  Provenance,
  RelationshipType,
  StructuralEvent,
  TextReference,
} from '../types/index.js';

const STATUSES = new Set<AvailabilityStatus>([
  'observed',
  'redacted',
  'truncated',
  'not_captured',
  'unknown',
  'unresolved',
]);
const RELATIONSHIPS = new Set<RelationshipType>([
  'parent',
  'call',
  'await',
  'trigger',
  'sequence',
  'dependency',
]);
const FIELDS = new Set([
  '$schema',
  '$availability',
  '$runtimeType',
  'reason',
  'value',
  'id',
  'label',
  'correlationId',
  'snapshot',
  'status',
  'from',
  'to',
  'type',
  'operationId',
  'message',
  'primary',
]);
type Role = 'operations' | 'relationships' | 'failures';
interface Frame {
  event: StructuralEvent;
  section?: Role;
  role?: Role;
  fields: Map<string, StructuralEvent>;
  duplicate: boolean;
}

class ExampleSession implements AdapterSession {
  private stack: Frame[] = [];
  private schemaValid = false;
  private rootSections = new Set<string>();
  constructor(private readonly context: AdapterContext) {}
  private id(offset: number): string {
    return nodeId(this.context.captureId, offset);
  }
  private provenance(offset: number): Provenance {
    return {
      captureId: this.context.captureId,
      evidenceId: this.id(offset),
      origin: 'upstream_metadata',
    };
  }
  private text(event?: StructuralEvent): TextReference | undefined {
    if (!event || event.kind !== 'string') return undefined;
    return {
      preview: (event.preview ?? '').slice(0, 256),
      length: event.length,
      complete: event.length <= 256,
      evidenceId: this.id(event.offset),
    };
  }
  private value(event?: StructuralEvent): string | undefined {
    return event?.kind === 'string' && event.length <= 1024
      ? event.preview
      : undefined;
  }
  private sourceKey(event?: StructuralEvent): string | undefined {
    const text = this.value(event);
    return text === undefined
      ? undefined
      : Buffer.from(text, 'utf16le').toString('base64');
  }
  private endpoint(event?: StructuralEvent): Endpoint {
    return { sourceId: this.text(event), resolution: 'unresolved' };
  }
  start(event: StructuralEvent): void {
    const parent = this.stack.at(-1);
    let section: Role | undefined;
    if (
      parent?.event.offset === 16 &&
      event.key &&
      ['operations', 'relationships', 'failures'].includes(event.key)
    ) {
      if (event.kind !== 'array' || this.rootSections.has(event.key))
        fail('INVALID_INPUT');
      this.rootSections.add(event.key);
      section = event.key as Role;
    }
    const role = parent?.section;
    if (role && event.kind !== 'object') fail('INVALID_INPUT');
    if (parent && event.key && FIELDS.has(event.key)) {
      if (parent.fields.has(event.key)) parent.duplicate = true;
      parent.fields.set(event.key, event);
    }
    this.stack.push({
      event,
      section,
      role,
      fields: new Map(),
      duplicate: false,
    });
  }
  end(event: StructuralEvent): void {
    const frame = this.stack.pop();
    if (!frame || frame.event.offset !== event.offset) fail('INVALID_INPUT');
    const parent = this.stack.at(-1);
    if (parent && event.key && FIELDS.has(event.key))
      parent.fields.set(event.key, event);
    if (event.kind !== 'object') return;
    const f = frame.fields;
    if (event.offset === 16) {
      if (frame.duplicate) fail('INVALID_INPUT');
      this.schemaValid =
        this.value(f.get('$schema')) === 'errorcore.example/v1';
    }
    if ((frame.role || f.has('$availability')) && frame.duplicate)
      fail('INVALID_INPUT');
    if (f.has('$availability')) this.availability(event.offset, f);
    const evidenceId = this.id(event.offset);
    const provenance = this.provenance(event.offset);
    if (frame.role === 'operations') {
      const source = f.get('id');
      this.context.emit({
        type: 'operation',
        offset: event.offset,
        sourceKey: this.sourceKey(source),
        data: {
          id: evidenceId,
          evidenceId,
          sourceId: this.text(source),
          label: this.text(f.get('label')),
          correlationId: this.text(f.get('correlationId')),
          snapshotId: f.has('snapshot')
            ? this.id(f.get('snapshot')!.offset)
            : undefined,
          provenance,
        },
      });
      if (this.value(f.get('status')) === 'failed')
        this.context.emit({
          type: 'failure',
          offset: event.offset,
          directOperation: event.offset,
          data: {
            id: evidenceId,
            evidenceId: this.id(f.get('status')!.offset),
            operation: { operationId: evidenceId, resolution: 'resolved' },
            primary: false,
            provenance: this.provenance(f.get('status')!.offset),
          },
        });
    }
    if (frame.role === 'relationships') {
      const type = this.value(f.get('type')) as RelationshipType;
      if (!RELATIONSHIPS.has(type)) fail('INVALID_INPUT');
      this.context.emit({
        type: 'relationship',
        offset: event.offset,
        fromKey: this.sourceKey(f.get('from')),
        toKey: this.sourceKey(f.get('to')),
        data: {
          id: evidenceId,
          evidenceId,
          type,
          from: this.endpoint(f.get('from')),
          to: this.endpoint(f.get('to')),
          provenance,
        },
      });
    }
    if (frame.role === 'failures')
      this.context.emit({
        type: 'failure',
        offset: event.offset,
        operationKey: this.sourceKey(f.get('operationId')),
        data: {
          id: evidenceId,
          evidenceId,
          operation: this.endpoint(f.get('operationId')),
          message: this.text(f.get('message')),
          primary:
            f.get('primary')?.kind === 'boolean' &&
            f.get('primary')?.booleanValue === true,
          provenance,
        },
      });
  }
  private availability(
    offset: number,
    fields: Map<string, StructuralEvent>,
  ): void {
    const status = this.value(
      fields.get('$availability'),
    ) as AvailabilityStatus;
    if (!STATUSES.has(status)) fail('INVALID_INPUT');
    const common = {
      provenance: this.provenance(fields.get('$availability')!.offset),
      runtimeType: this.text(fields.get('$runtimeType')),
    };
    let data: AvailabilityMetadata;
    if (status === 'observed')
      data = {
        ...common,
        status,
        valueId: fields.has('value')
          ? this.id(fields.get('value')!.offset)
          : undefined,
      };
    else if (status === 'truncated')
      data = {
        ...common,
        status,
        reason: this.text(fields.get('reason')),
        valueId: fields.has('value')
          ? this.id(fields.get('value')!.offset)
          : undefined,
      };
    else data = { ...common, status, reason: this.text(fields.get('reason')) };
    this.context.emit({ type: 'availability', offset, data });
  }
  finish(): void {
    if (!this.schemaValid || this.stack.length !== 0) fail('INVALID_INPUT');
  }
}

/** An integration example, not Errorcore's production schema. */
export const exampleErrorcoreAdapter: CaptureSchemaAdapter = {
  id: 'errorcore-example-v1',
  create: (context) => new ExampleSession(context),
};
