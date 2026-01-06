import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nowMs, publishStorageEvent } from './diagnostics.js';
import { type Todo, TodosSchema } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TODO_FILE = join(__dirname, '../../todos.json');

const IO_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 30_000;

function getJsonIndentation(): number {
  const raw = process.env.TODOKIT_JSON_PRETTY?.trim().toLowerCase();
  if (!raw) return 2;
  if (raw === '0' || raw === 'false') return 0;
  return 2;
}

interface TodoCache {
  todos: Todo[];
  mtimeMs: number | null;
}

let cache: TodoCache | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const TRANSIENT_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const code = error.code;
  return typeof code === 'string' ? code : undefined;
}

function isNotFoundError(error: unknown): boolean {
  return getErrorCode(error) === 'ENOENT';
}

function isTransientError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code !== undefined && TRANSIENT_ERROR_CODES.has(code);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function noop(): void {
  // Intentionally empty
}

function getTodoFilePath(): string {
  const override = process.env.TODOKIT_TODO_FILE?.trim();
  if (override) {
    return resolve(override);
  }
  return DEFAULT_TODO_FILE;
}

function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
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

async function getFileMtime(path: string): Promise<number | null> {
  try {
    const stats = await withTimeout(
      stat(path),
      IO_TIMEOUT_MS,
      'File stat timed out'
    );
    return stats.mtimeMs;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    if (isAbortError(error)) throw error;
    throw error;
  }
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, {
      encoding: 'utf8',
      signal: AbortSignal.timeout(IO_TIMEOUT_MS),
    });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    if (isAbortError(error)) throw new Error('File read timed out');
    throw error;
  }
}

async function loadTodos(path: string): Promise<Todo[]> {
  const raw = await readFileIfExists(path);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  const result = TodosSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error('Invalid todo storage format');
  }
  return result.data;
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

async function writeFileAtomic(
  path: string,
  contents: string
): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(tempPath, contents, {
      encoding: 'utf8',
      flush: true,
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
    return await renameWithRetryCount(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(noop);
  }
}

async function saveTodos(path: string, todos: Todo[]): Promise<void> {
  const start = nowMs();
  const payload = `${JSON.stringify(todos, null, getJsonIndentation())}\n`;
  const renameRetries = await writeFileAtomic(path, payload);
  cache = { todos, mtimeMs: await getFileMtime(path) };

  publishStorageEvent({
    v: 1,
    kind: 'storage',
    op: 'write',
    at: new Date().toISOString(),
    durationMs: Math.max(0, nowMs() - start),
    todoCount: todos.length,
    renameRetries,
  });
}

export async function readTodos(): Promise<readonly Todo[]> {
  const start = nowMs();
  await writeQueue;
  const path = getTodoFilePath();
  const mtimeMs = await getFileMtime(path);
  if (cache?.mtimeMs === mtimeMs) {
    publishStorageEvent({
      v: 1,
      kind: 'storage',
      op: 'read',
      at: new Date().toISOString(),
      durationMs: Math.max(0, nowMs() - start),
      cacheHit: true,
      todoCount: cache.todos.length,
    });
    return cache.todos;
  }
  const todos = await loadTodos(path);
  cache = { todos, mtimeMs };

  publishStorageEvent({
    v: 1,
    kind: 'storage',
    op: 'read',
    at: new Date().toISOString(),
    durationMs: Math.max(0, nowMs() - start),
    cacheHit: false,
    todoCount: todos.length,
  });
  return todos;
}

export async function withTodos<T>(
  mutate: (todos: Todo[]) => { todos: Todo[]; result: T }
): Promise<T> {
  return enqueueWrite(async () => {
    const path = getTodoFilePath();
    const current = await loadTodos(path);
    cache = { todos: current, mtimeMs: await getFileMtime(path) };
    const { todos, result } = mutate(current);
    if (todos !== current) {
      await saveTodos(path, todos);
    }
    return result;
  });
}

export async function closeDb(): Promise<void> {
  const start = nowMs();
  await writeQueue;
  writeQueue = Promise.resolve();
  cache = null;

  publishStorageEvent({
    v: 1,
    kind: 'storage',
    op: 'close',
    at: new Date().toISOString(),
    durationMs: Math.max(0, nowMs() - start),
  });
}
