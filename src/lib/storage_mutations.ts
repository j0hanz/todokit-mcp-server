import { createErrorResponse } from './errors.js';
import type { MatchOutcome } from './resolve.js';
import { normalizeTags } from './storage_filters.js';
import type { Todo } from './types.js';

export type TodoUpdate = Partial<Omit<Todo, 'id' | 'createdAt'>>;

function normalizeUpdateTags(updates: TodoUpdate): TodoUpdate {
  const normalizedUpdates = { ...updates };
  if (normalizedUpdates.tags) {
    normalizedUpdates.tags = normalizeTags(normalizedUpdates.tags);
  }
  return normalizedUpdates;
}

function resolveCompletedChange(
  completed: boolean,
  updates: TodoUpdate,
  now: string
): Pick<Todo, 'completed' | 'completedAt'> {
  return {
    completed,
    completedAt: completed ? (updates.completedAt ?? now) : undefined,
  };
}

function resolveCompletedAtChange(
  completed: boolean,
  updates: TodoUpdate
): Pick<Todo, 'completed' | 'completedAt'> {
  return {
    completed,
    completedAt: updates.completedAt,
  };
}

function resolveCompletionUpdate(
  currentTodo: Todo,
  updates: TodoUpdate,
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

function buildUpdatedTodo(currentTodo: Todo, updates: TodoUpdate): Todo {
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

export function updateTodoInList(
  todos: Todo[],
  id: string,
  updates: TodoUpdate
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

export function createNotFoundOutcome(id: string): MatchOutcome {
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

export type CompleteTodoOutcome =
  | MatchOutcome
  | { kind: 'already'; todo: Todo };

export function completeTodoInList(
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
