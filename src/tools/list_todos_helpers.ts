import type { z } from 'zod';

import type { Todo } from '../lib/types.js';
import type { ListTodosFilterSchema } from '../schemas/inputs.js';

export type ListTodosFilters = z.infer<typeof ListTodosFilterSchema>;
type SortBy = 'dueDate' | 'priority' | 'createdAt' | 'title';
type SortOrder = 'asc' | 'desc';

export interface NormalizedFilters {
  completed?: boolean | undefined;
  priority?: Todo['priority'] | undefined;
  tag?: string | undefined;
  dueBefore?: string | undefined;
  dueAfter?: string | undefined;
  query?: string | undefined;
  sortBy: SortBy;
  order: SortOrder;
  limit: number;
  offset: number;
}

export interface CountSummary {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  isCreatedAtAsc: boolean;
  isCreatedAtDesc: boolean;
}

interface OrderState {
  previousCreatedAt: string | null;
  isCreatedAtAsc: boolean;
  isCreatedAtDesc: boolean;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;
const PRIORITY_WEIGHT: Record<Todo['priority'], number> = {
  low: 1,
  normal: 2,
  high: 3,
};
const MISSING_DUE_DATE = '9999-12-31';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function getTodayIso(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  return `${year}-${month}-${day}`;
}

function isOverdue(todo: Todo, todayIso: string): boolean {
  if (!todo.dueDate) return false;
  if (todo.completed) return false;
  return todo.dueDate < todayIso;
}

const COMPARATORS: Record<SortBy, (a: Todo, b: Todo) => number> = {
  dueDate: (a, b) =>
    (a.dueDate ?? MISSING_DUE_DATE).localeCompare(
      b.dueDate ?? MISSING_DUE_DATE
    ),
  priority: (a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority],
  title: (a, b) => a.title.localeCompare(b.title),
  createdAt: (a, b) => a.createdAt.localeCompare(b.createdAt),
};

export function sortTodos(
  todos: readonly Todo[],
  sortBy: SortBy,
  order: SortOrder
): Todo[] {
  const direction = order === 'desc' ? -1 : 1;
  const comparator = COMPARATORS[sortBy];

  return todos.toSorted((a, b) => {
    const diff = comparator(a, b);
    if (diff !== 0) return diff * direction;
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function resolveCompletedFilter(
  status: ListTodosFilters['status'],
  completed: ListTodosFilters['completed']
): boolean | undefined {
  if (status === 'pending') return false;
  if (status === 'completed') return true;
  return completed;
}

export function normalizeFilters(filters: ListTodosFilters): NormalizedFilters {
  return {
    completed: resolveCompletedFilter(filters.status, filters.completed),
    priority: filters.priority,
    tag: filters.tag,
    dueBefore: filters.dueBefore,
    dueAfter: filters.dueAfter,
    query: filters.query,
    sortBy: filters.sortBy ?? 'createdAt',
    order: filters.order ?? 'asc',
    limit: filters.limit ?? DEFAULT_LIMIT,
    offset: filters.offset ?? DEFAULT_OFFSET,
  };
}

export function computeCounts(
  todos: readonly Todo[],
  todayIso: string
): CountSummary {
  const orderState = createOrderState();
  const totals = todos.reduce(
    (current, todo) => {
      current.completed += Number(todo.completed);
      current.overdue += Number(isOverdue(todo, todayIso));
      updateOrderState(orderState, todo.createdAt);
      return current;
    },
    { completed: 0, overdue: 0 }
  );
  const total = todos.length;
  return {
    total,
    completed: totals.completed,
    pending: total - totals.completed,
    overdue: totals.overdue,
    isCreatedAtAsc: orderState.isCreatedAtAsc,
    isCreatedAtDesc: orderState.isCreatedAtDesc,
  };
}

function createOrderState(): OrderState {
  return {
    previousCreatedAt: null,
    isCreatedAtAsc: true,
    isCreatedAtDesc: true,
  };
}

function updateOrderState(state: OrderState, current: string): void {
  const previous = state.previousCreatedAt;
  if (previous === null) {
    state.previousCreatedAt = current;
    return;
  }
  if (current < previous) {
    state.isCreatedAtAsc = false;
  } else if (current > previous) {
    state.isCreatedAtDesc = false;
  }
  state.previousCreatedAt = current;
}

export function buildSummary(counts: CountSummary, pageCount: number): string {
  if (counts.total === 0) {
    return 'No todos found';
  }
  const overdueSuffix =
    counts.overdue > 0 ? `, ${String(counts.overdue)} overdue` : '';
  return `Showing ${String(pageCount)} of ${String(counts.total)} todos (${String(
    counts.pending
  )} pending, ${String(counts.completed)} completed${overdueSuffix}).`;
}

export function paginateTodos(
  todos: readonly Todo[],
  offset: number,
  limit: number
): Todo[] {
  return todos.slice(offset, offset + limit);
}

export function canReuseOrder(
  sortBy: SortBy,
  order: SortOrder,
  counts: CountSummary
): boolean {
  if (sortBy !== 'createdAt') return false;
  return order === 'asc' ? counts.isCreatedAtAsc : counts.isCreatedAtDesc;
}
