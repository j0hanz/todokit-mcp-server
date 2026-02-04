import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { TOOL_ABORT_ERROR_NAME } from './constants.js';
import { nowMs, publishStorageEvent } from './diagnostics.js';
import { createErrorResponse, type ErrorResponse } from './responses.js';
import { type Todo, TodosSchema } from './schema.js';

interface FileMetadata {
  mtimeMs: number;
  size: number;
}

interface IFileSystem {
  read(
    path: string,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<string | null>;
  writeAtomic(
    path: string,
    content: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<number>;
  delete(
    path: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<void>;
  getMetadata(
    path: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<FileMetadata | null>;
  getMtime(
    path: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<number | null>;
  getSize(
    path: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<number | null>;
  ensureDir(path: string): Promise<void>;
}

interface ILockManager {
  acquire(path: string, timeoutMs: number): Promise<() => Promise<void>>;
}

interface IStorageConfig {
  todoFilePath: string;
  lockTimeoutMs: number;
  maxTodoFileBytes: number;
  jsonIndentation: number;
  ioTimeoutMs: number;
  writeTimeoutMs: number;
  maxConflictRetries: number;
}

class StorageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

export function getCodedErrorCode(error: unknown): string | undefined {
  return error instanceof StorageError ? error.code : undefined;
}

function createCodedError(code: string, message: string): StorageError {
  return new StorageError(code, message);
}

function getSystemErrorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code: string }).code;
  }
  return undefined;
}

function isNotFoundError(error: unknown): boolean {
  return getSystemErrorCode(error) === 'ENOENT';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function createAbortError(message: string): Error {
  const error = new Error(message);
  error.name = TOOL_ABORT_ERROR_NAME;
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal) return;
  if (signal.aborted) {
    throw createAbortError('Tool cancelled');
  }
}

class EnvStorageConfig implements IStorageConfig {
  readonly ioTimeoutMs = 10_000;
  readonly writeTimeoutMs = 30_000;
  readonly maxConflictRetries = 3;

  get todoFilePath(): string {
    const override = process.env.TODOKIT_TODO_FILE?.trim();
    if (override) {
      const resolved = resolve(override);
      this.validatePathSafety(resolved);
      return resolved;
    }
    return resolve(process.cwd(), 'todos.json');
  }

  get lockTimeoutMs(): number {
    return this.getEnvInt('TODOKIT_LOCK_TIMEOUT_MS') ?? 5_000;
  }

  get maxTodoFileBytes(): number {
    return this.getEnvInt('TODOKIT_MAX_TODO_FILE_BYTES') ?? 5 * 1024 * 1024;
  }

  get jsonIndentation(): number {
    const raw = process.env.TODOKIT_JSON_PRETTY?.trim().toLowerCase();
    return raw === 'true' || raw === '1' || raw === 'yes' ? 2 : 0;
  }

  private getEnvInt(name: string): number | null {
    const raw = process.env[name]?.trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && Number.isInteger(value) && value >= 0
      ? value
      : null;
  }

  private validatePathSafety(filePath: string): void {
    const cwd = resolve(process.cwd());
    const isSafe =
      this.isPathInside(cwd, filePath) ||
      !!process.env.TODOKIT_ALLOW_OUTSIDE_CWD;

    if (!isSafe) {
      throw new Error('Todo file must be within the current working directory');
    }
  }

  private isPathInside(baseDir: string, targetPath: string): boolean {
    const rel = relative(baseDir, targetPath);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  }
}

class NodeFileSystem implements IFileSystem {
  constructor(private readonly config: IStorageConfig) {}

  async read(
    path: string,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<string | null> {
    try {
      return await readFile(path, {
        encoding: 'utf8',
        signal: this.createIoSignal(this.config.ioTimeoutMs, options?.signal),
      });
    } catch (error) {
      if (isNotFoundError(error)) return null;
      if (isAbortError(error)) {
        if (options?.signal?.aborted) {
          throw createAbortError('Tool cancelled');
        }
        throw this.createTimeoutError('File read timed out');
      }
      throw error;
    }
  }

  async writeAtomic(
    path: string,
    content: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<number> {
    await this.ensureDir(dirname(path));
    const tempPath = `${path}.${randomUUID()}.tmp`;

    try {
      try {
        await writeFile(tempPath, content, {
          encoding: 'utf8',
          flush: true,
          signal: this.createIoSignal(timeoutMs, options?.signal),
        });
      } catch (error) {
        if (isAbortError(error)) {
          if (options?.signal?.aborted) {
            throw createAbortError('Tool cancelled');
          }
          throw this.createTimeoutError('File write timed out');
        }
        throw error;
      }
      return await this.renameWithRetry(tempPath, path);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async delete(
    path: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<void> {
    try {
      await this.withTimeout(
        rm(path, { force: true }),
        timeoutMs,
        'File remove timed out',
        options?.signal
      );
    } catch (error) {
      if (isNotFoundError(error)) return;
      throw error;
    }
  }

  async getMetadata(
    path: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<FileMetadata | null> {
    try {
      const stats = await this.withTimeout(
        stat(path),
        timeoutMs,
        'File stat timed out',
        options?.signal
      );
      return { mtimeMs: stats.mtimeMs, size: stats.size };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  async getMtime(
    path: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<number | null> {
    const meta = await this.getMetadata(path, timeoutMs, options);
    return meta?.mtimeMs ?? null;
  }

  async getSize(
    path: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<number | null> {
    const meta = await this.getMetadata(path, timeoutMs, options);
    return meta?.size ?? null;
  }

  async ensureDir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  }

  private createIoSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    message: string,
    signal?: AbortSignal
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(this.createTimeoutError(message));
      }, ms);
    });

    const abort = signal
      ? new Promise<never>((_, reject) => {
          if (signal.aborted) {
            reject(createAbortError('Tool cancelled'));
            return;
          }
          abortListener = () => {
            reject(createAbortError('Tool cancelled'));
          };
          signal.addEventListener('abort', abortListener, { once: true });
        })
      : null;

    try {
      const racers: Promise<T>[] = [promise, timeout];
      if (abort) racers.push(abort);
      return await Promise.race(racers);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      if (abortListener && signal) {
        signal.removeEventListener('abort', abortListener);
      }
    }
  }

  private async renameWithRetry(from: string, to: string): Promise<number> {
    let retries = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await rename(from, to);
        return retries;
      } catch (error: unknown) {
        if (!this.shouldRetryRename(error, attempt)) throw error;
        retries++;
        await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
      }
    }
    return retries;
  }

  private shouldRetryRename(error: unknown, attempt: number): boolean {
    const code = getSystemErrorCode(error);
    const isTransient = code && ['EBUSY', 'EPERM', 'EACCES'].includes(code);
    return !!isTransient && attempt < 2;
  }

  private createTimeoutError(message: string): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }
}

class FileLockManager implements ILockManager {
  async acquire(path: string, timeoutMs: number): Promise<() => Promise<void>> {
    const lockPath = `${path}.lock`;
    const started = nowMs();

    await mkdir(dirname(path), { recursive: true });

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
        if (getSystemErrorCode(error) !== 'EEXIST') {
          throw error;
        }

        const elapsedMs = Math.max(0, nowMs() - started);
        if (elapsedMs >= timeoutMs) {
          throw createCodedError(
            'E_STORAGE_LOCK_TIMEOUT',
            'Todo storage is busy; please retry.'
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
}

interface CacheEntry<T> {
  data: T;
  mtimeMs: number | null;
}

interface TransactionStepResult<R> {
  kind: 'success' | 'retry' | 'fail';
  result?: R;
  error?: Error;
}

class JsonFileStore<T> {
  private cache: CacheEntry<T> | null = null;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly fs: IFileSystem,
    private readonly locks: ILockManager,
    private readonly config: IStorageConfig,
    private readonly schema: {
      safeParse: (data: unknown) => { success: boolean; data?: T };
    }
  ) {}

  async read(signal?: AbortSignal): Promise<T> {
    const start = nowMs();
    await this.writeQueue;
    throwIfAborted(signal);

    const path = this.config.todoFilePath;
    const metadata = await this.fs.getMetadata(path, this.config.ioTimeoutMs, {
      signal,
    });
    const mtimeMs = metadata?.mtimeMs ?? null;
    throwIfAborted(signal);

    if (this.cache?.mtimeMs === mtimeMs) {
      this.publishReadEvent(start, true, this.getItemCount(this.cache.data));
      return this.cache.data;
    }

    const data = await this.loadFromFile(path, metadata?.size, signal);
    const finalMtimeMs = metadata
      ? mtimeMs
      : await this.fs.getMtime(path, this.config.ioTimeoutMs, { signal });
    throwIfAborted(signal);

    this.cache = { data, mtimeMs: finalMtimeMs };

    this.publishReadEvent(start, false, this.getItemCount(data));
    return data;
  }

  async transaction<R>(
    operation: (current: T) => { next: T; result: R; deleteFile?: boolean },
    signal?: AbortSignal
  ): Promise<R> {
    return this.enqueue(async () => {
      const path = this.config.todoFilePath;
      throwIfAborted(signal);

      for (
        let attempt = 0;
        attempt <= this.config.maxConflictRetries;
        attempt++
      ) {
        throwIfAborted(signal);
        const step = await this.attemptTransactionStep(
          path,
          operation,
          attempt,
          signal
        );
        if (step.kind === 'success') {
          return step.result as R;
        }
        if (step.kind === 'fail') {
          throw step.error ?? new Error('Transaction failed');
        }
        // retry
        await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
      }

      throw createCodedError(
        'E_STORAGE_CONFLICT',
        'Todo storage update failed due to concurrent modifications'
      );
    });
  }

  async close(): Promise<void> {
    const start = nowMs();
    await this.writeQueue;
    this.writeQueue = Promise.resolve();
    this.cache = null;

    publishStorageEvent({
      v: 1,
      kind: 'storage',
      op: 'close',
      at: new Date().toISOString(),
      durationMs: Math.max(0, nowMs() - start),
    });
  }

  private async attemptTransactionStep<R>(
    path: string,
    operation: (current: T) => { next: T; result: R; deleteFile?: boolean },
    attempt: number,
    signal?: AbortSignal
  ): Promise<TransactionStepResult<R>> {
    throwIfAborted(signal);
    const metadata = await this.fs.getMetadata(path, this.config.ioTimeoutMs, {
      signal,
    });
    const initialMtimeMs = metadata?.mtimeMs ?? null;

    let current: T;
    if (this.cache?.mtimeMs === initialMtimeMs) {
      current = this.cache.data;
    } else {
      current = await this.loadFromFile(path, metadata?.size, signal);
    }
    const mtimeMs = metadata
      ? initialMtimeMs
      : await this.fs.getMtime(path, this.config.ioTimeoutMs, { signal });
    this.cache = { data: current, mtimeMs };
    throwIfAborted(signal);
    const { next, result, deleteFile } = operation(current);
    if (next === current && !deleteFile) {
      return { kind: 'success', result };
    }
    const release = await this.locks.acquire(path, this.config.lockTimeoutMs);
    try {
      throwIfAborted(signal);
      const latestMtime = await this.fs.getMtime(
        path,
        this.config.ioTimeoutMs,
        {
          signal,
        }
      );
      if (latestMtime !== mtimeMs) {
        if (attempt >= this.config.maxConflictRetries) {
          return {
            kind: 'fail',
            error: createCodedError(
              'E_STORAGE_CONFLICT',
              'Todo storage changed during update; please retry.'
            ),
          };
        }
        return { kind: 'retry' };
      }
      throwIfAborted(signal);
      if (deleteFile) {
        await this.deleteFile(path, signal);
      } else {
        await this.saveFile(path, next, signal);
      }
      return { kind: 'success', result };
    } finally {
      await release();
    }
  }

  private enqueue<R>(task: () => Promise<R>): Promise<R> {
    const run = this.writeQueue.then(task, task);
    this.writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async loadFromFile(
    path: string,
    sizeHint: number | undefined,
    signal?: AbortSignal
  ): Promise<T> {
    throwIfAborted(signal);
    const size =
      sizeHint ??
      (await this.fs.getSize(path, this.config.ioTimeoutMs, { signal }));

    if (size !== null && size > this.config.maxTodoFileBytes) {
      throw createCodedError(
        'E_STORAGE_TOO_LARGE',
        `Todo storage file is too large (${String(size)} bytes; max ${this.config.maxTodoFileBytes}).`
      );
    }

    const raw = await this.fs.read(path, { signal });
    throwIfAborted(signal);
    if (!raw) {
      const emptyParse = this.schema.safeParse([]);
      if (emptyParse.success && emptyParse.data) return emptyParse.data;
      throw new Error('Schema does not support empty state');
    }

    throwIfAborted(signal);
    const parsed: unknown = JSON.parse(raw);
    const result = this.schema.safeParse(parsed);
    if (!result.success || !result.data) {
      throw new Error('Invalid todo storage format');
    }
    return result.data;
  }

  private async saveFile(
    path: string,
    data: T,
    signal?: AbortSignal
  ): Promise<void> {
    const start = nowMs();
    throwIfAborted(signal);
    const payload = `${JSON.stringify(data, null, this.config.jsonIndentation)}\n`;
    const renameRetries = await this.fs.writeAtomic(
      path,
      payload,
      this.config.writeTimeoutMs,
      { signal }
    );

    this.cache = {
      data,
      mtimeMs: await this.fs.getMtime(path, this.config.ioTimeoutMs, {
        signal,
      }),
    };

    publishStorageEvent({
      v: 1,
      kind: 'storage',
      op: 'write',
      at: new Date().toISOString(),
      durationMs: Math.max(0, nowMs() - start),
      todoCount: this.getItemCount(data),
      renameRetries,
    });
  }

  private async deleteFile(path: string, signal?: AbortSignal): Promise<void> {
    const start = nowMs();
    throwIfAborted(signal);
    await this.fs.delete(path, this.config.writeTimeoutMs, { signal });

    const emptyResult = this.schema.safeParse([]);
    if (!emptyResult.success || !emptyResult.data) {
      throw new Error('Schema failure on empty state');
    }
    this.cache = { data: emptyResult.data, mtimeMs: null };

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

  private getItemCount(data: T): number {
    return Array.isArray(data) ? data.length : 0;
  }

  private publishReadEvent(
    start: number,
    cacheHit: boolean,
    count: number
  ): void {
    publishStorageEvent({
      v: 1,
      kind: 'storage',
      op: 'read',
      at: new Date().toISOString(),
      durationMs: Math.max(0, nowMs() - start),
      cacheHit,
      todoCount: count,
    });
  }
}

export interface TodoUpdate {
  description?: string;
  completed?: boolean;
  priority?: Todo['priority'];
  category?: Todo['category'];
  dueAt?: Todo['dueAt'];
}

export type CompleteTodoOutcome =
  | { kind: 'match'; todo: Todo }
  | { kind: 'error'; response: ErrorResponse }
  | { kind: 'already'; todo: Todo };

type MatchOutcome =
  | { kind: 'match'; todo: Todo }
  | { kind: 'error'; response: ErrorResponse };

interface NewTodoInput {
  description: string;
  priority: Todo['priority'];
  category: Todo['category'];
  dueAt?: Todo['dueAt'] | undefined;
}

class TodoRepository {
  constructor(private readonly store: JsonFileStore<Todo[]>) {}

  async getAll(signal?: AbortSignal): Promise<readonly Todo[]> {
    return this.store.read(signal);
  }

  async addMany(items: NewTodoInput[], signal?: AbortSignal): Promise<Todo[]> {
    const timestamp = new Date().toISOString();

    return this.store.transaction<Todo[]>((todos) => {
      const newTodos = items.map((item) => ({
        id: randomUUID(),
        description: item.description,
        completed: false,
        priority: item.priority,
        category: item.category,
        dueAt: item.dueAt,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: undefined,
      }));

      return {
        next: [...todos, ...newTodos],
        result: newTodos,
      };
    }, signal);
  }

  async update(
    id: string,
    buildUpdates: (todo: Todo) => TodoUpdate | null,
    signal?: AbortSignal
  ): Promise<MatchOutcome | { kind: 'no_updates' }> {
    return this.store.transaction<MatchOutcome | { kind: 'no_updates' }>(
      (todos) => {
        let index = -1;
        let current: Todo | undefined;
        let incompleteCount = 0;

        for (let i = 0; i < todos.length; i++) {
          const todo = todos[i];
          if (!todo) continue;
          if (!todo.completed) incompleteCount += 1;
          if (todo.id === id) {
            index = i;
            current = todo;
          }
        }

        if (index === -1 || !current) {
          return { next: todos, result: this.createNotFound(id) };
        }

        const updates = buildUpdates(current);

        if (!updates || Object.keys(updates).length === 0) {
          return { next: todos, result: { kind: 'no_updates' } };
        }

        if (!this.hasChanges(current, updates)) {
          return { next: todos, result: { kind: 'match', todo: current } };
        }

        const updated = this.applyUpdates(current, updates);
        const nextTodos = todos.with(index, updated);
        let nextIncompleteCount = incompleteCount;
        if (current.completed !== updated.completed) {
          nextIncompleteCount += updated.completed ? -1 : 1;
        }

        return {
          next: nextTodos,
          result: { kind: 'match', todo: updated },
          deleteFile: nextTodos.length > 0 && nextIncompleteCount === 0,
        };
      },
      signal
    );
  }

  async delete(id: string, signal?: AbortSignal): Promise<MatchOutcome> {
    return this.store.transaction<MatchOutcome>((todos) => {
      let match: Todo | undefined;
      const nextTodos: Todo[] = [];
      let incompleteCount = 0;

      for (const todo of todos) {
        if (todo.id === id) {
          match = todo;
          continue;
        }
        nextTodos.push(todo);
        if (!todo.completed) incompleteCount += 1;
      }

      if (!match) {
        return { next: todos, result: this.createNotFound(id) };
      }

      return {
        next: nextTodos,
        result: { kind: 'match', todo: match },
        deleteFile: nextTodos.length > 0 && incompleteCount === 0,
      };
    }, signal);
  }

  async complete(
    id: string,
    completed: boolean,
    signal?: AbortSignal
  ): Promise<CompleteTodoOutcome> {
    return this.store.transaction<CompleteTodoOutcome>((todos) => {
      let index = -1;
      let current: Todo | undefined;
      let incompleteCount = 0;

      for (let i = 0; i < todos.length; i++) {
        const todo = todos[i];
        if (!todo) continue;
        if (!todo.completed) incompleteCount += 1;
        if (todo.id === id) {
          index = i;
          current = todo;
        }
      }

      if (index === -1 || !current) {
        return { next: todos, result: this.createNotFound(id) };
      }

      if (current.completed === completed) {
        return {
          next: todos,
          result: { kind: 'already', todo: current },
          deleteFile: todos.length > 0 && incompleteCount === 0,
        };
      }

      const updated = this.applyUpdates(current, { completed });
      const nextTodos = todos.with(index, updated);
      let nextIncompleteCount = incompleteCount;
      nextIncompleteCount += completed ? -1 : 1;

      return {
        next: nextTodos,
        result: { kind: 'match', todo: updated },
        deleteFile: nextTodos.length > 0 && nextIncompleteCount === 0,
      };
    }, signal);
  }

  async close(): Promise<void> {
    return this.store.close();
  }

  private createNotFound(id: string): MatchOutcome {
    return {
      kind: 'error',
      response: createErrorResponse(
        'E_NOT_FOUND',
        `Todo with ID ${id} not found`
      ),
    };
  }

  private hasChanges(current: Todo, updates: TodoUpdate): boolean {
    return Object.entries(updates).some(([key, value]) => {
      if (!Object.prototype.hasOwnProperty.call(current, key)) return true;
      return !Object.is(
        (current as unknown as Record<string, unknown>)[key],
        value
      );
    });
  }

  private applyUpdates(current: Todo, updates: TodoUpdate): Todo {
    const updated = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if ('completed' in updates && updates.completed !== current.completed) {
      updated.completedAt = updates.completed
        ? new Date().toISOString()
        : undefined;
    }
    return updated;
  }
}

const config = new EnvStorageConfig();
const fs = new NodeFileSystem(config);
const locks = new FileLockManager();
const store = new JsonFileStore<Todo[]>(fs, locks, config, TodosSchema);
const repository = new TodoRepository(store);

export async function getTodos(signal?: AbortSignal): Promise<readonly Todo[]> {
  return repository.getAll(signal);
}

export function addTodos(
  items: NewTodoInput[],
  signal?: AbortSignal
): Promise<Todo[]> {
  return repository.addMany(items, signal);
}

export async function updateTodoById(
  id: string,
  buildUpdates: (todo: Todo) => TodoUpdate | null,
  signal?: AbortSignal
): Promise<MatchOutcome | { kind: 'no_updates' }> {
  return repository.update(id, buildUpdates, signal);
}

export async function deleteTodoById(
  id: string,
  signal?: AbortSignal
): Promise<MatchOutcome> {
  return repository.delete(id, signal);
}

export async function completeTodoById(
  id: string,
  completed: boolean,
  signal?: AbortSignal
): Promise<CompleteTodoOutcome> {
  return repository.complete(id, completed, signal);
}

export async function closeDb(): Promise<void> {
  return repository.close();
}
