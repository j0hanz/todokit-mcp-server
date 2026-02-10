import { Buffer } from 'node:buffer';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import {
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { EOL, platform } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { TOOL_ABORT_ERROR_NAME } from './constants.js';
import { nowMs, publishStorageEvent } from './diagnostics.js';
import { createErrorResponse, type ErrorResponse } from './responses.js';
import { type Todo, TodosSchema } from './schema.js';

const TOOL_CANCELLED_MESSAGE = 'Tool cancelled';
const IS_WINDOWS = platform() === 'win32';
const TRANSIENT_RENAME_ERROR_CODES = new Set<string>(
  IS_WINDOWS
    ? ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']
    : ['EBUSY', 'EPERM', 'EACCES']
);

interface FileMetadata {
  mtimeMs: number;
  size: number;
}

interface FileSystemPort {
  readText(
    path: string,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<string | null>;
  writeTextAtomic(
    path: string,
    content: string,
    timeoutMs: number,
    options?: { signal?: AbortSignal | undefined }
  ): Promise<number>;
  deleteFile(
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

interface LockPort {
  acquire(
    path: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<() => Promise<void>>;
}

interface StorageConfig {
  getTodoFilePath(): Promise<string>;
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
  if (typeof error !== 'object' || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' ? code : undefined;
}

function isNotFoundError(error: unknown): boolean {
  return getSystemErrorCode(error) === 'ENOENT';
}

function isMissingPathError(error: unknown): boolean {
  const code = getSystemErrorCode(error);
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'AbortError' || getSystemErrorCode(error) === 'ABORT_ERR'
  );
}

function isSameText(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

function createToolCancelledError(): Error {
  const error = new Error(TOOL_CANCELLED_MESSAGE);
  error.name = TOOL_ABORT_ERROR_NAME;
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal) return;
  if (signal.aborted) {
    throw createToolCancelledError();
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  throwIfAborted(signal);

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortListener: (() => void) | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      timeoutId = setTimeout(resolve, ms);

      if (!signal) return;
      if (signal.aborted) {
        reject(createToolCancelledError());
        return;
      }

      abortListener = () => {
        reject(createToolCancelledError());
      };
      signal.addEventListener('abort', abortListener, { once: true });
    });
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (signal && abortListener) {
      signal.removeEventListener('abort', abortListener);
    }
  }
}

class EnvStorageConfig implements StorageConfig {
  readonly ioTimeoutMs = 10_000;
  readonly writeTimeoutMs = 30_000;
  readonly maxConflictRetries = 3;

  async getTodoFilePath(): Promise<string> {
    const override = process.env.TODOKIT_TODO_FILE?.trim();
    if (override) {
      const resolved = resolve(override);
      await this.validatePathSafety(resolved);
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

  private async validatePathSafety(filePath: string): Promise<void> {
    const cwd = resolve(process.cwd());
    const targetPath = await this.resolveValidatedPath(filePath);

    const isSafe =
      this.isPathInside(cwd, targetPath) ||
      !!process.env.TODOKIT_ALLOW_OUTSIDE_CWD;

    if (!isSafe) {
      throw new Error('Todo file must be within the current working directory');
    }
  }

  private isPathInside(baseDir: string, targetPath: string): boolean {
    const rel = relative(baseDir, targetPath);
    const isParentTraversal = rel === '..' || rel.startsWith(`..${sep}`);
    return rel === '' || (!isParentTraversal && !isAbsolute(rel));
  }

  private async resolveValidatedPath(filePath: string): Promise<string> {
    const resolved = resolve(filePath);
    let probe = resolved;

    for (;;) {
      try {
        const realProbe = await realpath(probe);
        if (probe === resolved) {
          return realProbe;
        }

        const suffix = relative(probe, resolved);
        return resolve(realProbe, suffix);
      } catch (error) {
        if (!isMissingPathError(error)) {
          throw error;
        }

        const parent = dirname(probe);
        if (parent === probe) {
          return resolved;
        }
        probe = parent;
      }
    }
  }
}

class NodeFileSystem implements FileSystemPort {
  constructor(private readonly config: StorageConfig) {}

  async readText(
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
      this.mapIoAbortError(error, options?.signal, 'File read timed out');
    }
  }

  async writeTextAtomic(
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
        this.mapIoAbortError(error, options?.signal, 'File write timed out');
      }

      return await this.renameWithRetry(tempPath, path);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async deleteFile(
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
      if (isMissingPathError(error)) return null;
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

  private mapIoAbortError(
    error: unknown,
    externalSignal: AbortSignal | undefined,
    timeoutMessage: string
  ): never {
    if (!isAbortError(error)) throw error;
    if (externalSignal?.aborted) {
      throw createToolCancelledError();
    }
    throw this.createTimeoutError(timeoutMessage);
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
            reject(createToolCancelledError());
            return;
          }
          abortListener = () => {
            reject(createToolCancelledError());
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
        retries += 1;
        await sleep(50 * (attempt + 1));
      }
    }

    return retries;
  }

  private shouldRetryRename(error: unknown, attempt: number): boolean {
    const code = getSystemErrorCode(error);
    return (
      code !== undefined &&
      TRANSIENT_RENAME_ERROR_CODES.has(code) &&
      attempt < 2
    );
  }

  private createTimeoutError(message: string): Error {
    const error = new Error(message);
    error.name = 'AbortError';
    return error;
  }
}

class LockFileManager implements LockPort {
  async acquire(
    path: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<() => Promise<void>> {
    const lockPath = `${path}.lock`;
    const started = nowMs();
    const lockContent = `${String(process.pid)} ${new Date().toISOString()} ${randomUUID()}${EOL}`;

    await mkdir(dirname(path), { recursive: true });

    for (;;) {
      throwIfAborted(signal);

      try {
        await writeFile(lockPath, lockContent, {
          encoding: 'utf8',
          flag: 'wx',
        });

        return async () => {
          try {
            const currentContent = await readFile(lockPath, {
              encoding: 'utf8',
            });
            if (!isSameText(lockContent, currentContent)) return;
            await rm(lockPath, { force: true });
          } catch {
            // Lock cleanup errors must not mask tool results.
          }
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

        await sleep(25, signal);
      }
    }
  }
}

interface CacheEntry<T> {
  data: T;
  mtimeMs: number | null;
}

interface SchemaLike<T> {
  safeParse: (data: unknown) => { success: boolean; data?: T };
}

type TransactionMutation<T, R> = (current: T) => {
  next: T;
  result: R;
  deleteFile?: boolean;
};

type TransactionStepResult<R> =
  | { kind: 'success'; result: R }
  | { kind: 'retry' }
  | { kind: 'fail'; error: Error };

class JsonFileStore<T> {
  private cache: CacheEntry<T> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly fs: FileSystemPort,
    private readonly locks: LockPort,
    private readonly config: StorageConfig,
    private readonly schema: SchemaLike<T>
  ) {}

  async read(signal?: AbortSignal): Promise<T> {
    const start = nowMs();
    await this.queue;
    throwIfAborted(signal);

    const path = await this.config.getTodoFilePath();
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
    mutate: TransactionMutation<T, R>,
    signal?: AbortSignal
  ): Promise<R> {
    return this.enqueue(async () => {
      const path = await this.config.getTodoFilePath();
      throwIfAborted(signal);

      for (
        let attempt = 0;
        attempt <= this.config.maxConflictRetries;
        attempt++
      ) {
        throwIfAborted(signal);

        const step = await this.attemptTransactionStep(
          path,
          mutate,
          attempt,
          signal
        );

        if (step.kind === 'success') return step.result;
        if (step.kind === 'fail') throw step.error;

        // Exponential backoff with jitter
        const backoffMs =
          // eslint-disable-next-line sonarjs/pseudo-random
          25 * Math.pow(2, attempt) + Math.random() * 20;
        await sleep(backoffMs, signal);
      }

      throw createCodedError(
        'E_STORAGE_CONFLICT',
        'Todo storage update failed due to concurrent modifications'
      );
    });
  }

  async close(): Promise<void> {
    const start = nowMs();
    await this.queue;
    this.queue = Promise.resolve();
    this.cache = null;

    publishStorageEvent({
      v: 1,
      kind: 'storage',
      op: 'close',
      at: new Date().toISOString(),
      durationMs: Math.max(0, nowMs() - start),
    });
  }

  private enqueue<R>(task: () => Promise<R>): Promise<R> {
    const run = this.queue.then(task, task);
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async attemptTransactionStep<R>(
    path: string,
    mutate: TransactionMutation<T, R>,
    attempt: number,
    signal?: AbortSignal
  ): Promise<TransactionStepResult<R>> {
    throwIfAborted(signal);

    const metadata = await this.fs.getMetadata(path, this.config.ioTimeoutMs, {
      signal,
    });
    const initialMtimeMs = metadata?.mtimeMs ?? null;

    const current =
      this.cache?.mtimeMs === initialMtimeMs
        ? this.cache.data
        : await this.loadFromFile(path, metadata?.size, signal);

    const knownMtimeMs = metadata
      ? initialMtimeMs
      : await this.fs.getMtime(path, this.config.ioTimeoutMs, { signal });

    this.cache = { data: current, mtimeMs: knownMtimeMs };
    throwIfAborted(signal);

    const { next, result, deleteFile } = mutate(current);
    if (next === current && !deleteFile) {
      return { kind: 'success', result };
    }

    const release = await this.locks.acquire(
      path,
      this.config.lockTimeoutMs,
      signal
    );

    try {
      throwIfAborted(signal);

      const latestMtime = await this.fs.getMtime(
        path,
        this.config.ioTimeoutMs,
        { signal }
      );

      if (latestMtime !== knownMtimeMs) {
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
        await this.deleteBackingFile(path, signal);
      } else {
        await this.saveBackingFile(path, next, signal);
      }

      return { kind: 'success', result };
    } finally {
      await release();
    }
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

    const raw = await this.fs.readText(path, { signal });
    throwIfAborted(signal);

    if (!raw) {
      const emptyParse = this.schema.safeParse([]);
      if (emptyParse.success && emptyParse.data) return emptyParse.data;
      throw new Error('Schema does not support empty state');
    }

    const rawBytes = Buffer.byteLength(raw, 'utf8');
    if (rawBytes > this.config.maxTodoFileBytes) {
      throw createCodedError(
        'E_STORAGE_TOO_LARGE',
        `Todo storage file is too large (${String(rawBytes)} bytes; max ${this.config.maxTodoFileBytes}).`
      );
    }

    throwIfAborted(signal);

    const parsed: unknown = JSON.parse(raw);
    const result = this.schema.safeParse(parsed);
    if (!result.success || !result.data) {
      throw new Error('Invalid todo storage format');
    }
    return result.data;
  }

  private async saveBackingFile(
    path: string,
    data: T,
    signal?: AbortSignal
  ): Promise<void> {
    const start = nowMs();
    throwIfAborted(signal);

    const payload = `${JSON.stringify(data, null, this.config.jsonIndentation)}${EOL}`;
    const payloadBytes = Buffer.byteLength(payload, 'utf8');
    if (payloadBytes > this.config.maxTodoFileBytes) {
      throw createCodedError(
        'E_STORAGE_TOO_LARGE',
        `Todo storage file is too large (${String(payloadBytes)} bytes; max ${this.config.maxTodoFileBytes}).`
      );
    }

    const renameRetries = await this.fs.writeTextAtomic(
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

  private async deleteBackingFile(
    path: string,
    signal?: AbortSignal
  ): Promise<void> {
    const start = nowMs();
    throwIfAborted(signal);

    await this.fs.deleteFile(path, this.config.writeTimeoutMs, { signal });

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

type IndexLookup =
  | { kind: 'found'; index: number; todo: Todo; incompleteCount: number }
  | { kind: 'not_found'; incompleteCount: number };

interface SearchMatcher {
  matches(value: string): boolean;
}

function splitByGrapheme(
  value: string,
  segmenter: Intl.Segmenter | null
): string[] {
  if (!segmenter) return Array.from(value);
  return Array.from(segmenter.segment(value), ({ segment }) => segment);
}

function createSearchMatcher(query: string): SearchMatcher {
  if (!query) {
    return {
      matches: () => true,
    };
  }

  const collator = new Intl.Collator(undefined, {
    usage: 'search',
    sensitivity: 'base',
    ignorePunctuation: true,
  });
  const segmenter =
    typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;
  const needle = query.normalize('NFKC');
  const needleParts = splitByGrapheme(needle, segmenter);
  const needleLength = needleParts.length;

  if (needleLength === 0) {
    return {
      matches: () => true,
    };
  }

  const matches = (value: string): boolean => {
    const haystack = value.normalize('NFKC');
    const haystackParts = splitByGrapheme(haystack, segmenter);

    if (haystackParts.length < needleLength) return false;

    for (let index = 0; index <= haystackParts.length - needleLength; index++) {
      const candidate = haystackParts
        .slice(index, index + needleLength)
        .join('');
      if (collator.compare(candidate, needle) === 0) {
        return true;
      }
    }
    return false;
  };

  return { matches };
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
        const lookup = this.findById(todos, id);
        if (lookup.kind === 'not_found') {
          return { next: todos, result: this.createNotFound(id) };
        }

        const updates = buildUpdates(lookup.todo);

        if (!updates || Object.keys(updates).length === 0) {
          return { next: todos, result: { kind: 'no_updates' } };
        }

        if (!this.hasChanges(lookup.todo, updates)) {
          return { next: todos, result: { kind: 'match', todo: lookup.todo } };
        }

        const updated = this.applyUpdates(lookup.todo, updates);
        const nextTodos = todos.with(lookup.index, updated);

        let nextIncompleteCount = lookup.incompleteCount;
        if (lookup.todo.completed !== updated.completed) {
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
      const lookup = this.findById(todos, id);
      if (lookup.kind === 'not_found') {
        return { next: todos, result: this.createNotFound(id) };
      }

      const current = lookup.todo;

      if (current.completed === completed) {
        return {
          next: todos,
          result: { kind: 'already', todo: current },
          deleteFile: todos.length > 0 && lookup.incompleteCount === 0,
        };
      }

      const updated = this.applyUpdates(current, { completed });
      const nextTodos = todos.with(lookup.index, updated);

      const nextIncompleteCount = lookup.incompleteCount + (completed ? -1 : 1);

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

  private findById(todos: Todo[], id: string): IndexLookup {
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

    return index === -1 || !current
      ? { kind: 'not_found', incompleteCount }
      : { kind: 'found', index, todo: current, incompleteCount };
  }

  async search(query: string, signal?: AbortSignal): Promise<readonly Todo[]> {
    const todos = await this.getAll(signal);
    const matcher = createSearchMatcher(query);
    return todos.filter(
      (todo) =>
        matcher.matches(todo.description) || matcher.matches(todo.category)
    );
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
const locks = new LockFileManager();
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

export async function searchTodos(
  query: string,
  signal?: AbortSignal
): Promise<readonly Todo[]> {
  return repository.search(query, signal);
}

export async function closeDb(): Promise<void> {
  return repository.close();
}
