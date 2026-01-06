import { randomUUID } from 'node:crypto';

import { readTodos, withTodos } from './db.js';
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
import {
  type CompleteTodoOutcome,
  createNotFoundOutcome,
  type TodoUpdate,
} from './storage_mutations.js';
import { type Todo } from './types.js';

export { normalizeTags };
export type { CompleteTodoOutcome };

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
    if (!updated.result) {
      return {
        todos,
        result: createNotFoundOutcome(outcome.todo.id),
      };
    }

    return {
      todos: updated.todos,
      result: { kind: 'match', todo: updated.result },
    };
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
    if (!updated.result) {
      return {
        todos,
        result: createNotFoundOutcome(outcome.todo.id),
      };
    }

    return {
      todos: updated.todos,
      result: { kind: 'match', todo: updated.result },
    };
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
