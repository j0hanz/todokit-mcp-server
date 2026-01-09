import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { toResolveInput } from '../lib/resolve.js';
import { updateTodoBySelector } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import { UpdateTodoSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';
import { registerToolWithDiagnostics } from './register_tool.js';
import {
  buildUpdatePayload,
  type UpdateTodoInput,
} from './update_todo_helpers.js';

async function handleUpdateTodo(
  input: UpdateTodoInput
): Promise<CallToolResult> {
  const selector =
    input.id !== undefined ? { id: input.id } : { query: input.query };
  const outcome = await updateTodoBySelector(toResolveInput(selector), (todo) =>
    buildUpdatePayload(todo, input)
  );
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
    return outcome.response;
  }
  if (outcome.kind === 'no_updates') {
    return createErrorResponse('E_BAD_REQUEST', 'No fields provided to update');
  }

  return createToolResponse({
    ok: true,
    result: {
      item: outcome.todo,
      summary: `Updated todo "${outcome.todo.title}"`,
      nextActions: ['list_todos', 'complete_todo'],
    },
  });
}

export function registerUpdateTodo(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'update_todo',
    {
      title: 'Update Todo',
      description: 'Update fields on a todo item (supports search and tag ops)',
      inputSchema: UpdateTodoSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
      },
    },
    async (input) => {
      try {
        return await handleUpdateTodo(input);
      } catch (err) {
        return createErrorResponse('E_UPDATE_TODO', getErrorMessage(err));
      }
    }
  );
}
