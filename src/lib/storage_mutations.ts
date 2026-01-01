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

function resolveCompletionUpdate(
  currentTodo: Todo,
  updates: TodoUpdate,
  now: string
): Pick<Todo, 'completed' | 'completedAt'> {
  const completed = updates.completed ?? currentTodo.completed;
  const completedAt =
    updates.completedAt ??
    (updates.completed !== undefined
      ? completed
        ? now
        : undefined
      : currentTodo.completedAt);
  return { completed, completedAt };
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

export type CompleteTodoOutcome =
  | MatchOutcome
  | { kind: 'already'; todo: Todo };

export function completeTodoInList(
  todos: Todo[],
  id: string,
  completed: boolean
): CompleteTodoOutcome {
  const currentTodo = todos.find((todo) => todo.id === id);
  if (!currentTodo) {
    return createNotFoundOutcome(id);
  }
  if (currentTodo.completed === completed) {
    return { kind: 'already', todo: currentTodo };
  }

  const updatedTodo = updateTodoInList(todos, id, {
    completed,
    completedAt: completed ? new Date().toISOString() : undefined,
  });
  if (!updatedTodo) {
    return createNotFoundOutcome(id);
  }
  return { kind: 'match', todo: updatedTodo };
}
