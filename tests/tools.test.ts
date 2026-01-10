import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { addTodos, getTodos } from '../src/storage.js';
import {
  registerAddTodo,
  registerAddTodos,
  registerAllTools,
  registerCompleteTodo,
  registerDeleteTodo,
  registerDeleteTodos,
  registerListTodos,
  registerUpdateTodo,
} from '../src/tools.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

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

describe('tool handlers', { timeout: TEST_TIMEOUT_MS }, () => {
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
      'delete_todos',
    ];
    names.forEach((name) => {
      assert.doesNotThrow(() => getHandler(name));
    });
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

  it('lists todos with counts and sorting', async () => {
    const { server, getHandler } = createToolHarness();
    registerListTodos(server);

    const [alpha, beta] = await addTodos([
      { title: 'Alpha', description: 'Alpha task' },
      { title: 'Beta', description: 'Beta task' },
    ]);
    assert.ok(alpha);
    assert.ok(beta);

    const listHandler = getHandler<{ sortBy: string; order: string }>(
      'list_todos'
    );
    const result = await listHandler({ sortBy: 'title', order: 'asc' });
    const structured = getStructured(result)?.result as Record<string, unknown>;

    assert.deepEqual(structured.counts, {
      total: 2,
      pending: 2,
      completed: 0,
    });
    const titles = (structured.items as { title: string }[]).map(
      (item) => item.title
    );
    assert.deepEqual(titles, ['Alpha', 'Beta']);
  });

  it('lists todos with limit using createdAt sort', async () => {
    const { server, getHandler } = createToolHarness();
    registerListTodos(server);

    const [first, second, third] = await addTodos([
      { title: 'First', description: 'First task' },
      { title: 'Second', description: 'Second task' },
      { title: 'Third', description: 'Third task' },
    ]);
    assert.ok(first);
    assert.ok(second);
    assert.ok(third);

    const listHandler = getHandler<{
      sortBy: string;
      order: string;
      limit: number;
    }>('list_todos');
    const result = await listHandler({
      sortBy: 'title',
      order: 'asc',
      limit: 2,
    });
    const structured = getStructured(result)?.result as Record<string, unknown>;
    const titles = (structured.items as { title: string }[]).map(
      (item) => item.title
    );
    assert.deepEqual(titles, ['First', 'Second']);
  });

  it('lists empty results with summary', async () => {
    const { server, getHandler } = createToolHarness();
    registerListTodos(server);

    const listHandler = getHandler<Record<string, never>>('list_todos');
    const result = await listHandler({});
    const structured = getStructured(result)?.result as Record<string, unknown>;

    assert.equal(structured.summary, 'No todos found');
    assert.deepEqual(structured.counts, {
      total: 0,
      pending: 0,
      completed: 0,
    });
  });

  it('filters by completed status', async () => {
    const { server, getHandler } = createToolHarness();
    registerListTodos(server);
    registerCompleteTodo(server);

    const [pending, completed] = await addTodos([
      { title: 'Pending', description: 'Test' },
      { title: 'Completed', description: 'Test' },
    ]);
    assert.ok(pending);
    assert.ok(completed);

    const completeHandler = getHandler<{ id: string }>('complete_todo');
    await completeHandler({ id: completed.id });

    const listHandler = getHandler<{ status: string }>('list_todos');

    const completedResult = await listHandler({ status: 'completed' });
    const completedStructured = getStructured(completedResult)
      ?.result as Record<string, unknown>;
    assert.equal(
      (completedStructured.counts as { completed: number }).completed,
      1
    );

    const pendingResult = await listHandler({ status: 'pending' });
    const pendingStructured = getStructured(pendingResult)?.result as Record<
      string,
      unknown
    >;
    assert.equal((pendingStructured.counts as { pending: number }).pending, 1);

    const ids = (pendingStructured.items as { id: string }[]).map(
      (item) => item.id
    );
    assert.deepEqual(ids, [pending.id]);
  });

  it('updates, completes, and deletes todos', async () => {
    const { server, getHandler } = createToolHarness();
    registerUpdateTodo(server);
    registerCompleteTodo(server);
    registerDeleteTodo(server);

    const [todo] = await addTodos([{ title: 'Manage', description: 'Test' }]);
    assert.ok(todo);

    const updateHandler = getHandler<{
      id: string;
      title?: string;
    }>('update_todo');
    const updateResult = await updateHandler({
      id: todo.id,
      title: 'Updated Title',
    });
    assert.equal(getStructured(updateResult)?.ok, true);

    const completeHandler = getHandler<{ id: string }>('complete_todo');
    const completeResult = await completeHandler({ id: todo.id });
    assert.equal(getStructured(completeResult)?.ok, true);

    const deleteHandler = getHandler<{ id: string }>('delete_todo');
    const deleteResult = await deleteHandler({ id: todo.id });
    assert.equal(getStructured(deleteResult)?.ok, true);
  });

  it('handles update clearFields and no-updates errors', async () => {
    const { server, getHandler } = createToolHarness();
    registerUpdateTodo(server);

    const [todo] = await addTodos([
      { title: 'Update Me', description: 'Has description' },
    ]);
    assert.ok(todo);

    const updateHandler = getHandler<{
      id: string;
      clearFields?: string[];
    }>('update_todo');

    const updateResult = await updateHandler({
      id: todo.id,
      clearFields: ['description'],
    });
    assert.equal(getStructured(updateResult)?.ok, true);

    const noUpdates = await updateHandler({ id: todo.id });
    const structured = getStructured(noUpdates);
    assert.equal(structured?.error?.code, 'E_BAD_REQUEST');
  });

  it('completes, reopens, and handles already state', async () => {
    const { server, getHandler } = createToolHarness();
    registerCompleteTodo(server);

    const [todo] = await addTodos([
      { title: 'Finish Me', description: 'Test' },
    ]);
    assert.ok(todo);
    const completeHandler = getHandler<{ id: string; completed?: boolean }>(
      'complete_todo'
    );

    const completeResult = await completeHandler({ id: todo.id });
    assert.equal(getStructured(completeResult)?.ok, true);
    const completeStructured = getStructured(completeResult)?.result as Record<
      string,
      unknown
    >;
    const completeItem = completeStructured.item as {
      updatedAt?: string;
    };

    const alreadyResult = await completeHandler({ id: todo.id });
    assert.equal(getStructured(alreadyResult)?.ok, true);
    const alreadyStructured = getStructured(alreadyResult)?.result as Record<
      string,
      unknown
    >;
    const alreadyItem = alreadyStructured.item as {
      updatedAt?: string;
    };
    assert.equal(alreadyItem.updatedAt, completeItem.updatedAt);
    assert.match(String(alreadyStructured.summary ?? ''), /already completed/i);

    const reopenResult = await completeHandler({
      id: todo.id,
      completed: false,
    });
    assert.equal(getStructured(reopenResult)?.ok, true);
  });

  it('deletes todos in bulk with filters', async () => {
    const { server, getHandler } = createToolHarness();
    registerDeleteTodos(server);

    await addTodos([
      { title: 'Keep Me', description: 'Test' },
      { title: 'Batch One', description: 'Test' },
      { title: 'Batch Two', description: 'Test' },
    ]);

    const deleteHandler = getHandler<{
      query: string;
      dryRun?: boolean;
      limit?: number;
    }>('delete_todos');

    const dryRunResult = await deleteHandler({ query: 'Batch', dryRun: true });
    const dryRunStructured = getStructured(dryRunResult)?.result as Record<
      string,
      unknown
    >;
    assert.equal(dryRunStructured.dryRun, true);

    const liveResult = await deleteHandler({ query: 'Batch', limit: 1 });
    const liveStructured = getStructured(liveResult)?.result as Record<
      string,
      unknown
    >;
    assert.equal((liveStructured.deletedIds as unknown[]).length, 1);

    const remaining = await getTodos();
    const remainingTitles = remaining.map((item) => item.title);
    assert.equal(remainingTitles.includes('Keep Me'), true);
    assert.equal(
      remainingTitles.filter((title) => title.startsWith('Batch')).length,
      1
    );
  });

  it('supports delete dry-run on ambiguous matches', async () => {
    const { server, getHandler } = createToolHarness();
    registerDeleteTodo(server);

    await addTodos([
      { title: 'Shared Item', description: 'Test' },
      { title: 'Shared Item Two', description: 'Test' },
    ]);

    const deleteHandler = getHandler<{ query: string; dryRun: boolean }>(
      'delete_todo'
    );
    const result = await deleteHandler({ query: 'Shared', dryRun: true });

    const structured = getStructured(result);
    assert.equal(structured?.ok, true);
    assert.equal(structured?.result?.dryRun, true);
  });

  it('handles delete dry-run for single match and ambiguous errors', async () => {
    const { server, getHandler } = createToolHarness();
    registerDeleteTodo(server);

    const [todo] = await addTodos([
      { title: 'Unique Delete' },
      { title: 'Batch Delete One' },
      { title: 'Batch Delete Two' },
    ]);
    assert.ok(todo);

    const deleteHandler = getHandler<{
      id?: string;
      query?: string;
      dryRun?: boolean;
    }>('delete_todo');

    const dryRunResult = await deleteHandler({ id: todo.id, dryRun: true });
    assert.equal(getStructured(dryRunResult)?.result?.dryRun, true);

    const ambiguousResult = await deleteHandler({
      query: 'Batch',
      dryRun: false,
    });
    assert.equal(getStructured(ambiguousResult)?.ok, false);
  });
});
