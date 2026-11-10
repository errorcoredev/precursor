import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  link,
  unlink,
} from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { captureId, fail, safeError } from '../errors.js';
import type { EvidenceManifest } from '../types/index.js';
import type {
  CaptureFiles,
  EvidenceStorage,
  StoredCapture,
} from './contracts.js';
import { hashFile } from './integrity.js';

export class LocalEvidenceStorage implements EvidenceStorage {
  readonly root: string;
  private keyPromise?: Promise<Buffer>;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private files(namespace: string, id: string): CaptureFiles {
    const directory = join(this.root, namespace, captureId(id));
    return {
      captureId: id,
      directory,
      source: join(directory, 'source.json'),
      structure: join(directory, 'structure.bin'),
      database: join(directory, 'evidence.sqlite'),
      manifest: join(directory, 'manifest.json'),
    };
  }

  async stage(): Promise<CaptureFiles> {
    await mkdir(join(this.root, 'staging'), { recursive: true });
    await mkdir(join(this.root, 'captures'), { recursive: true });
    const files = this.files('staging', randomUUID());
    await mkdir(files.directory, { mode: 0o700 });
    return files;
  }

  async commit(stage: CaptureFiles, manifest: EvidenceManifest): Promise<void> {
    if (
      stage.directory !== this.files('staging', stage.captureId).directory ||
      manifest.captureId !== stage.captureId
    )
      fail('INVALID_ARGUMENT');
    const handle = await open(stage.manifest, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(manifest));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(
      stage.directory,
      this.files('captures', stage.captureId).directory,
    );
  }

  async discard(stage: CaptureFiles): Promise<void> {
    const expected = this.files('staging', stage.captureId).directory;
    if (
      stage.directory !== expected ||
      dirname(expected) !== join(this.root, 'staging')
    )
      fail('INVALID_ARGUMENT');
    await rm(expected, { recursive: true, force: true });
  }

  async open(id: string): Promise<StoredCapture> {
    const files = this.files('captures', id);
    let data: string;
    try {
      if ((await stat(files.manifest)).size > 1048576) fail('INTEGRITY_ERROR');
      data = await readFile(files.manifest, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        fail('CAPTURE_NOT_FOUND');
      throw safeError(error, 'STORAGE_ERROR');
    }
    let metadata: EvidenceManifest;
    try {
      metadata = JSON.parse(data) as EvidenceManifest;
    } catch {
      fail('INTEGRITY_ERROR');
    }
    if (metadata.formatVersion !== 1) fail('UNSUPPORTED_VERSION');
    if (
      metadata.captureId !== id ||
      metadata.rootEvidenceId !== `${id}:16` ||
      metadata.captureComplete !== true
    )
      fail('INTEGRITY_ERROR');
    const sizes = await Promise.all([
      stat(files.source),
      stat(files.structure),
      stat(files.database),
    ]);
    if (
      sizes[0].size !== metadata.source.bytes ||
      sizes[1].size !== metadata.structure.bytes ||
      sizes[2].size !== metadata.database.bytes
    )
      fail('INTEGRITY_ERROR');
    await mkdir(join(this.root, 'cache'), { recursive: true });
    return {
      ...files,
      metadata,
      cache: join(this.root, 'cache', `${id}.sqlite`),
    };
  }

  /** Opt-in linear-time integrity verification; normal retrieval checks sizes/format only. */
  async verify(id: string): Promise<{ valid: true }> {
    try {
      const files = await this.open(id);
      const checksums: readonly (readonly [string, string])[] = [
        [files.source, files.metadata.source.sha256],
        [files.structure, files.metadata.structure.sha256],
        [files.database, files.metadata.database.sha256],
      ];
      for (const [path, expected] of checksums) {
        if ((await hashFile(path)) !== expected) fail('INTEGRITY_ERROR');
      }
      return { valid: true };
    } catch (error) {
      throw safeError(error, 'STORAGE_ERROR');
    }
  }

  cursorKey(): Promise<Buffer> {
    return (this.keyPromise ??= this.loadKey());
  }

  private async loadKey(): Promise<Buffer> {
    await mkdir(this.root, { recursive: true });
    const path = join(this.root, 'cursor.key');
    try {
      const key = await readFile(path);
      if (key.length !== 32) fail('INTEGRITY_ERROR');
      return key;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw safeError(error, 'STORAGE_ERROR');
    }
    // Publish a complete key atomically; concurrent creators must use the winner's key.
    const temp = join(this.root, `cursor-${randomUUID()}.tmp`);
    const handle = await open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(randomBytes(32));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await link(temp, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
        throw safeError(error, 'STORAGE_ERROR');
    } finally {
      await unlink(temp);
    }
    const key = await readFile(path);
    if (key.length !== 32) fail('INTEGRITY_ERROR');
    return key;
  }
}
