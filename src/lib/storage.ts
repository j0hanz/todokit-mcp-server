import { randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createErrorResponse } from './errors.js';
import {
  type MatchOutcome,
  type ResolveTodoInput,
  resolveTodoTargetFromTodos,
  unwrapResolution,
} from './resolve.js';
import {
  filterTodos,
  normalizeTags,
  type TodoFilters,
} from './storage_filters.js';
import { type Todo, TodosSchema } from './types.js';

export { normalizeTags };

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TODO_FILE = join(__dirname, '../../todos.json');
const FILE_TIMEOUT_MS = 5000;
const FILE_ENCODING = 'utf-8' as const;
const TEMP_DIR_PREFIX = '.tmp-';

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

function getTodoFilePath(): string {
  const override = process.env.TODOKIT_TODO_FILE?.trim();
  if (override) {
    return resolve(override);
  }
  return DEFAULT_TODO_FILE;
}

let writeChain: Promise<void> = Promise.resolve();
let cachedTodos: Todo[] | null = null;
let cachedMtimeMs: number | null = null;
let cachedPath: string | null = null;
let inFlightRead: Promise<Todo[]> | null = null;
let inFlightPath: string | null = null;

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

function isFileNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  if (!('code' in error)) return false;
  return (error as { code?: string }).code === 'ENOENT';
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

async function readTodosWithCache(path: string): Promise<Todo[]> {
  try {
    const stats = await statTodoFile(path);
    if (!stats) {
      clearCacheForPath(path);
      return [];
    }
    const cached = getCachedTodos(path, stats.mtimeMs);
    if (cached) {
      return cached;
    }
    const parsed = await readTodosFile(path);
    updateCache(path, parsed, stats.mtimeMs);
    return parsed;
  } catch (error: unknown) {
    if (isFileNotFound(error)) {
      clearCacheForPath(path);
      return [];
    }
    throw error;
  }
}

async function readTodosFromDisk(): Promise<Todo[]> {
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
    await writeFile(tempPath, data, {
      encoding: FILE_ENCODING,
      signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
      flush: true,
    });
    await withTimeout(
      rename(tempPath, path),
      FILE_TIMEOUT_MS,
      'rename todo file'
    );
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

function queueWrite<T>(task: () => Promise<T>): Promise<T> {
  const next = writeChain.then(task, task);
  writeChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

async function persistTodos(todos: Todo[]): Promise<void> {
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

export async function getTodos(filters?: TodoFilters): Promise<Todo[]> {
  await writeChain;
  const todos = await readTodosFromDisk();
  return filters ? filterTodos(todos, filters) : todos;
}

interface NewTodoInput {
  title: string;
  description?: string;
  priority?: 'low' | 'normal' | 'high';
  dueDate?: string;
  tags?: string[];
}

export async function addTodo(
  title: string,
  description?: string,
  priority: 'low' | 'normal' | 'high' = 'normal',
  dueDate?: string,
  tags: string[] = []
): Promise<Todo> {
  const [todo] = await addTodos([
    { title, description, priority, dueDate, tags },
  ]);
  if (!todo) {
    throw new Error('Failed to create todo');
  }
  return todo;
}

export async function addTodos(items: NewTodoInput[]): Promise<Todo[]> {
  return queueWrite(async () => {
    const todos = await readTodosFromDisk();
    const timestamp = new Date().toISOString();
    const newTodos: Todo[] = items.map((item) => ({
      id: randomUUID(),
      title: item.title,
      description: item.description,
      completed: false,
      priority: item.priority ?? 'normal',
      dueDate: item.dueDate,
      tags: normalizeTags(item.tags ?? []),
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: undefined,
    }));
    const nextTodos = [...todos, ...newTodos];
    await persistTodos(nextTodos);
    return newTodos;
  });
}

function normalizeUpdateTags(
  updates: Partial<Omit<Todo, 'id' | 'createdAt'>>
): Partial<Omit<Todo, 'id' | 'createdAt'>> {
  const normalizedUpdates = { ...updates };
  if (normalizedUpdates.tags) {
    normalizedUpdates.tags = normalizeTags(normalizedUpdates.tags);
  }
  return normalizedUpdates;
}

function resolveCompletedChange(
  completed: boolean,
  updates: Partial<Omit<Todo, 'id' | 'createdAt'>>,
  now: string
): Pick<Todo, 'completed' | 'completedAt'> {
  return {
    completed,
    completedAt: completed ? (updates.completedAt ?? now) : undefined,
  };
}

function resolveCompletedAtChange(
  completed: boolean,
  updates: Partial<Omit<Todo, 'id' | 'createdAt'>>
): Pick<Todo, 'completed' | 'completedAt'> {
  return {
    completed,
    completedAt: updates.completedAt,
  };
}

function resolveCompletionUpdate(
  currentTodo: Todo,
  updates: Partial<Omit<Todo, 'id' | 'createdAt'>>,
  now: string
): Pick<Todo, 'completed' | 'completedAt'> {
  const completed = updates.completed ?? currentTodo.completed;
  if (updates.completed !== undefined) {
    return resolveCompletedChange(completed, updates, now);
  }
  if (updates.completedAt !== undefined) {
    return resolveCompletedAtChange(completed, updates);
  }
  return { completed, completedAt: currentTodo.completedAt };
}

function buildUpdatedTodo(
  currentTodo: Todo,
  updates: Partial<Omit<Todo, 'id' | 'createdAt'>>
): Todo {
  const now = new Date().toISOString();
  const { completed, completedAt } = resolveCompletionUpdate(
    currentTodo,
    updates,
    now
  );
  return {
    ...currentTodo,
    ...updates,
    completed,
    completedAt,
    updatedAt: now,
  };
}

function updateTodoInList(
  todos: Todo[],
  id: string,
  updates: Partial<Omit<Todo, 'id' | 'createdAt'>>
): Todo | null {
  const index = todos.findIndex((todo) => todo.id === id);
  if (index === -1) return null;

  const currentTodo = todos[index];
  if (!currentTodo) return null;

  const normalizedUpdates = normalizeUpdateTags(updates);
  const updatedTodo = buildUpdatedTodo(currentTodo, normalizedUpdates);

  todos[index] = updatedTodo;
  return updatedTodo;
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

function findTodoById(todos: Todo[], id: string): Todo | null {
  const match = todos.find((todo) => todo.id === id);
  return match ?? null;
}

function getCompletionTimestamp(completed: boolean): string | undefined {
  return completed ? new Date().toISOString() : undefined;
}

export async function updateTodo(
  id: string,
  updates: Partial<Omit<Todo, 'id' | 'createdAt'>>
): Promise<Todo | null> {
  return queueWrite(async () => {
    const todos = await readTodosFromDisk();
    const updatedTodo = updateTodoInList(todos, id, updates);
    if (!updatedTodo) return null;

    await persistTodos(todos);
    return updatedTodo;
  });
}

export async function deleteTodo(id: string): Promise<boolean> {
  return queueWrite(async () => {
    const todos = await readTodosFromDisk();
    const index = todos.findIndex((todo) => todo.id === id);
    if (index === -1) return false;

    todos.splice(index, 1);
    await persistTodos(todos);
    return true;
  });
}

export type UpdateTodoOutcome = MatchOutcome | { kind: 'no_updates' };

export async function updateTodoBySelector(
  input: ResolveTodoInput,
  buildUpdates: (todo: Todo) => Partial<Omit<Todo, 'id' | 'createdAt'>> | null
): Promise<UpdateTodoOutcome> {
  return queueWrite(async () => {
    const todos = await readTodosFromDisk();
    const outcome = unwrapResolution(resolveTodoTargetFromTodos(todos, input));
    if (outcome.kind !== 'match') return outcome;

    const nextUpdates = buildUpdates(outcome.todo);
    if (!nextUpdates || Object.keys(nextUpdates).length === 0) {
      return { kind: 'no_updates' };
    }

    const updatedTodo = updateTodoInList(todos, outcome.todo.id, nextUpdates);
    if (!updatedTodo) {
      return createNotFoundOutcome(outcome.todo.id);
    }

    await persistTodos(todos);
    return { kind: 'match', todo: updatedTodo };
  });
}

export async function deleteTodoBySelector(
  input: ResolveTodoInput
): Promise<MatchOutcome> {
  return queueWrite(async () => {
    const todos = await readTodosFromDisk();
    const outcome = unwrapResolution(resolveTodoTargetFromTodos(todos, input));
    if (outcome.kind !== 'match') return outcome;

    const index = todos.findIndex((todo) => todo.id === outcome.todo.id);
    if (index === -1) {
      return createNotFoundOutcome(outcome.todo.id);
    }

    const [removed] = todos.splice(index, 1);
    if (!removed) {
      return createNotFoundOutcome(outcome.todo.id);
    }

    await persistTodos(todos);
    return { kind: 'match', todo: removed };
  });
}

export type CompleteTodoOutcome =
  | MatchOutcome
  | { kind: 'already'; todo: Todo };

function completeTodoInList(
  todos: Todo[],
  id: string,
  completed: boolean
): CompleteTodoOutcome {
  const currentTodo = findTodoById(todos, id);
  if (!currentTodo) {
    return createNotFoundOutcome(id);
  }
  if (currentTodo.completed === completed) {
    return { kind: 'already', todo: currentTodo };
  }

  const updatedTodo = updateTodoInList(todos, id, {
    completed,
    completedAt: getCompletionTimestamp(completed),
  });
  if (!updatedTodo) {
    return createNotFoundOutcome(id);
  }
  return { kind: 'match', todo: updatedTodo };
}

export async function completeTodoBySelector(
  input: ResolveTodoInput,
  completed: boolean
): Promise<CompleteTodoOutcome> {
  return queueWrite(async () => {
    const todos = await readTodosFromDisk();
    const outcome = unwrapResolution(resolveTodoTargetFromTodos(todos, input));
    if (outcome.kind !== 'match') return outcome;

    const result = completeTodoInList(todos, outcome.todo.id, completed);
    if (result.kind === 'match') {
      await persistTodos(todos);
    }
    return result;
  });
}
