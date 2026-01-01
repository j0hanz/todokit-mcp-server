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

interface NormalizedFilters {
  completed?: boolean;
  priority?: 'low' | 'normal' | 'high';
  tag?: string;
  dueBefore?: string;
  dueAfter?: string;
  query?: string;
}

type Matcher = (todo: Todo, filters: NormalizedFilters) => boolean;

function normalizeFilters(filters: TodoFilters): NormalizedFilters {
  return {
    completed: filters.completed,
    priority: filters.priority,
    tag: filters.tag ? normalizeTag(filters.tag) : undefined,
    dueBefore: filters.dueBefore,
    dueAfter: filters.dueAfter,
    query: normalizeQuery(filters.query),
  };
}

function matchesCompletion(todo: Todo, completed?: boolean): boolean {
  return completed === undefined ? true : todo.completed === completed;
}

function matchesPriority(todo: Todo, priority?: Todo['priority']): boolean {
  return priority ? todo.priority === priority : true;
}

function matchesTag(todo: Todo, tag?: string): boolean {
  return tag ? todo.tags.includes(tag) : true;
}

function matchesQueryFilter(todo: Todo, query?: string): boolean {
  return query ? matchesQuery(todo, query) : true;
}

function matchesDueBefore(todo: Todo, dueBefore?: string): boolean {
  return dueBefore ? Boolean(todo.dueDate && todo.dueDate < dueBefore) : true;
}

function matchesDueAfter(todo: Todo, dueAfter?: string): boolean {
  return dueAfter ? Boolean(todo.dueDate && todo.dueDate > dueAfter) : true;
}

const MATCHERS: Matcher[] = [
  (todo, filters) => matchesCompletion(todo, filters.completed),
  (todo, filters) => matchesPriority(todo, filters.priority),
  (todo, filters) => matchesTag(todo, filters.tag),
  (todo, filters) => matchesQueryFilter(todo, filters.query),
  (todo, filters) => matchesDueBefore(todo, filters.dueBefore),
  (todo, filters) => matchesDueAfter(todo, filters.dueAfter),
];

function todoMatches(todo: Todo, filters: NormalizedFilters): boolean {
  for (const check of MATCHERS) {
    if (!check(todo, filters)) {
      return false;
    }
  }
  return true;
}

export function filterTodos(todos: Todo[], filters: TodoFilters): Todo[] {
  const normalized = normalizeFilters(filters);
  return todos.filter((todo) => todoMatches(todo, normalized));
}
