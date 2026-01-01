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

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function getTodayIso(): string {
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

function sortTodos(todos: Todo[], sortBy: SortBy, order: SortOrder): Todo[] {
  const direction = order === 'desc' ? -1 : 1;
  const comparator = COMPARATORS[sortBy];

  return [...todos].sort((a, b) => {
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
