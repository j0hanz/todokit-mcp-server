import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { toResolveInput } from '../lib/resolve.js';
import { completeTodoBySelector } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import type { Todo } from '../lib/types.js';
import { CompleteTodoSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';

type CompleteTodoInput = z.infer<typeof CompleteTodoSchema>;

function resolveTargetCompleted(input: CompleteTodoInput): boolean {
  return input.completed ?? true;
}

function buildAlreadyStatusResponse(
  todo: Todo,
  completed: boolean
): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      item: todo,
      summary: completed
        ? `Todo "${todo.title}" is already completed`
        : `Todo "${todo.title}" is already pending`,
      nextActions: ['list_todos'],
    },
  });
}

function buildCompletionResponse(
  todo: Todo,
  completed: boolean
): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      item: todo,
      summary: completed
        ? `Completed todo "${todo.title}"`
        : `Reopened todo "${todo.title}"`,
      nextActions: ['list_todos'],
    },
  });
}

async function handleCompleteTodo(
  input: CompleteTodoInput
): Promise<CallToolResult> {
  const targetCompleted = resolveTargetCompleted(input);
  const outcome = await completeTodoBySelector(
    toResolveInput({ id: input.id, query: input.query }),
    targetCompleted
  );
  if (outcome.kind === 'error') return outcome.response;
  if (outcome.kind === 'ambiguous') return outcome.response;
  if (outcome.kind === 'already') {
    return buildAlreadyStatusResponse(outcome.todo, targetCompleted);
  }

  return buildCompletionResponse(outcome.todo, targetCompleted);
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
