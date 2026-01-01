import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Todo, TodosSchema } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TODO_FILE = join(__dirname, '../../todos.json');

let writeQueue: Promise<void> = Promise.resolve();

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
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

async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tempPath, contents, 'utf8');
  try {
    await rename(tempPath, path);
  } catch {
    await rm(path, { force: true });
    await rename(tempPath, path);
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
