import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

export function isNotFoundError(error: unknown): boolean {
  return getErrorCode(error) === 'ENOENT';
}

function isTransientError(error: unknown): boolean {
  const code = getErrorCode(error);
  return code !== undefined && TRANSIENT_ERROR_CODES.has(code);
}

export function isAbortError(error: unknown): boolean {
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

export async function getFileMtime(
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

export async function readFileIfExists(
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

export async function writeFileAtomic(
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

const moduleDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_TODO_FILE = join(moduleDir, '../todos.json');

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
    const mtimeMs = await getFileMtime(path, IO_TIMEOUT_MS);
    const current =
      cache?.mtimeMs === mtimeMs ? cache.todos : await loadTodos(path);
    cache = { todos: current, mtimeMs };
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

export interface TodoFilters {
  completed?: boolean | undefined;
  priority?: 'low' | 'normal' | 'high' | undefined;
  tag?: string | undefined;
  dueBefore?: string | undefined;
  dueAfter?: string | undefined;
  query?: string | undefined;
}

function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

export function normalizeTags(tags: string[]): string[] {
  const normalized = tags
    .map((tag) => normalizeTag(tag))
    .filter((tag) => tag.length > 0);
  return Array.from(new Set(normalized));
}

function matchesCompleted(todo: Todo, completed?: boolean): boolean {
  return completed === undefined || todo.completed === completed;
}

function matchesPriority(todo: Todo, priority?: string): boolean {
  return !priority || todo.priority === priority;
}

function matchesTag(todo: Todo, tag?: string): boolean {
  return !tag || todo.tags.includes(tag);
}

function matchesBasic(todo: Todo, filters: TodoFilters, tag?: string): boolean {
  return (
    matchesCompleted(todo, filters.completed) &&
    matchesPriority(todo, filters.priority) &&
    matchesTag(todo, tag)
  );
}

function matchesDueDateRange(
  todo: Todo,
  dueBefore?: string,
  dueAfter?: string
): boolean {
  if (!dueBefore && !dueAfter) return true;
  const { dueDate } = todo;
  if (!dueDate) return false;
  if (dueBefore && dueDate >= dueBefore) return false;
  if (dueAfter && dueDate <= dueAfter) return false;
  return true;
}

function matchesQuery(todo: Todo, query?: string): boolean {
  if (!query) return true;

  if (todo.title.toLowerCase().includes(query)) return true;
  if (todo.description?.toLowerCase().includes(query)) return true;
  return todo.tags.some((tag) => tag.toLowerCase().includes(query));
}

export function filterTodos(
  todos: readonly Todo[],
  filters: TodoFilters
): readonly Todo[] {
  const query = filters.query?.trim().toLowerCase();
  const tag = filters.tag ? normalizeTag(filters.tag) : undefined;

  return todos.filter(
    (todo) =>
      matchesBasic(todo, filters, tag) &&
      matchesDueDateRange(todo, filters.dueBefore, filters.dueAfter) &&
      matchesQuery(todo, query)
  );
}

export interface TodoMatchPreview {
  id: string;
  title: string;
  priority: Todo['priority'];
  dueDate?: string;
  completed: boolean;
}

const PREVIEW_LIMIT = 5;

function buildMatchPreviews(
  todos: readonly Todo[],
  limit: number = PREVIEW_LIMIT
): TodoMatchPreview[] {
  return todos.slice(0, limit).map((todo) => ({
    id: todo.id,
    title: todo.title,
    priority: todo.priority,
    completed: todo.completed,
    ...(todo.dueDate === undefined ? {} : { dueDate: todo.dueDate }),
  }));
}

export type ResolveTodoInput =
  | { id: string; query?: never }
  | { query: string; id?: never };

export function toResolveInput(input: {
  id?: string;
  query?: string;
}): ResolveTodoInput {
  if (input.id) {
    return { id: input.id };
  }
  if (input.query) {
    return { query: input.query };
  }
  throw new Error('Provide id or query to identify the todo');
}

export type ResolveTodoResult =
  | { kind: 'match'; todo: Todo }
  | { kind: 'missing'; response: ErrorResponse }
  | { kind: 'not_found'; response: ErrorResponse }
  | {
      kind: 'ambiguous';
      response: ErrorResponse;
      matches: readonly Todo[];
      previews: readonly TodoMatchPreview[];
      query: string;
    };

export type MatchOutcome =
  | { kind: 'match'; todo: Todo }
  | {
      kind: 'ambiguous';
      response: ErrorResponse;
      matches: readonly Todo[];
      previews: readonly TodoMatchPreview[];
      query: string;
    }
  | { kind: 'error'; response: ErrorResponse };

export function unwrapResolution(result: ResolveTodoResult): MatchOutcome {
  if (result.kind === 'match') {
    return result;
  }
  if (result.kind === 'ambiguous') {
    return result;
  }
  return { kind: 'error', response: result.response };
}

function createMissingIdentifierError(): ErrorResponse {
  return createErrorResponse(
    'E_BAD_REQUEST',
    'Provide id or query to identify the todo'
  );
}

function createNotFoundError(target: string): ErrorResponse {
  return createErrorResponse('E_NOT_FOUND', `Todo "${target}" not found`);
}

function createAmbiguousError(
  query: string,
  matches: readonly Todo[]
): { response: ErrorResponse; previews: readonly TodoMatchPreview[] } {
  const previews = buildMatchPreviews(matches);
  const response = createErrorResponse(
    'E_AMBIGUOUS',
    `Multiple todos match "${query}"`,
    {
      matches: previews,
      totalMatches: matches.length,
      hint: `Multiple todos match "${query}". Use id for an exact match.`,
    }
  );
  return { response, previews };
}

function resolveByIdFromTodos(
  todos: readonly Todo[],
  id: string
): ResolveTodoResult {
  const match = todos.find((todo) => todo.id === id);
  if (!match) {
    return { kind: 'not_found', response: createNotFoundError(id) };
  }
  return { kind: 'match', todo: match };
}

function resolveByQueryFromTodos(
  todos: readonly Todo[],
  query: string
): ResolveTodoResult {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return { kind: 'missing', response: createMissingIdentifierError() };
  }
  const matches = filterTodos(todos, { query: trimmedQuery });
  const [firstMatch] = matches;
  if (matches.length === 1 && firstMatch) {
    return { kind: 'match', todo: firstMatch };
  }
  if (matches.length === 0) {
    return { kind: 'not_found', response: createNotFoundError(trimmedQuery) };
  }
  const { response, previews } = createAmbiguousError(trimmedQuery, matches);
  return {
    kind: 'ambiguous',
    response,
    matches,
    previews,
    query: trimmedQuery,
  };
}

export function resolveTodoTargetFromTodos(
  todos: readonly Todo[],
  input: ResolveTodoInput
): ResolveTodoResult {
  if (input.id !== undefined) {
    return resolveByIdFromTodos(todos, input.id);
  }
  return resolveByQueryFromTodos(todos, input.query);
}

export type TodoUpdate = Partial<
  Pick<
    Todo,
    'title' | 'description' | 'completed' | 'priority' | 'dueDate' | 'tags'
  >
>;

export function createNotFoundOutcome(id: string): MatchOutcome {
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
  title: string;
  description?: string | undefined;
  priority?: 'low' | 'normal' | 'high' | undefined;
  dueDate?: string | undefined;
  tags?: string[] | undefined;
}

function normalizeUpdates(updates: TodoUpdate): TodoUpdate {
  if (!updates.tags) return updates;
  return { ...updates, tags: normalizeTags(updates.tags) };
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function hasOwnKey<T extends object>(obj: T, key: PropertyKey): key is keyof T {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function valuesEqual(current: unknown, update: unknown): boolean {
  if (isStringArray(update) && isStringArray(current)) {
    return areStringArraysEqual(update, current);
  }
  return Object.is(current, update);
}

function hasChanges(current: Todo, updates: TodoUpdate): boolean {
  return Object.entries(updates).some(([key, value]) => {
    if (!hasOwnKey(current, key)) return true;
    return !valuesEqual(current[key], value);
  });
}

export async function getTodos(
  filters?: TodoFilters
): Promise<readonly Todo[]> {
  const todos = await readTodos();
  return filters ? filterTodos(todos, filters) : todos;
}

function createNewTodo(item: NewTodoInput, timestamp: string): Todo {
  return {
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

  if (
    updates.completed !== undefined &&
    updates.completed !== current.completed
  ) {
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
  const normalizedUpdates = normalizeUpdates(updates);
  if (!hasChanges(current, normalizedUpdates)) {
    return { todos, result: current };
  }
  const updatedTodo = calculateUpdatedTodo(current, normalizedUpdates);
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

export async function updateTodoBySelector(
  input: ResolveTodoInput,
  buildUpdates: (todo: Todo) => TodoUpdate | null
): Promise<UpdateTodoOutcome> {
  return withTodos<UpdateTodoOutcome>((todos) => {
    const outcome = unwrapResolution(resolveTodoTargetFromTodos(todos, input));
    if (outcome.kind !== 'match') {
      return { todos, result: outcome };
    }

    const updates = buildUpdates(outcome.todo);
    if (!updates || Object.keys(updates).length === 0) {
      return { todos, result: { kind: 'no_updates' } };
    }

    const updated = applyUpdateToTodos(todos, outcome.todo.id, updates);
    return buildUpdateOutcome(updated, outcome.todo.id);
  });
}

export async function deleteTodoBySelector(
  input: ResolveTodoInput
): Promise<MatchOutcome> {
  return withTodos<MatchOutcome>((todos) => {
    const outcome = unwrapResolution(resolveTodoTargetFromTodos(todos, input));
    if (outcome.kind !== 'match') {
      return { todos, result: outcome };
    }

    const remaining = todos.filter((todo) => todo.id !== outcome.todo.id);
    if (remaining.length === todos.length) {
      return {
        todos,
        result: createNotFoundOutcome(outcome.todo.id),
      };
    }

    return { todos: remaining, result: { kind: 'match', todo: outcome.todo } };
  });
}

export async function completeTodoBySelector(
  input: ResolveTodoInput,
  completed: boolean
): Promise<CompleteTodoOutcome> {
  return withTodos<CompleteTodoOutcome>((todos) => {
    const outcome = unwrapResolution(resolveTodoTargetFromTodos(todos, input));
    if (outcome.kind !== 'match') {
      return { todos, result: outcome };
    }

    if (outcome.todo.completed === completed) {
      return { todos, result: { kind: 'already', todo: outcome.todo } };
    }

    const updated = applyUpdateToTodos(todos, outcome.todo.id, { completed });
    return buildUpdateOutcome(updated, outcome.todo.id);
  });
}

export function deleteTodosByIds(ids: string[]): Promise<string[]> {
  const idsToDelete = new Set(ids);
  return withTodos((todos) => {
    const remaining = todos.filter((todo) => !idsToDelete.has(todo.id));
    const deletedIds = todos
      .filter((todo) => idsToDelete.has(todo.id))
      .map((todo) => todo.id);
    return { todos: remaining, result: deletedIds };
  });
}
