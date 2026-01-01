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

export async function readTodosFromDisk(): Promise<Todo[]> {
  const path = getTodoFilePath();
  try {
    const stats = await statTodoFile(path);
    if (!stats) {
      return [];
    }
    return await readTodosFile(path);
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      return [];
    }
    throw error;
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
      void 0;
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
}
