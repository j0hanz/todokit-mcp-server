import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAddTodo } from './add_todo.js';
import { registerAddTodos } from './add_todos.js';
import { registerCompleteTodo } from './complete_todo.js';
import { registerDeleteTodo } from './delete_todo.js';
import { registerDeleteTodos } from './delete_todos.js';
import { registerListTodos } from './list_todos.js';
import { registerUpdateTodo } from './update_todo.js';

const TOOL_REGISTRATIONS: ((server: McpServer) => void)[] = [
  registerAddTodo,
  registerAddTodos,
  registerListTodos,
  registerUpdateTodo,
  registerCompleteTodo,
  registerDeleteTodo,
  registerDeleteTodos,
];

export function registerAllTools(server: McpServer): void {
  TOOL_REGISTRATIONS.forEach((register) => {
    register(server);
  });
}
