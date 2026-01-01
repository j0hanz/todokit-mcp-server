import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { addTodo } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import { AddTodoSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';

export function registerAddTodo(server: McpServer): void {
  server.registerTool(
    'add_todo',
    {
      title: 'Add Todo',
      description: 'Add a new todo item',
      inputSchema: AddTodoSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
      },
    },
    async ({ title, description, priority, dueDate, tags }) => {
      try {
        const todo = await addTodo(title, description, priority, dueDate, tags);
        const structured = {
          ok: true,
          result: {
            item: todo,
            summary: `Added todo "${todo.title}"`,
            nextActions: ['list_todos', 'update_todo', 'complete_todo'],
          },
        };
        return createToolResponse(structured);
      } catch (err) {
        return createErrorResponse('E_ADD_TODO', getErrorMessage(err));
      }
    }
  );
}
