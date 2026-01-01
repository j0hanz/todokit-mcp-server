import type { Todo } from './types.js';

export interface TodoFilters {
  completed?: boolean;
  priority?: 'low' | 'normal' | 'high';
  tag?: string;
  dueBefore?: string;
  dueAfter?: string;
  query?: string;
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

function matchesQuery(todo: Todo, query: string): boolean {
  const haystack = `${todo.title} ${todo.description ?? ''} ${todo.tags.join(
    ' '
  )}`.toLowerCase();
  return haystack.includes(query);
}

function normalizeQuery(query?: string): string | undefined {
  const trimmed = query?.trim().toLowerCase();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function matchesCompleted(todo: Todo, completed?: boolean): boolean {
  return completed === undefined || todo.completed === completed;
}

function matchesPriority(todo: Todo, priority?: Todo['priority']): boolean {
  return !priority || todo.priority === priority;
}

function matchesTag(todo: Todo, tag?: string): boolean {
  return !tag || todo.tags.includes(tag);
}

function matchesDueBefore(todo: Todo, dueBefore?: string): boolean {
  return !dueBefore || Boolean(todo.dueDate && todo.dueDate < dueBefore);
}

function matchesDueAfter(todo: Todo, dueAfter?: string): boolean {
  return !dueAfter || Boolean(todo.dueDate && todo.dueDate > dueAfter);
}

function matchesQueryTerm(todo: Todo, query?: string): boolean {
  return !query || matchesQuery(todo, query);
}

function matchesBasicFilters(
  todo: Todo,
  f: TodoFilters,
  tag?: string
): boolean {
  return (
    matchesCompleted(todo, f.completed) &&
    matchesPriority(todo, f.priority) &&
    matchesTag(todo, tag)
  );
}

function matchesDateAndQuery(
  todo: Todo,
  f: TodoFilters,
  query?: string
): boolean {
  return (
    matchesQueryTerm(todo, query) &&
    matchesDueBefore(todo, f.dueBefore) &&
    matchesDueAfter(todo, f.dueAfter)
  );
}

function todoMatches(
  todo: Todo,
  f: TodoFilters,
  tag?: string,
  query?: string
): boolean {
  return (
    matchesBasicFilters(todo, f, tag) && matchesDateAndQuery(todo, f, query)
  );
}

export function filterTodos(todos: Todo[], filters: TodoFilters): Todo[] {
  const tag = filters.tag ? normalizeTag(filters.tag) : undefined;
  const query = normalizeQuery(filters.query);
  return todos.filter((todo) => todoMatches(todo, filters, tag, query));
}
