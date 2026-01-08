import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { addTodos } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import { AddTodoSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';
import { registerToolWithDiagnostics } from './register_tool.js';

type AddTodoInput = z.infer<typeof AddTodoSchema>;

const addTodoToolConfig = {
  title: 'Add Todo',
  description: 'Add a new todo item',
  inputSchema: AddTodoSchema,
  outputSchema: DefaultOutputSchema,
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
  },
};

async function handleAddTodo(input: AddTodoInput): Promise<CallToolResult> {
  const { title, description, priority, dueDate, tags } = input;
  try {
    const [todo] = await addTodos([
      { title, description, priority, dueDate, tags },
    ]);
    if (!todo) {
      throw new Error('Failed to create todo');
    }
    return createToolResponse({
      ok: true,
      result: {
        item: todo,
        summary: `Added todo "${todo.title}"`,
        nextActions: ['list_todos', 'update_todo', 'complete_todo'],
      },
    });
  } catch (err) {
    return createErrorResponse('E_ADD_TODO', getErrorMessage(err));
  }
}

export function registerAddTodo(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'add_todo',
    addTodoToolConfig,
    handleAddTodo
  );
}
