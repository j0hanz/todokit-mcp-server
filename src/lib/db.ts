import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nowMs, publishStorageEvent } from './diagnostics.js';
import {
  getFileMtime,
  readFileIfExists,
  writeFileAtomic,
} from './storage_io.js';
import { type Todo, TodosSchema } from './types.js';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TODO_FILE = join(moduleDir, '../../todos.json');

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

async function loadTodos(path: string): Promise<Todo[]> {
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

export async function readTodos(): Promise<readonly Todo[]> {
  const start = nowMs();
  await writeQueue;
  const path = getTodoFilePath();
  const mtimeMs = await getFileMtime(path, IO_TIMEOUT_MS);
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
    cache = {
      todos: current,
      mtimeMs: await getFileMtime(path, IO_TIMEOUT_MS),
    };
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
