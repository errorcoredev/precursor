import type { EvidenceManifest } from '../types/index.js';

export interface CaptureFiles {
  captureId: string;
  directory: string;
  source: string;
  structure: string;
  database: string;
  manifest: string;
}
export interface StoredCapture extends CaptureFiles {
  metadata: EvidenceManifest;
  cache: string;
}
/** Trusted storage implementation. Retrieval callers never supply filesystem paths. */
export interface EvidenceStorage {
  stage(): Promise<CaptureFiles>;
  commit(stage: CaptureFiles, manifest: EvidenceManifest): Promise<void>;
  discard(stage: CaptureFiles): Promise<void>;
  open(captureId: string): Promise<StoredCapture>;
  cursorKey(): Promise<Buffer>;
}
