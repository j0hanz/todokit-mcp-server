import { randomUUID } from 'node:crypto';

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
  completeTodoInList,
  type CompleteTodoOutcome,
  createNotFoundOutcome,
  type TodoUpdate,
  updateTodoInList,
} from './storage_mutations.js';
import {
  persistTodos,
  queueWrite,
  readTodosFromDisk,
  waitForWrites,
} from './storage_state.js';
import { type Todo } from './types.js';

export { normalizeTags };

interface NewTodoInput {
  title: string;
  description?: string;
  priority?: 'low' | 'normal' | 'high';
  dueDate?: string;
  tags?: string[];
}

export async function getTodos(filters?: TodoFilters): Promise<Todo[]> {
  await waitForWrites();
  const todos = await readTodosFromDisk();
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

type UpdatePlan =
  | { kind: 'updates'; id: string; updates: TodoUpdate }
  | UpdateTodoOutcome;

function resolveMatchOutcome(
  todos: Todo[],
  input: ResolveTodoInput
): MatchOutcome {
  return unwrapResolution(resolveTodoTargetFromTodos(todos, input));
}

function buildUpdatePlan(
  outcome: MatchOutcome,
  buildUpdates: (todo: Todo) => TodoUpdate | null
): UpdatePlan {
  if (outcome.kind !== 'match') {
    return outcome;
  }
  const nextUpdates = buildUpdates(outcome.todo);
  if (!nextUpdates || Object.keys(nextUpdates).length === 0) {
    return { kind: 'no_updates' };
  }
  return { kind: 'updates', id: outcome.todo.id, updates: nextUpdates };
}

function applyUpdatePlan(todos: Todo[], plan: UpdatePlan): UpdateTodoOutcome {
  if (plan.kind !== 'updates') {
    return plan;
  }
  const updatedTodo = updateTodoInList(todos, plan.id, plan.updates);
  if (!updatedTodo) {
    return createNotFoundOutcome(plan.id);
  }
  return { kind: 'match', todo: updatedTodo };
}

export async function updateTodoBySelector(
  input: ResolveTodoInput,
  buildUpdates: (todo: Todo) => TodoUpdate | null
): Promise<UpdateTodoOutcome> {
  return queueWrite(async () => {
    const todos = await readTodosFromDisk();
    const outcome = resolveMatchOutcome(todos, input);
    const plan = buildUpdatePlan(outcome, buildUpdates);
    if (plan.kind !== 'updates') return plan;

    const result = applyUpdatePlan(todos, plan);
    if (result.kind !== 'match') return result;

    await persistTodos(todos);
    return result;
  });
}

export async function deleteTodoBySelector(
  input: ResolveTodoInput
): Promise<MatchOutcome> {
  return queueWrite(async () => {
    const todos = await readTodosFromDisk();
    const outcome = resolveMatchOutcome(todos, input);
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

export type { CompleteTodoOutcome };

export async function completeTodoBySelector(
  input: ResolveTodoInput,
  completed: boolean
): Promise<CompleteTodoOutcome> {
  return queueWrite(async () => {
    const todos = await readTodosFromDisk();
    const outcome = resolveMatchOutcome(todos, input);
    if (outcome.kind !== 'match') return outcome;

    const result = completeTodoInList(todos, outcome.todo.id, completed);
    if (result.kind === 'match') {
      await persistTodos(todos);
    }
    return result;
  });
}
