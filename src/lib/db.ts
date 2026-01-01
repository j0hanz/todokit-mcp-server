import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Todo, TodosSchema } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TODO_FILE = join(__dirname, '../../todos.json');

let writeQueue: Promise<void> = Promise.resolve();

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

const TRANSIENT_ERROR_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  if (!('code' in error)) return undefined;
  return (error as NodeJS.ErrnoException).code;
}

function isTransientError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code !== undefined && TRANSIENT_ERROR_CODES.has(code);
}

function noop(): void {
  // Intentionally empty
}

export function getTodoFilePath(): string {
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

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

async function loadTodos(path: string): Promise<Todo[]> {
  const raw = await readFileIfExists(path);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
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

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const error = await tryRename(from, to);
    if (!error) return;
    if (!shouldRetry(error, attempt)) throw error;
    await delay(50 * (attempt + 1));
  }
}

async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(tempPath, contents, { encoding: 'utf8', flush: true });
    await renameWithRetry(tempPath, path);
  } finally {
    await rm(tempPath, { force: true }).catch(noop);
  }
}

async function saveTodos(path: string, todos: Todo[]): Promise<void> {
  const payload = `${JSON.stringify(todos, null, 2)}\n`;
  await writeFileAtomic(path, payload);
}

export async function readTodos(): Promise<Todo[]> {
  await writeQueue;
  return loadTodos(getTodoFilePath());
}

export async function withTodos<T>(
  mutate: (todos: Todo[]) => { todos: Todo[]; result: T }
): Promise<T> {
  return enqueueWrite(async () => {
    const path = getTodoFilePath();
    const current = await loadTodos(path);
    const { todos, result } = mutate(current);
    await saveTodos(path, todos);
    return result;
  });
}

export async function closeDb(): Promise<void> {
  await writeQueue;
  writeQueue = Promise.resolve();
}
