import type { Todo } from './types.js';

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
