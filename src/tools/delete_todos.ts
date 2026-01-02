import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { z } from 'zod';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { deleteTodosByIds, getTodos } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import type { Todo } from '../lib/types.js';
import { IsoDateSchema } from '../schemas/iso_date.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';

const TagSchema = z.string().min(1).max(50);

type FilterKey =
  | 'status'
  | 'priority'
  | 'tag'
  | 'dueBefore'
  | 'dueAfter'
  | 'query';
const FILTER_KEYS: FilterKey[] = [
  'status',
  'priority',
  'tag',
  'dueBefore',
  'dueAfter',
  'query',
];

function hasAtLeastOneFilter(v: Record<string, unknown>): boolean {
  return FILTER_KEYS.some((key) => v[key] !== undefined);
}

const DeleteTodosSchema = z
  .strictObject({
    status: z
      .enum(['pending', 'completed', 'all'])
      .optional()
      .describe('Filter by status'),
    priority: z
      .enum(['low', 'normal', 'high'])
      .optional()
      .describe('Filter by priority'),
    tag: TagSchema.optional().describe('Filter by tag'),
    dueBefore: IsoDateSchema.optional().describe(
      'Delete todos due before this date (ISO format)'
    ),
    dueAfter: IsoDateSchema.optional().describe(
      'Delete todos due after this date (ISO format)'
    ),
    query: z.string().min(1).max(200).optional().describe('Search text filter'),
    dryRun: z
      .boolean()
      .optional()
      .describe('Preview deletion without removing data'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Max items to delete (default: 10, safety limit)'),
  })
  .refine(hasAtLeastOneFilter, {
    error: 'At least one filter is required for bulk delete',
  });

type DeleteTodosInput = z.infer<typeof DeleteTodosSchema>;

const DEFAULT_LIMIT = 10;

function resolveCompletedFilter(
  status?: 'pending' | 'completed' | 'all'
): boolean | undefined {
  if (status === 'pending') return false;
  if (status === 'completed') return true;
  return undefined;
}

function buildPreview(todo: Todo): { id: string; title: string } {
  return { id: todo.id, title: todo.title };
}

function buildNoMatchResponse(): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [],
      summary: 'No todos matched the filters',
      totalMatched: 0,
    },
  });
}

function buildDryRunResponse(
  toDelete: Todo[],
  totalMatched: number
): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [],
      summary: `Dry run: ${String(toDelete.length)} of ${String(totalMatched)} matching todos would be deleted`,
      matches: toDelete.map(buildPreview),
      totalMatched,
      dryRun: true,
    },
  });
}

function buildDeletedResponse(
  deletedIds: string[],
  totalMatched: number
): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds,
      summary: `Deleted ${String(deletedIds.length)} todos`,
      totalMatched,
      nextActions: ['list_todos'],
    },
  });
}

async function handleDeleteTodos(
  input: DeleteTodosInput
): Promise<CallToolResult> {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const dryRun = input.dryRun ?? false;

  const matches = await getTodos({
    completed: resolveCompletedFilter(input.status),
    priority: input.priority,
    tag: input.tag,
    dueBefore: input.dueBefore,
    dueAfter: input.dueAfter,
    query: input.query,
  });

  if (matches.length === 0) {
    return buildNoMatchResponse();
  }

  const toDelete = matches.slice(0, limit);

  if (dryRun) {
    return buildDryRunResponse(toDelete, matches.length);
  }

  const deletedIds = await deleteTodosByIds(toDelete.map((t) => t.id));
  return buildDeletedResponse(deletedIds, matches.length);
}

export function registerDeleteTodos(server: McpServer): void {
  server.registerTool(
    'delete_todos',
    {
      title: 'Delete Todos (Bulk)',
      description:
        'Delete multiple todos matching filters (requires at least one filter, defaults to limit=10 for safety)',
      inputSchema: DeleteTodosSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
      },
    },
    async (input) => {
      try {
        return await handleDeleteTodos(input);
      } catch (err) {
        return createErrorResponse('E_DELETE_TODOS', getErrorMessage(err));
      }
    }
  );
}
