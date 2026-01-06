import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { addTodos } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import { AddTodosSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';
import { registerToolWithDiagnostics } from './register_tool.js';

export function registerAddTodos(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'add_todos',
    {
      title: 'Add Todos (Batch)',
      description: 'Add multiple todo items in one call',
      inputSchema: AddTodosSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    async ({ items }) => {
      try {
        const todos = await addTodos(items);
        return createToolResponse({
          ok: true,
          result: {
            items: todos,
            summary: `Added ${String(todos.length)} todos`,
            nextActions: ['list_todos', 'update_todo'],
          },
        });
      } catch (err) {
        return createErrorResponse('E_ADD_TODOS', getErrorMessage(err));
      }
    }
  );
}
