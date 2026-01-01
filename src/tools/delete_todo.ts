import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import {
  type MatchOutcome,
  resolveTodoTargetFromTodos,
  toResolveInput,
  unwrapResolution,
} from '../lib/resolve.js';
import { deleteTodoBySelector, getTodos } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import type { Todo } from '../lib/types.js';
import { DeleteTodoSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';

type DeleteTodoInput = z.infer<typeof DeleteTodoSchema>;

type AmbiguousOutcome = Extract<MatchOutcome, { kind: 'ambiguous' }>;

function buildDryRunSingle(todo: Todo): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [todo.id],
      summary: `Dry run: would delete todo "${todo.title}"`,
      dryRun: true,
    },
  });
}

function buildDryRunMultiple(
  previews: unknown[],
  total: number
): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [],
      summary: `Dry run: ${String(total)} todos would be deleted`,
      matches: previews,
      totalMatches: total,
      dryRun: true,
    },
  });
}

function buildDeleteSuccess(todo: Todo): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [todo.id],
      summary: `Deleted todo "${todo.title}"`,
      nextActions: ['list_todos'],
    },
  });
}

function handleAmbiguousDelete(
  outcome: AmbiguousOutcome,
  dryRun: boolean
): CallToolResult {
  if (dryRun) {
    return buildDryRunMultiple(outcome.previews, outcome.matches.length);
  }
  return outcome.response;
}

function handleMatchDelete(todo: Todo, dryRun: boolean): CallToolResult {
  if (dryRun) {
    return buildDryRunSingle(todo);
  }
  return buildDeleteSuccess(todo);
}

async function handleDeleteTodoDryRun(
  input: DeleteTodoInput
): Promise<CallToolResult> {
  const todos = await getTodos();
  const outcome = unwrapResolution(
    resolveTodoTargetFromTodos(
      todos,
      toResolveInput({ id: input.id, query: input.query })
    )
  );
  if (outcome.kind === 'error') return outcome.response;
  if (outcome.kind === 'ambiguous') {
    return handleAmbiguousDelete(outcome, true);
  }
  return handleMatchDelete(outcome.todo, true);
}

async function handleDeleteTodoLive(
  input: DeleteTodoInput
): Promise<CallToolResult> {
  const outcome = await deleteTodoBySelector(
    toResolveInput({ id: input.id, query: input.query })
  );
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
    return outcome.response;
  }

  return handleMatchDelete(outcome.todo, false);
}

async function handleDeleteTodo(
  input: DeleteTodoInput
): Promise<CallToolResult> {
  const dryRun = input.dryRun ?? false;
  if (dryRun) {
    return handleDeleteTodoDryRun(input);
  }
  return handleDeleteTodoLive(input);
}

export function registerDeleteTodo(server: McpServer): void {
  server.registerTool(
    'delete_todo',
    {
      title: 'Delete Todo',
      description: 'Delete a todo item (supports dry-run)',
      inputSchema: DeleteTodoSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
      },
    },
    async (input) => {
      try {
        return await handleDeleteTodo(input);
      } catch (err) {
        return createErrorResponse('E_DELETE_TODO', getErrorMessage(err));
      }
    }
  );
}
