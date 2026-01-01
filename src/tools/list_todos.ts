import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { getTodos } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import type { Todo } from '../lib/types.js';
import { ListTodosFilterSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';

type ListTodosFilters = z.infer<typeof ListTodosFilterSchema>;
type SortBy = 'dueDate' | 'priority' | 'createdAt' | 'title';
type SortOrder = 'asc' | 'desc';

interface NormalizedFilters {
  completed?: boolean;
  priority?: Todo['priority'];
  tag?: string;
  dueBefore?: string;
  dueAfter?: string;
  query?: string;
  sortBy: SortBy;
  order: SortOrder;
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;
const PRIORITY_WEIGHT: Record<Todo['priority'], number> = {
  low: 1,
  normal: 2,
  high: 3,
};
const MISSING_DUE_DATE = '9999-12-31';

function getTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isOverdue(todo: Todo, todayIso: string): boolean {
  if (!todo.dueDate) return false;
  if (todo.completed) return false;
  return todo.dueDate < todayIso;
}

function compareStrings(a: string, b: string): number {
  return a.localeCompare(b);
}

function compareDueDate(a: Todo, b: Todo): number {
  const dateA = a.dueDate ?? MISSING_DUE_DATE;
  const dateB = b.dueDate ?? MISSING_DUE_DATE;
  return compareStrings(dateA, dateB);
}

function comparePriority(a: Todo, b: Todo): number {
  return PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
}

function compareTitle(a: Todo, b: Todo): number {
  return compareStrings(a.title, b.title);
}

function compareCreatedAt(a: Todo, b: Todo): number {
  return compareStrings(a.createdAt, b.createdAt);
}

const COMPARATORS: Record<SortBy, (a: Todo, b: Todo) => number> = {
  dueDate: compareDueDate,
  priority: comparePriority,
  title: compareTitle,
  createdAt: compareCreatedAt,
};

function sortTodos(todos: Todo[], sortBy: SortBy, order: SortOrder): Todo[] {
  const direction = order === 'desc' ? -1 : 1;
  const comparator = COMPARATORS[sortBy];
  return [...todos].sort((a, b) => {
    const primary = comparator(a, b) * direction;
    if (primary !== 0) return primary;
    return compareCreatedAt(a, b);
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

function normalizeFilters(filters: ListTodosFilters): NormalizedFilters {
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

function computeCounts(
  todos: Todo[],
  todayIso: string
): {
  total: number;
  completed: number;
  pending: number;
  overdue: number;
} {
  let completed = 0;
  let overdue = 0;
  for (const todo of todos) {
    if (todo.completed) {
      completed += 1;
    }
    if (isOverdue(todo, todayIso)) {
      overdue += 1;
    }
  }
  const total = todos.length;
  return {
    total,
    completed,
    pending: total - completed,
    overdue,
  };
}

function buildSummary(
  counts: {
    total: number;
    completed: number;
    pending: number;
    overdue: number;
  },
  pageCount: number
): string {
  if (counts.total === 0) {
    return 'No todos found';
  }
  const overdueSuffix =
    counts.overdue > 0 ? `, ${String(counts.overdue)} overdue` : '';
  return `Showing ${String(pageCount)} of ${String(counts.total)} todos (${String(
    counts.pending
  )} pending, ${String(counts.completed)} completed${overdueSuffix}).`;
}

function paginateTodos(todos: Todo[], offset: number, limit: number): Todo[] {
  return todos.slice(offset, offset + limit);
}

async function handleListTodos(
  filters: ListTodosFilters
): Promise<CallToolResult> {
  const normalized = normalizeFilters(filters);
  const allTodos = await getTodos({
    completed: normalized.completed,
    priority: normalized.priority,
    tag: normalized.tag,
    dueBefore: normalized.dueBefore,
    dueAfter: normalized.dueAfter,
    query: normalized.query,
  });

  const todayIso = getTodayIso();
  const counts = computeCounts(allTodos, todayIso);
  const sorted = sortTodos(allTodos, normalized.sortBy, normalized.order);
  const paged = paginateTodos(sorted, normalized.offset, normalized.limit);
  const summary = buildSummary(counts, paged.length);
  const hasMore = normalized.offset + paged.length < counts.total;

  return createToolResponse({
    ok: true,
    result: {
      items: paged,
      summary,
      counts: {
        total: counts.total,
        pending: counts.pending,
        completed: counts.completed,
        overdue: counts.overdue,
      },
      limit: normalized.limit,
      offset: normalized.offset,
      hasMore,
    },
  });
}

export function registerListTodos(server: McpServer): void {
  server.registerTool(
    'list_todos',
    {
      title: 'List Todos',
      description: 'List todos with filtering, search, sorting, and pagination',
      inputSchema: ListTodosFilterSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (filters) => {
      try {
        return await handleListTodos(filters);
      } catch (err) {
        return createErrorResponse('E_LIST_TODOS', getErrorMessage(err));
      }
    }
  );
}
