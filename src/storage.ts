import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { nowMs, publishStorageEvent } from './diagnostics.js';
import { createErrorResponse, type ErrorResponse } from './responses.js';
import { type Todo, TodosSchema } from './schema.js';

const TRANSIENT_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const { code } = error;
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

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
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

async function getFileMtime(
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

interface FileMetadata {
  mtimeMs: number;
  size: number;
}

async function getFileMetadataIfExists(
  path: string,
  timeoutMs: number
): Promise<FileMetadata | null> {
  try {
    const stats = await withTimeout(
      stat(path),
      timeoutMs,
      'File stat timed out'
    );
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch (error) {
    if (isNotFoundError(error)) return null;
    if (isAbortError(error)) throw error;
    throw error;
  }
}

async function getFileSize(
  path: string,
  timeoutMs: number
): Promise<number | null> {
  try {
    const stats = await withTimeout(
      stat(path),
      timeoutMs,
      'File stat timed out'
    );
    return stats.size;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function readFileIfExists(
  path: string,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    return await readFile(path, {
      encoding: 'utf8',
      signal: signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (isNotFoundError(error)) return null;
    if (isAbortError(error)) {
      if (signal) throw error;
      throw createAbortError('File read timed out');
    }
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

async function writeFileAtomic(
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

const DEFAULT_TODO_FILE = resolve(process.cwd(), 'todos.json');

const IO_TIMEOUT_MS = 10_000;
const WRITE_TIMEOUT_MS = 30_000;
const LOCK_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_TODO_FILE_BYTES = 5 * 1024 * 1024;
const MAX_CONFLICT_RETRIES = 3;

class StorageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

function createCodedError(code: string, message: string): StorageError {
  return new StorageError(code, message);
}

export function getCodedErrorCode(error: unknown): string | undefined {
  return error instanceof StorageError ? error.code : undefined;
}

function getEnvInt(name: string): number | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function getLockTimeoutMs(): number {
  return getEnvInt('TODOKIT_LOCK_TIMEOUT_MS') ?? LOCK_TIMEOUT_MS;
}

function getMaxTodoFileBytes(): number {
  return (
    getEnvInt('TODOKIT_MAX_TODO_FILE_BYTES') ?? DEFAULT_MAX_TODO_FILE_BYTES
  );
}

function getJsonIndentation(): number {
  const raw = process.env.TODOKIT_JSON_PRETTY?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return 2;
  return 0;
}

interface TodoCache {
  todos: Todo[];
  mtimeMs: number | null;
}

let cache: TodoCache | null = null;
let writeQueue: Promise<void> = Promise.resolve();

function isPathInside(baseDir: string, targetPath: string): boolean {
  const rel = relative(baseDir, targetPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function validatePathSafety(filePath: string): void {
  const cwd = resolve(process.cwd());
  const target = resolve(filePath);
  if (!isPathInside(cwd, target) && !process.env.TODOKIT_ALLOW_OUTSIDE_CWD) {
    throw new Error('Todo file must be within the current working directory');
  }
}

function getTodoFilePath(): string {
  const override = process.env.TODOKIT_TODO_FILE?.trim();
  if (override) {
    const resolved = resolve(override);
    validatePathSafety(resolved);
    return resolved;
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

async function acquireWriteLock(
  todoPath: string,
  timeoutMs: number
): Promise<() => Promise<void>> {
  const lockPath = `${todoPath}.lock`;
  const started = nowMs();

  await mkdir(dirname(todoPath), { recursive: true });

  for (;;) {
    try {
      await writeFile(
        lockPath,
        `${String(process.pid)} ${new Date().toISOString()}\n`,
        { encoding: 'utf8', flag: 'wx' }
      );

      return async () => {
        await rm(lockPath, { force: true }).catch(() => undefined);
      };
    } catch (error: unknown) {
      const code = getErrorCode(error);
      if (code !== 'EEXIST') {
        throw error;
      }

      const elapsedMs = Math.max(0, nowMs() - started);
      if (elapsedMs >= timeoutMs) {
        throw createCodedError(
          'E_STORAGE_LOCK_TIMEOUT',
          'Todo storage is busy; please retry.'
        );
      }
      await delay(25);
    }
  }
}

async function loadTodos(path: string, sizeHint?: number): Promise<Todo[]> {
  const size = sizeHint ?? (await getFileSize(path, IO_TIMEOUT_MS));
  if (size !== null) {
    const maxBytes = getMaxTodoFileBytes();
    if (size > maxBytes) {
      throw createCodedError(
        'E_STORAGE_TOO_LARGE',
        `Todo storage file is too large (${String(size)} bytes; max ${String(maxBytes)}).`
      );
    }
  }

  const raw = await readFileIfExists(path, IO_TIMEOUT_MS);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  const result = TodosSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error('Invalid todo storage format');
  }
  return result.data;
}

async function saveTodos(path: string, todos: Todo[]): Promise<void> {
  const start = nowMs();
  const payload = `${JSON.stringify(todos, null, getJsonIndentation())}\n`;
  const renameRetries = await writeFileAtomic(path, payload, WRITE_TIMEOUT_MS);
  cache = { todos, mtimeMs: await getFileMtime(path, IO_TIMEOUT_MS) };

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

function getCachedTodos(mtimeMs: number | null): Todo[] | null {
  if (cache?.mtimeMs !== mtimeMs) return null;
  return cache.todos;
}

function publishReadEvent(
  start: number,
  cacheHit: boolean,
  todoCount: number
): void {
  publishStorageEvent({
    v: 1,
    kind: 'storage',
    op: 'read',
    at: new Date().toISOString(),
    durationMs: Math.max(0, nowMs() - start),
    cacheHit,
    todoCount,
  });
}

async function readTodos(): Promise<readonly Todo[]> {
  const start = nowMs();
  await writeQueue;
  const path = getTodoFilePath();
  const metadata = await getFileMetadataIfExists(path, IO_TIMEOUT_MS);
  const mtimeMs = metadata?.mtimeMs ?? null;
  const cached = getCachedTodos(mtimeMs);
  if (cached) {
    publishReadEvent(start, true, cached.length);
    return cached;
  }
  const todos = await loadTodos(path, metadata?.size);
  const finalMtimeMs = metadata
    ? mtimeMs
    : await getFileMtime(path, IO_TIMEOUT_MS);
  cache = { todos, mtimeMs: finalMtimeMs };

  publishReadEvent(start, false, todos.length);
  return todos;
}

async function withTodos<T>(
  mutate: (todos: Todo[]) => { todos: Todo[]; result: T }
): Promise<T> {
  return withTodoFileUpdate((todos) => {
    const { todos: nextTodos, result } = mutate(todos);
    if (nextTodos === todos) {
      return { kind: 'no_change', result };
    }
    if (areAllTodosCompleted(nextTodos)) {
      return { kind: 'delete_file', result };
    }
    return { kind: 'save', todos: nextTodos, result };
  });
}

function areAllTodosCompleted(todos: readonly Todo[]): boolean {
  return todos.length > 0 && todos.every((todo) => todo.completed);
}

type TodoFileUpdate<T> =
  | { kind: 'no_change'; result: T }
  | { kind: 'save'; todos: Todo[]; result: T }
  | { kind: 'delete_file'; result: T };

type NormalizedTodoFileUpdate<T> = Exclude<
  TodoFileUpdate<T>,
  { kind: 'no_change' }
>;

function normalizeTodoFileUpdate<T>(
  outcome: TodoFileUpdate<T>,
  current: Todo[],
  hasPersistedFile: boolean
):
  | { kind: 'return'; result: T }
  | { kind: 'proceed'; outcome: NormalizedTodoFileUpdate<T> } {
  if (outcome.kind === 'save' && areAllTodosCompleted(outcome.todos)) {
    return {
      kind: 'proceed',
      outcome: { kind: 'delete_file', result: outcome.result },
    };
  }

  if (outcome.kind !== 'no_change') {
    return { kind: 'proceed', outcome };
  }

  if (hasPersistedFile && areAllTodosCompleted(current)) {
    return {
      kind: 'proceed',
      outcome: { kind: 'delete_file', result: outcome.result },
    };
  }

  return { kind: 'return', result: outcome.result };
}

async function deleteTodoFile(path: string): Promise<void> {
  const start = nowMs();

  await withTimeout(
    rm(path, { force: true }),
    WRITE_TIMEOUT_MS,
    'File remove timed out'
  ).catch((error: unknown) => {
    if (isNotFoundError(error)) return;
    throw error;
  });

  cache = { todos: [], mtimeMs: null };

  publishStorageEvent({
    v: 1,
    kind: 'storage',
    op: 'write',
    at: new Date().toISOString(),
    durationMs: Math.max(0, nowMs() - start),
    todoCount: 0,
    renameRetries: 0,
  });
}

async function withTodoFileUpdate<T>(
  work: (todos: Todo[]) => TodoFileUpdate<T>
): Promise<T> {
  return enqueueWrite(async () => {
    const path = getTodoFilePath();

    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt += 1) {
      const metadata = await getFileMetadataIfExists(path, IO_TIMEOUT_MS);
      const initialMtimeMs = metadata?.mtimeMs ?? null;
      const current =
        cache?.mtimeMs === initialMtimeMs
          ? cache.todos
          : await loadTodos(path, metadata?.size);

      const mtimeMs = metadata
        ? initialMtimeMs
        : await getFileMtime(path, IO_TIMEOUT_MS);
      cache = { todos: current, mtimeMs };

      const normalized = normalizeTodoFileUpdate(
        work(current),
        current,
        mtimeMs !== null
      );
      if (normalized.kind === 'return') {
        return normalized.result;
      }
      const { outcome } = normalized;

      const release = await acquireWriteLock(path, getLockTimeoutMs());
      try {
        const latestMtime = await getFileMtime(path, IO_TIMEOUT_MS);
        if (latestMtime !== mtimeMs) {
          if (attempt >= MAX_CONFLICT_RETRIES) {
            throw createCodedError(
              'E_STORAGE_CONFLICT',
              'Todo storage changed during update; please retry.'
            );
          }
          await delay(25 * (attempt + 1));
          continue;
        }

        if (outcome.kind === 'save') {
          await saveTodos(path, outcome.todos);
        } else {
          await deleteTodoFile(path);
        }

        return outcome.result;
      } finally {
        await release();
      }
    }

    throw createCodedError(
      'E_STORAGE_CONFLICT',
      'Todo storage update failed due to concurrent modifications'
    );
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

export type MatchOutcome =
  | { kind: 'match'; todo: Todo }
  | { kind: 'error'; response: ErrorResponse };

export interface TodoUpdate {
  description?: string;
  completed?: boolean;
  priority?: Todo['priority'];
  category?: Todo['category'];
  dueAt?: Todo['dueAt'];
}

function createNotFoundOutcome(id: string): MatchOutcome {
  return {
    kind: 'error',
    response: createErrorResponse(
      'E_NOT_FOUND',
      `Todo with ID ${id} not found`
    ),
  };
}

export type CompleteTodoOutcome =
  | MatchOutcome
  | { kind: 'already'; todo: Todo };

interface NewTodoInput {
  description: string;
  priority: Todo['priority'];
  category: Todo['category'];
  dueAt?: Todo['dueAt'] | undefined;
}

function hasOwnKey<T extends object>(obj: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function valuesEqual(current: unknown, update: unknown): boolean {
  return Object.is(current, update);
}

function hasChanges(current: Todo, updates: TodoUpdate): boolean {
  return Object.entries(updates).some(([key, value]) => {
    if (!hasOwnKey(current, key)) return true;
    return !valuesEqual(current[key], value);
  });
}

export async function getTodos(): Promise<readonly Todo[]> {
  return readTodos();
}

function createNewTodo(item: NewTodoInput, timestamp: string): Todo {
  return {
    id: randomUUID(),
    description: item.description,
    completed: false,
    priority: item.priority,
    category: item.category,
    dueAt: item.dueAt,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: undefined,
  };
}

export function addTodos(items: NewTodoInput[]): Promise<Todo[]> {
  const timestamp = new Date().toISOString();
  return withTodos((todos) => {
    const newTodos = items.map((item) => createNewTodo(item, timestamp));
    return { todos: [...todos, ...newTodos], result: newTodos };
  });
}

function calculateUpdatedTodo(current: Todo, updates: TodoUpdate): Todo {
  const updatedTodo = {
    ...current,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  if ('completed' in updates && updates.completed !== current.completed) {
    updatedTodo.completedAt = updates.completed
      ? new Date().toISOString()
      : undefined;
  }
  return updatedTodo;
}

function applyUpdateToTodos(
  todos: Todo[],
  id: string,
  updates: TodoUpdate
): { todos: Todo[]; result: Todo | null } {
  const index = todos.findIndex((todo) => todo.id === id);
  if (index < 0) {
    return { todos, result: null };
  }
  const current = todos[index];
  if (!current) {
    return { todos, result: null };
  }
  if (!hasChanges(current, updates)) {
    return { todos, result: current };
  }
  const updatedTodo = calculateUpdatedTodo(current, updates);
  return { todos: todos.with(index, updatedTodo), result: updatedTodo };
}

function buildUpdateOutcome(
  updated: { todos: Todo[]; result: Todo | null },
  id: string
): { todos: Todo[]; result: MatchOutcome } {
  if (!updated.result) {
    return {
      todos: updated.todos,
      result: createNotFoundOutcome(id),
    };
  }

  return {
    todos: updated.todos,
    result: { kind: 'match', todo: updated.result },
  };
}

export type UpdateTodoOutcome = MatchOutcome | { kind: 'no_updates' };

export async function updateTodoById(
  id: string,
  buildUpdates: (todo: Todo) => TodoUpdate | null
): Promise<UpdateTodoOutcome> {
  return withTodos<UpdateTodoOutcome>((todos) => {
    const match = todos.find((todo) => todo.id === id);
    if (!match) {
      return { todos, result: createNotFoundOutcome(id) };
    }

    const updates = buildUpdates(match);
    if (!updates || Object.keys(updates).length === 0) {
      return { todos, result: { kind: 'no_updates' } };
    }

    const updated = applyUpdateToTodos(todos, match.id, updates);
    return buildUpdateOutcome(updated, match.id);
  });
}

export async function deleteTodoById(id: string): Promise<MatchOutcome> {
  return withTodos<MatchOutcome>((todos) => {
    const match = todos.find((todo) => todo.id === id);
    if (!match) {
      return { todos, result: createNotFoundOutcome(id) };
    }

    const remaining = todos.filter((todo) => todo.id !== match.id);
    if (remaining.length === todos.length) {
      return {
        todos,
        result: createNotFoundOutcome(match.id),
      };
    }

    return { todos: remaining, result: { kind: 'match', todo: match } };
  });
}

export async function completeTodoById(
  id: string,
  completed: boolean
): Promise<CompleteTodoOutcome> {
  return withTodos<CompleteTodoOutcome>((todos) => {
    const match = todos.find((todo) => todo.id === id);
    if (!match) {
      return { todos, result: createNotFoundOutcome(id) };
    }

    if (match.completed === completed) {
      return { todos, result: { kind: 'already', todo: match } };
    }

    const updated = applyUpdateToTodos(todos, match.id, { completed });
    return buildUpdateOutcome(updated, match.id);
  });
}
