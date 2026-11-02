import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * File bucket.
 *
 * Every uploaded file lives on a directory that is mounted from the host, so the
 * data survives container rebuilds. The database only stores the path *relative*
 * to the bucket root, which means the volume can be remounted anywhere without
 * rewriting a single row.
 */

export interface StoredFile {
  relativePath: string;
  fileName: string;
  size: number;
  mimeType: string;
}

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/** Removes control characters without embedding them in the source file. */
function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 31 && code !== 127;
    })
    .join('');
}

export class StorageService {
  constructor(private readonly uploadsDir: string) {}

  /** Creates the bucket directory tree. Safe to call on every boot. */
  ensureDirectories(): void {
    fs.mkdirSync(this.uploadsDir, { recursive: true });
  }

  /** Strips directory components and unsafe characters from a client filename. */
  sanitizeFileName(originalName: string): string {
    const base = path.basename(originalName ?? '').replace(/[\\/]/g, '_');
    const cleaned = stripControlCharacters(base).replace(/[<>:"|?*]/g, '_').trim();

    if (cleaned.length === 0) return 'file';
    return cleaned.length > 120 ? cleaned.slice(-120) : cleaned;
  }

  /**
   * Writes a file into the bucket.
   *
   * Files are bucketed by year and month so no single directory grows unbounded.
   */
  async save(buffer: Buffer, originalName: string, mimeType: string): Promise<StoredFile> {
    this.ensureDirectories();

    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const directory = path.join(this.uploadsDir, year, month);

    fs.mkdirSync(directory, { recursive: true });

    const sanitized = this.sanitizeFileName(originalName);
    const uniqueName = `${crypto.randomUUID()}-${sanitized}`;
    const absolutePath = path.join(directory, uniqueName);

    await fs.promises.writeFile(absolutePath, buffer);

    return {
      relativePath: path.posix.join(year, month, uniqueName),
      fileName: sanitized,
      size: buffer.byteLength,
      mimeType,
    };
  }

  /**
   * Resolves a stored relative path to an absolute path.
   *
   * The resolved path is verified to stay inside the bucket, which makes path
   * traversal impossible even if a malicious value reaches the database.
   */
  resolve(relativePath: string): string {
    if (!relativePath || typeof relativePath !== 'string') {
      throw new StorageError('A file path is required.', 'missing_path', 400);
    }

    const root = path.resolve(this.uploadsDir);
    const candidate = path.resolve(root, relativePath);

    if (candidate !== root && !candidate.startsWith(root + path.sep)) {
      throw new StorageError('The file path is outside the storage bucket.', 'invalid_path', 400);
    }

    return candidate;
  }

  async read(relativePath: string): Promise<Buffer> {
    const absolutePath = this.resolve(relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new StorageError('The stored file is missing.', 'file_missing', 404);
    }
    return fs.promises.readFile(absolutePath);
  }

  stat(relativePath: string): fs.Stats {
    const absolutePath = this.resolve(relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new StorageError('The stored file is missing.', 'file_missing', 404);
    }
    return fs.statSync(absolutePath);
  }

  async remove(relativePath: string): Promise<boolean> {
    const absolutePath = this.resolve(relativePath);
    if (!fs.existsSync(absolutePath)) return false;
    await fs.promises.unlink(absolutePath);
    return true;
  }

  exists(relativePath: string): boolean {
    try {
      return fs.existsSync(this.resolve(relativePath));
    } catch {
      return false;
    }
  }
}
