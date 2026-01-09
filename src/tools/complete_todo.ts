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
import { registerToolWithDiagnostics } from './register_tool.js';

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
  title: string,
  already: boolean,
  targetCompleted: boolean
): string {
  if (already && targetCompleted) {
    return `Todo "${title}" is already completed`;
  }
  if (already) {
    return `Todo "${title}" is already pending`;
  }
  if (targetCompleted) {
    return `Completed todo "${title}"`;
  }
  return `Reopened todo "${title}"`;
}

function buildOutcomeResponse(
  outcome: CompleteTodoOutcome,
  targetCompleted: boolean
): CallToolResult {
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
    return outcome.response;
  }
  const already = outcome.kind === 'already';
  const summary = buildCompletionSummary(
    outcome.todo.title,
    already,
    targetCompleted
  );
  return buildStatusResponse(outcome.todo, summary);
}

async function handleCompleteTodo(
  input: CompleteTodoInput
): Promise<CallToolResult> {
  const targetCompleted = input.completed ?? true;
  const selector =
    input.id !== undefined ? { id: input.id } : { query: input.query };
  const outcome = await completeTodoBySelector(
    toResolveInput(selector),
    targetCompleted
  );
  return buildOutcomeResponse(outcome, targetCompleted);
}

export function registerCompleteTodo(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
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
