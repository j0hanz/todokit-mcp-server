import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const TRANSIENT_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}

export function isNotFoundError(error: unknown): boolean {
  return getErrorCode(error) === 'ENOENT';
}

function isTransientError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code !== undefined && TRANSIENT_ERROR_CODES.has(code);
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error(message);
      error.name = 'AbortError';
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function getFileMtime(
  path: string,
  timeoutMs: number
): Promise<number | null> {
  try {
    const stats = await withTimeout(
      stat(path),
      timeoutMs,
      'File stat timed out'
    );
    return stats.mtimeMs;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    if (isAbortError(error)) throw error;
    throw error;
  }
}

export async function readFileIfExists(
  path: string,
  timeoutMs: number
): Promise<string | null> {
  try {
    return await readFile(path, {
      encoding: 'utf8',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    if (isAbortError(error)) throw new Error('File read timed out');
    throw error;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tryRename(from: string, to: string): Promise<Error | null> {
  try {
    await rename(from, to);
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function shouldRetry(error: Error, attempt: number): boolean {
  return isTransientError(error) && attempt < 2;
}

async function renameWithRetryCount(from: string, to: string): Promise<number> {
  let retries = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const error = await tryRename(from, to);
    if (!error) return retries;
    if (!shouldRetry(error, attempt)) throw error;
    retries += 1;
    await delay(50 * (attempt + 1));
  }
  return retries;
}

export async function writeFileAtomic(
  path: string,
  contents: string,
  timeoutMs: number
): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(tempPath, contents, {
      encoding: 'utf8',
      flush: true,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return await renameWithRetryCount(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
}
