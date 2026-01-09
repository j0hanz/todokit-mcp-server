import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import {
  resolveTodoTargetFromTodos,
  toResolveInput,
  unwrapResolution,
} from '../lib/resolve.js';
import { deleteTodoBySelector, getTodos } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import type { Todo } from '../lib/types.js';
import { DeleteTodoSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';
import { registerToolWithDiagnostics } from './register_tool.js';

type DeleteTodoInput = z.infer<typeof DeleteTodoSchema>;

function getSelector(input: DeleteTodoInput): { id?: string; query?: string } {
  return input.id !== undefined ? { id: input.id } : { query: input.query };
}

function buildDryRunMultiple(
  previews: readonly unknown[],
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

function buildDeleteResponse(todo: Todo, dryRun: boolean): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [todo.id],
      summary: dryRun
        ? `Dry run: would delete todo "${todo.title}"`
        : `Deleted todo "${todo.title}"`,
      ...(dryRun ? { dryRun: true } : { nextActions: ['list_todos'] }),
    },
  });
}

async function handleDeleteTodo(
  input: DeleteTodoInput
): Promise<CallToolResult> {
  const selector = getSelector(input);
  const dryRun = input.dryRun ?? false;

  if (dryRun) {
    const todos = await getTodos();
    const outcome = unwrapResolution(
      resolveTodoTargetFromTodos(todos, toResolveInput(selector))
    );
    if (outcome.kind === 'error') return outcome.response;
    if (outcome.kind === 'ambiguous') {
      return buildDryRunMultiple(outcome.previews, outcome.matches.length);
    }
    return buildDeleteResponse(outcome.todo, true);
  }

  const outcome = await deleteTodoBySelector(toResolveInput(selector));
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
    return outcome.response;
  }
  return buildDeleteResponse(outcome.todo, false);
}

export function registerDeleteTodo(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
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
