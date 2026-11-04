import type { Readable } from 'node:stream';

export type JsonKind =
  'object' | 'array' | 'string' | 'number' | 'null' | 'boolean';
export type AvailabilityStatus =
  | 'observed'
  | 'redacted'
  | 'truncated'
  | 'not_captured'
  | 'unknown'
  | 'unresolved';
export interface TextReference {
  preview: string;
  length: number;
  complete: boolean;
  evidenceId: string;
  part?: 'key' | 'pointer' | 'value';
}
export interface Provenance {
  captureId: string;
  evidenceId: string;
  origin: 'direct_observation' | 'upstream_metadata' | 'derived_structure';
}
export type AvailabilityMetadata =
  | {
      status: 'observed';
      provenance?: Provenance;
      valueId?: string;
      runtimeType?: TextReference;
    }
  | {
      status: 'truncated';
      provenance: Provenance;
      valueId?: string;
      reason?: TextReference;
      runtimeType?: TextReference;
    }
  | {
      status: 'redacted' | 'not_captured' | 'unknown' | 'unresolved';
      provenance: Provenance;
      reason?: TextReference;
      runtimeType?: TextReference;
    };
export interface PayloadReference {
  format: 'errorcore-structure-v1';
  recordOffset: number;
}
export interface EvidenceNode {
  id: string;
  kind: JsonKind;
  parentId?: string;
  ordinal: number;
  key?: TextReference;
  pointer: TextReference & { ambiguity: 'possible' | 'none' };
  childCount: number;
  availability: AvailabilityMetadata;
  payload: PayloadReference;
  provenance: Provenance;
  structureProvenance: Provenance;
}
export interface PageState {
  total: number;
  returned: number;
  remaining: number;
  nextCursor?: string;
  /** Overview lanes retain a signed end position, including after exhaustion. */
  endCursor?: string;
}
export interface EvidenceNodeView {
  node: EvidenceNode;
  children: EvidenceNodeView[];
  page: PageState;
  responseComplete: boolean;
}
interface EvidenceBase {
  node: EvidenceNode;
  sourceComplete: boolean;
  responseComplete: boolean;
}
export type EvidenceResult = EvidenceBase &
  (
    | { kind: 'unavailable'; availability: AvailabilityMetadata }
    | { kind: 'reference'; valueId: string }
    | { kind: 'scalar'; value: boolean | null }
    | {
        kind: 'text';
        encoding: 'utf16-code-units' | 'number-lexeme';
        part: 'value' | 'key' | 'pointer';
        value: string;
        start: number;
        total: number;
        nextCursor?: string;
      }
    | { kind: 'collection'; entries: EvidenceNode[]; page: PageState }
  );
export interface ExecutionOperation {
  id: string;
  evidenceId: string;
  sourceId?: TextReference;
  label?: TextReference;
  correlationId?: TextReference;
  snapshotId?: string;
  provenance: Provenance;
}
export type RelationshipType =
  'parent' | 'call' | 'await' | 'trigger' | 'sequence' | 'dependency';
export interface Endpoint {
  sourceId?: TextReference;
  operationId?: string;
  resolution: 'resolved' | 'missing' | 'ambiguous' | 'unresolved';
}
export interface ExecutionEdge {
  id: string;
  type: RelationshipType;
  from: Endpoint;
  to: Endpoint;
  evidenceId: string;
  provenance: Provenance;
}
export interface FailureLocation {
  id: string;
  operation: Endpoint;
  evidenceId: string;
  message?: TextReference;
  primary: boolean;
  provenance: Provenance;
}
export interface ExecutionGraph {
  operations: ExecutionOperation[];
  relationships: ExecutionEdge[];
  operationPage: PageState;
  relationshipPage: PageState;
  completeness: 'unavailable' | 'partial';
  unresolvedEndpoints: number;
  notes: string[];
}
export interface IncidentOverview {
  captureId: string;
  rootEvidenceId: string;
  failures: FailureLocation[];
  failurePage: PageState;
  graph: ExecutionGraph;
  availabilityCounts: Partial<Record<AvailabilityStatus, number>>;
  captureComplete: true;
  captureNotes: string[];
  responseComplete: boolean;
}
export interface IngestionMetrics {
  durationMs: number;
  sourceBytes: number;
  structuralBytes: number;
  nodeCount: number;
  maxDepth: number;
  peakRssBytes: number;
  peakHeapBytes: number;
}
export interface EvidenceManifest {
  formatVersion: 1;
  captureId: string;
  adapterId: string;
  createdAt: string;
  rootEvidenceId: string;
  source: { file: 'source.json'; bytes: number; sha256: string };
  structure: { file: 'structure.bin'; bytes: number; sha256: string };
  database: { file: 'evidence.sqlite'; bytes: number; sha256: string };
  counts: {
    nodes: number;
    operations: number;
    relationships: number;
    failures: number;
  };
  availabilityCounts: Partial<Record<AvailabilityStatus, number>>;
  captureComplete: true;
  graphCompleteness: 'unavailable' | 'partial';
  unresolvedGraphEndpoints: number;
  metrics: IngestionMetrics;
}
export interface Limits {
  outputBytes: number;
  maxOutputBytes: number;
  maxDepth: number;
  maxKeyBytes: number;
  maxPathBytes: number;
}
export interface CompileOptions {
  adapterId?: string;
  signal?: AbortSignal;
  maxBytes?: number;
}
export interface OutputOptions {
  maxBytes?: number;
}
export interface OverviewOptions extends OutputOptions {
  operationLimit?: number;
  relationshipLimit?: number;
  failureLimit?: number;
  operationCursor?: string;
  relationshipCursor?: string;
  failureCursor?: string;
  focusOperationId?: string;
}
export interface InspectOptions extends OutputOptions {
  limit?: number;
  depth?: number;
  cursor?: string;
}
export interface EvidenceOptions extends OutputOptions {
  limit?: number;
  sliceUnits?: number;
  cursor?: string;
  part?: 'value' | 'key' | 'pointer';
}
export interface EvidenceEngine {
  compileRuntimeState(
    input: Readable,
    options?: CompileOptions,
  ): Promise<EvidenceManifest>;
  getOverview(
    captureId: string,
    options?: OverviewOptions,
  ): Promise<IncidentOverview>;
  inspectNode(
    nodeId: string,
    options?: InspectOptions,
  ): Promise<EvidenceNodeView>;
  getEvidence(
    nodeId: string,
    options?: EvidenceOptions,
  ): Promise<EvidenceResult>;
}

/** Structural events are bounded; scalar previews never contain more than 1024 units. */
export interface StructuralEvent {
  offset: number;
  parent: number;
  ordinal: number;
  kind: JsonKind;
  key?: string;
  depth: number;
  preview?: string;
  length: number;
  booleanValue?: boolean;
}
export type SemanticRecord =
  | {
      type: 'operation';
      offset: number;
      sourceKey?: string;
      data: ExecutionOperation;
    }
  | {
      type: 'relationship';
      offset: number;
      fromKey?: string;
      toKey?: string;
      data: ExecutionEdge;
    }
  | {
      type: 'failure';
      offset: number;
      operationKey?: string;
      directOperation?: number;
      data: FailureLocation;
    }
  | { type: 'availability'; offset: number; data: AvailabilityMetadata };
export interface AdapterContext {
  captureId: string;
  emit(record: SemanticRecord): void;
}
export interface AdapterSession {
  start(event: StructuralEvent): void;
  end(event: StructuralEvent): void;
  finish(): void;
}
export interface CaptureSchemaAdapter {
  id: string;
  create(context: AdapterContext): AdapterSession;
}
