import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { toResolveInput } from '../lib/resolve.js';
import {
  completeTodoBySelector,
  type CompleteTodoOutcome,
} from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import type { Todo } from '../lib/types.js';
import { CompleteTodoSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';

type CompleteTodoInput = z.infer<typeof CompleteTodoSchema>;

function buildStatusResponse(todo: Todo, summary: string): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      item: todo,
      summary,
      nextActions: ['list_todos'],
    },
  });
}

function buildCompletionSummary(
  todo: Todo,
  completed: boolean,
  already: boolean
): string {
  if (already) {
    return completed
      ? `Todo "${todo.title}" is already completed`
      : `Todo "${todo.title}" is already pending`;
  }
  return completed
    ? `Completed todo "${todo.title}"`
    : `Reopened todo "${todo.title}"`;
}

function buildOutcomeResponse(
  outcome: CompleteTodoOutcome,
  targetCompleted: boolean
): CallToolResult {
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
    return outcome.response;
  }
  return buildStatusResponse(
    outcome.todo,
    buildCompletionSummary(
      outcome.todo,
      targetCompleted,
      outcome.kind === 'already'
    )
  );
}

async function handleCompleteTodo(
  input: CompleteTodoInput
): Promise<CallToolResult> {
  const targetCompleted = input.completed ?? true;
  const outcome = await completeTodoBySelector(
    toResolveInput({ id: input.id, query: input.query }),
    targetCompleted
  );
  return buildOutcomeResponse(outcome, targetCompleted);
}

export function registerCompleteTodo(server: McpServer): void {
  server.registerTool(
    'complete_todo',
    {
      title: 'Complete Todo',
      description: 'Set completion status for a todo item',
      inputSchema: CompleteTodoSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
      },
    },
    async (input) => {
      try {
        return await handleCompleteTodo(input);
      } catch (err) {
        return createErrorResponse('E_COMPLETE_TODO', getErrorMessage(err));
      }
    }
  );
}
