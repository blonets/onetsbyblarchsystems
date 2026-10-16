/**
 * Object storage for encrypted backups.
 *
 * The {@link ObjectStore} interface keeps the worker decoupled from the
 * storage backend. Deploy-time note: point this at S3-compatible storage
 * (Dokploy volume or an object-storage service); the filesystem
 * implementation below is complete and suitable for single-VPS deployments.
 */

import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ObjectMetadata {
  contentType?: string;
  [key: string]: string | undefined;
}

export interface ObjectStore {
  put(key: string, data: Uint8Array, meta?: ObjectMetadata): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** keys with the given prefix, oldest first */
  list(prefix: string): Promise<string[]>;
}

/** In-memory store for tests. */
export class InMemoryObjectStore implements ObjectStore {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, data: Uint8Array): Promise<void> {
    this.objects.set(key, Buffer.from(data));
  }

  async get(key: string): Promise<Buffer> {
    const data = this.objects.get(key);
    if (!data) throw new Error(`object not found: ${key}`);
    return data;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

/**
 * Filesystem store: `baseDir/<key>`. Complete for single-VPS Dokploy
 * deployments (bind-mount a persistent volume at `baseDir`).
 */
export class FilesystemObjectStore implements ObjectStore {
  constructor(private readonly baseDir: string) {}

  private path(key: string): string {
    if (key.includes('..')) throw new Error(`unsafe object key: ${key}`);
    return join(this.baseDir, key);
  }

  async put(key: string, data: Uint8Array, _meta?: ObjectMetadata): Promise<void> {
    const path = this.path(key);
    await mkdir(join(this.baseDir, key.split('/').slice(0, -1).join('/')), {
      recursive: true,
    });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }

  async delete(key: string): Promise<void> {
    await unlink(this.path(key));
  }

  async list(prefix: string): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    const out: string[] = [];
    const walk = async (dir: string, rel: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const relPath = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await walk(join(dir, entry.name), relPath);
        else if (relPath.startsWith(prefix)) out.push(relPath);
      }
    };
    await walk(this.baseDir, '');
    return out.sort();
  }
}
