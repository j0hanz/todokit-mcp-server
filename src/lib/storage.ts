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
  description?: string;
  priority?: 'low' | 'normal' | 'high';
  dueDate?: string;
  tags?: string[];
}

function getAllTodos(): Promise<Todo[]> {
  return readTodos();
}

export async function getTodos(filters?: TodoFilters): Promise<Todo[]> {
  const todos = await getAllTodos();
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

function calculateUpdatedTodo(
  current: Todo,
  updates: Partial<Omit<Todo, 'id' | 'createdAt'>>
): Todo {
  if (updates.tags) {
    updates.tags = normalizeTags(updates.tags);
  }

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

export function updateTodo(
  id: string,
  updates: Partial<Omit<Todo, 'id' | 'createdAt'>>
): Promise<Todo | null> {
  return withTodos((todos) => {
    const index = todos.findIndex((todo) => todo.id === id);
    if (index < 0) {
      return { todos, result: null };
    }
    const current = todos[index];
    if (!current) {
      return { todos, result: null };
    }
    const updatedTodo = calculateUpdatedTodo(current, updates);
    const nextTodos = [...todos];
    nextTodos[index] = updatedTodo;
    return { todos: nextTodos, result: updatedTodo };
  });
}

export function deleteTodo(id: string): Promise<boolean> {
  return withTodos((todos) => {
    const remaining = todos.filter((todo) => todo.id !== id);
    return { todos: remaining, result: remaining.length !== todos.length };
  });
}

export type UpdateTodoOutcome = MatchOutcome | { kind: 'no_updates' };

export async function updateTodoBySelector(
  input: ResolveTodoInput,
  buildUpdates: (todo: Todo) => TodoUpdate | null
): Promise<UpdateTodoOutcome> {
  const todos = await getAllTodos();
  const outcome = unwrapResolution(resolveTodoTargetFromTodos(todos, input));
  if (outcome.kind !== 'match') {
    return outcome;
  }

  const updates = buildUpdates(outcome.todo);
  if (!updates || Object.keys(updates).length === 0) {
    return { kind: 'no_updates' };
  }

  const updated = await updateTodo(outcome.todo.id, updates);
  if (!updated) {
    return createNotFoundOutcome(outcome.todo.id);
  }

  return { kind: 'match', todo: updated };
}

export async function deleteTodoBySelector(
  input: ResolveTodoInput
): Promise<MatchOutcome> {
  const todos = await getAllTodos();
  const outcome = unwrapResolution(resolveTodoTargetFromTodos(todos, input));
  if (outcome.kind !== 'match') return outcome;

  const deleted = await deleteTodo(outcome.todo.id);
  if (!deleted) {
    return createNotFoundOutcome(outcome.todo.id);
  }

  return { kind: 'match', todo: outcome.todo };
}

export async function completeTodoBySelector(
  input: ResolveTodoInput,
  completed: boolean
): Promise<CompleteTodoOutcome> {
  const todos = await getAllTodos();
  const outcome = unwrapResolution(resolveTodoTargetFromTodos(todos, input));
  if (outcome.kind !== 'match') return outcome;

  const updated = await updateTodo(outcome.todo.id, { completed });
  if (!updated) {
    return createNotFoundOutcome(outcome.todo.id);
  }

  return { kind: 'match', todo: updated };
}

export function deleteTodosByIds(ids: string[]): Promise<string[]> {
  const idsToDelete = new Set(ids);
  return withTodos((todos) => {
    const deletedIds: string[] = [];
    const remaining: Todo[] = [];
    for (const todo of todos) {
      if (idsToDelete.has(todo.id)) {
        deletedIds.push(todo.id);
      } else {
        remaining.push(todo);
      }
    }
    return { todos: remaining, result: deletedIds };
  });
}
