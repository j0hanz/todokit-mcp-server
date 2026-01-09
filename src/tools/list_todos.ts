import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { getTodos } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import type { Todo } from '../lib/types.js';
import { ListTodosFilterSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';
import {
  buildSummary,
  canReuseOrder,
  computeCounts,
  type CountSummary,
  getTodayIso,
  type ListTodosFilters,
  type NormalizedFilters,
  normalizeFilters,
  paginateTodos,
  sortTodos,
} from './list_todos_helpers.js';
import { registerToolWithDiagnostics } from './register_tool.js';

function buildListResponse(
  paged: readonly Todo[],
  counts: CountSummary,
  normalized: NormalizedFilters
): CallToolResult {
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
  const sorted: readonly Todo[] = canReuseOrder(
    normalized.sortBy,
    normalized.order,
    counts
  )
    ? allTodos
    : sortTodos(allTodos, normalized.sortBy, normalized.order);
  const paged = paginateTodos(sorted, normalized.offset, normalized.limit);
  return buildListResponse(paged, counts, normalized);
}

export function registerListTodos(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
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
