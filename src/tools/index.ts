import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerAddTodo } from './add_todo.js';
import { registerAddTodos } from './add_todos.js';
import { registerCompleteTodo } from './complete_todo.js';
import { registerDeleteTodo } from './delete_todo.js';
import { registerListTodos } from './list_todos.js';
import { registerUpdateTodo } from './update_todo.js';

export function registerAllTools(server: McpServer): void {
  registerAddTodo(server);
  registerAddTodos(server);
  registerListTodos(server);
  registerUpdateTodo(server);
  registerCompleteTodo(server);
  registerDeleteTodo(server);
}
