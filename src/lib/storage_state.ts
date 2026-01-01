import type { Stats } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Todo, TodosSchema } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TODO_FILE = join(__dirname, '../../todos.json');
const FILE_TIMEOUT_MS = 5000;
const FILE_ENCODING = 'utf-8' as const;
const TEMP_DIR_PREFIX = '.tmp-';

let writeChain: Promise<void> = Promise.resolve();
let cachedTodos: Todo[] | null = null;
let cachedMtimeMs: number | null = null;
let cachedPath: string | null = null;
let inFlightRead: Promise<Todo[]> | null = null;
let inFlightPath: string | null = null;

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  if (!('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isFileNotFound(error: unknown): boolean {
  return getErrorCode(error) === 'ENOENT';
}

function shouldIgnoreDirSyncError(error: unknown): boolean {
  const code = getErrorCode(error);
  return (
    code === 'EINVAL' ||
    code === 'EPERM' ||
    code === 'ENOTSUP' ||
    code === 'EISDIR'
  );
}

function assertJsonFilePath(path: string): void {
  const extension = extname(path).toLowerCase();
  if (extension !== '.json') {
    throw new Error(`Todo storage path must end with .json: ${path}`);
  }
}

function getTodoFilePath(): string {
  const override = process.env.TODOKIT_TODO_FILE?.trim();
  const resolved = override ? resolve(override) : DEFAULT_TODO_FILE;
  assertJsonFilePath(resolved);
  return resolved;
}

function clearCacheForPath(path: string): void {
  if (cachedPath === path) {
    cachedTodos = null;
    cachedMtimeMs = null;
  }
}

function getCachedTodos(path: string, mtimeMs: number): Todo[] | null {
  if (cachedTodos && cachedPath === path && cachedMtimeMs === mtimeMs) {
    return cachedTodos;
  }
  return null;
}

function updateCache(path: string, todos: Todo[], mtimeMs: number): void {
  cachedTodos = todos;
  cachedMtimeMs = mtimeMs;
  cachedPath = path;
}

function parseTodos(rawJson: string): Todo[] {
  const raw: unknown = JSON.parse(rawJson);
  const parsed = TodosSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid todos.json: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function statTodoFile(path: string): Promise<Stats | null> {
  try {
    const stats = await withTimeout(
      stat(path),
      FILE_TIMEOUT_MS,
      'stat todo file'
    );
    if (!stats.isFile()) {
      throw new Error(`Todo storage path is not a file: ${path}`);
    }
    return stats;
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      return null;
    }
    throw error;
  }
}

async function readTodosFile(path: string): Promise<Todo[]> {
  const data = await readFile(path, {
    encoding: FILE_ENCODING,
    signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
  });
  return parseTodos(data);
}

function handleMissingFile(path: string): Todo[] {
  clearCacheForPath(path);
  return [];
}

async function readTodosWithStats(path: string, stats: Stats): Promise<Todo[]> {
  const cached = getCachedTodos(path, stats.mtimeMs);
  if (cached) {
    return cached;
  }
  const parsed = await readTodosFile(path);
  updateCache(path, parsed, stats.mtimeMs);
  return parsed;
}

function handleReadError(path: string, error: unknown): Todo[] {
  if (isFileNotFound(error)) {
    return handleMissingFile(path);
  }
  throw error;
}

async function readTodosWithCache(path: string): Promise<Todo[]> {
  try {
    const stats = await statTodoFile(path);
    if (!stats) {
      return handleMissingFile(path);
    }
    return await readTodosWithStats(path, stats);
  } catch (error: unknown) {
    return handleReadError(path, error);
  }
}

export async function readTodosFromDisk(): Promise<Todo[]> {
  const path = getTodoFilePath();
  if (inFlightRead && inFlightPath === path) {
    return inFlightRead;
  }

  const readPromise = readTodosWithCache(path);
  inFlightRead = readPromise;
  inFlightPath = path;

  try {
    return await readPromise;
  } finally {
    if (inFlightRead === readPromise) {
      inFlightRead = null;
      inFlightPath = null;
    }
  }
}

async function writeAndSyncFile(path: string, data: string): Promise<void> {
  const handle = await withTimeout(
    open(path, 'w'),
    FILE_TIMEOUT_MS,
    'open temp todo file'
  );
  try {
    await withTimeout(
      handle.writeFile(data, { encoding: FILE_ENCODING }),
      FILE_TIMEOUT_MS,
      'write todo file'
    );
    await withTimeout(handle.sync(), FILE_TIMEOUT_MS, 'fsync todo file');
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  try {
    const handle = await withTimeout(
      open(path, 'r'),
      FILE_TIMEOUT_MS,
      'open todo directory'
    );
    try {
      await withTimeout(handle.sync(), FILE_TIMEOUT_MS, 'fsync todo directory');
    } finally {
      await handle.close();
    }
  } catch (error: unknown) {
    if (shouldIgnoreDirSyncError(error)) {
      return;
    }
    throw error;
  }
}

async function writeFileAtomically(path: string, data: string): Promise<void> {
  const targetDir = dirname(path);
  await withTimeout(
    mkdir(targetDir, { recursive: true }),
    FILE_TIMEOUT_MS,
    'mkdir todo directory'
  );

  const tempDir = await withTimeout(
    mkdtemp(join(targetDir, TEMP_DIR_PREFIX)),
    FILE_TIMEOUT_MS,
    'mkdtemp todo directory'
  );
  const tempPath = join(tempDir, basename(path));

  try {
    await writeAndSyncFile(tempPath, data);
    await withTimeout(
      rename(tempPath, path),
      FILE_TIMEOUT_MS,
      'rename todo file'
    );
    await syncDirectory(targetDir);
  } finally {
    try {
      await withTimeout(
        rm(tempDir, { recursive: true, force: true }),
        FILE_TIMEOUT_MS,
        'cleanup temp dir'
      );
    } catch {
      // Best-effort cleanup of temp artifacts.
    }
  }
}

export function queueWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  writeChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function waitForWrites(): Promise<void> {
  await writeChain;
}

export async function persistTodos(todos: Todo[]): Promise<void> {
  const path = getTodoFilePath();
  await writeFileAtomically(path, JSON.stringify(todos, null, 2));
  cachedTodos = todos;
  cachedPath = path;
  try {
    const stats = await withTimeout(
      stat(path),
      FILE_TIMEOUT_MS,
      'stat todo file'
    );
    cachedMtimeMs = stats.mtimeMs;
  } catch {
    cachedMtimeMs = null;
  }
}
