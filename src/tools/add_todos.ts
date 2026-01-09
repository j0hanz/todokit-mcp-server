import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { addTodos } from '../lib/storage.js';
import { AddTodosSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';
import { buildAddTodosResponse } from './add_todo_helpers.js';
import { registerToolWithDiagnostics } from './register_tool.js';

type AddTodosInput = z.infer<typeof AddTodosSchema>;

const addTodosToolConfig = {
  title: 'Add Todos (Batch)',
  description: 'Add multiple todo items in one call',
  inputSchema: AddTodosSchema,
  outputSchema: DefaultOutputSchema,
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
  },
};

async function handleAddTodos(input: AddTodosInput): Promise<CallToolResult> {
  try {
    const todos = await addTodos(input.items);
    return buildAddTodosResponse(todos);
  } catch (err) {
    return createErrorResponse('E_ADD_TODOS', getErrorMessage(err));
  }
}

export function registerAddTodos(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'add_todos',
    addTodosToolConfig,
    handleAddTodos
  );
}
