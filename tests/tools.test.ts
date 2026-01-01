import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { addTodo, getTodos } from '../src/lib/storage.js';
import { registerAddTodo } from '../src/tools/add_todo.js';
import { registerAddTodos } from '../src/tools/add_todos.js';
import { registerCompleteTodo } from '../src/tools/complete_todo.js';
import { registerDeleteTodo } from '../src/tools/delete_todo.js';
import { registerAllTools } from '../src/tools/index.js';
import { registerListTodos } from '../src/tools/list_todos.js';
import { registerUpdateTodo } from '../src/tools/update_todo.js';
import './setup.js';

type ToolHandler<T> = (input: T) => Promise<CallToolResult>;

type StructuredResult = {
  structuredContent?: {
    ok?: boolean;
    result?: Record<string, unknown>;
    error?: { code?: string };
  };
};

function createToolHarness() {
  const handlers = new Map<string, unknown>();
  const server = {
    registerTool(name: string, _config: unknown, handler: unknown) {
      handlers.set(name, handler);
      return {} as unknown;
    },
  } as McpServer;

  const getHandler = <T>(name: string): ToolHandler<T> => {
    const handler = handlers.get(name);
    if (!handler) {
      throw new Error(`Missing handler for ${name}`);
    }
    return handler as ToolHandler<T>;
  };

  return { server, getHandler };
}

function getStructured(result: CallToolResult) {
  return (result as StructuredResult).structuredContent;
}

describe('tool handlers', () => {
  it('registers all tools', () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);
    const names = [
      'add_todo',
      'add_todos',
      'list_todos',
      'update_todo',
      'complete_todo',
      'delete_todo',
    ];
    for (const name of names) {
      assert.doesNotThrow(() => getHandler(name));
    }
  });

  it('adds single and batch todos', async () => {
    const { server, getHandler } = createToolHarness();
    registerAddTodo(server);
    registerAddTodos(server);

    const addHandler = getHandler<{ title: string }>('add_todo');
    const batchHandler = getHandler<{ items: { title: string }[] }>(
      'add_todos'
    );

    const addResult = await addHandler({ title: 'Task A' });
    assert.equal(getStructured(addResult)?.ok, true);

    const batchResult = await batchHandler({
      items: [{ title: 'Task B' }, { title: 'Task C' }],
    });
    assert.equal(getStructured(batchResult)?.ok, true);

    const todos = await getTodos();
    assert.equal(todos.length, 3);
  });

  it('lists todos with counts and sorting', async (t) => {
    const { server, getHandler } = createToolHarness();
    registerListTodos(server);

    t.mock.timers.enable({
      apis: ['Date'],
      now: new Date('2025-01-10T00:00:00Z'),
    });

    try {
      await addTodo('Alpha', undefined, 'high', '2025-01-05');
      await addTodo('Beta', undefined, 'low', '2025-01-12');

      const listHandler = getHandler<{ sortBy: string; order: string }>(
        'list_todos'
      );
      const result = await listHandler({ sortBy: 'priority', order: 'desc' });
      const structured = getStructured(result)?.result as Record<
        string,
        unknown
      >;

      assert.deepEqual(structured.counts, {
        total: 2,
        pending: 2,
        completed: 0,
        overdue: 1,
      });
    } finally {
      t.mock.timers.reset();
    }
  });

  it('updates, completes, and deletes todos', async () => {
    const { server, getHandler } = createToolHarness();
    registerUpdateTodo(server);
    registerCompleteTodo(server);
    registerDeleteTodo(server);

    const todo = await addTodo('Manage');

    const updateHandler = getHandler<{
      id: string;
      tagOps?: { add?: string[] };
    }>('update_todo');
    const updateResult = await updateHandler({
      id: todo.id,
      tagOps: { add: ['Work'] },
    });
    assert.equal(getStructured(updateResult)?.ok, true);

    const completeHandler = getHandler<{ id: string }>('complete_todo');
    const completeResult = await completeHandler({ id: todo.id });
    assert.equal(getStructured(completeResult)?.ok, true);

    const deleteHandler = getHandler<{ id: string }>('delete_todo');
    const deleteResult = await deleteHandler({ id: todo.id });
    assert.equal(getStructured(deleteResult)?.ok, true);
  });

  it('supports delete dry-run on ambiguous matches', async () => {
    const { server, getHandler } = createToolHarness();
    registerDeleteTodo(server);

    await addTodo('Shared Item');
    await addTodo('Shared Item Two');

    const deleteHandler = getHandler<{ query: string; dryRun: boolean }>(
      'delete_todo'
    );
    const result = await deleteHandler({ query: 'Shared', dryRun: true });

    const structured = getStructured(result);
    assert.equal(structured?.ok, true);
    assert.equal(structured?.result?.dryRun, true);
  });
});
