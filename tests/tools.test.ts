import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { addTodos, getTodos } from '../src/storage.js';
import { registerAllTools } from '../src/tools.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

const DEFAULT_PRIORITY = 'medium' as const;
const DEFAULT_CATEGORY = 'work' as const;

type ToolHandler<T> = (input: T) => Promise<CallToolResult>;

type StructuredResult = {
  structuredContent?: {
    ok?: boolean;
    result?: Record<string, unknown>;
    error?: { code?: string };
  };
};

function createRequestExtra(): RequestHandlerExtra<
  ServerRequest,
  ServerNotification
> {
  const sendNotification: RequestHandlerExtra<
    ServerRequest,
    ServerNotification
  >['sendNotification'] = async () => undefined;
  const sendRequest: RequestHandlerExtra<
    ServerRequest,
    ServerNotification
  >['sendRequest'] = async () => {
    throw new Error('sendRequest is not supported in tests');
  };

  return {
    signal: new AbortController().signal,
    requestId: 'test-request',
    sendNotification,
    sendRequest,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createToolHarness() {
  const tools = new Map<string, { config: unknown; handler: unknown }>();
  const server = {
    registerTool(name: string, config: unknown, handler: unknown) {
      tools.set(name, { config, handler });
      return {} as unknown;
    },
  } as McpServer;

  const getConfig = (name: string): unknown => {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error(`Missing handler for ${name}`);
    }
    return tool.config;
  };

  const getHandler = <T>(name: string): ToolHandler<T> => {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error(`Missing handler for ${name}`);
    }

    return (async (input: T) => {
      if (isRecord(tool.config) && 'inputSchema' in tool.config) {
        const schema = (tool.config as { inputSchema?: unknown }).inputSchema;
        if (
          schema &&
          typeof (schema as { safeParse?: unknown }).safeParse === 'function'
        ) {
          const parsed = (
            schema as {
              safeParse: (value: unknown) => {
                success: boolean;
                data?: unknown;
                error?: unknown;
              };
            }
          ).safeParse(input);
          if (!parsed.success) {
            throw new Error('Input validation error');
          }
          return (
            tool.handler as (
              value: unknown,
              extra?: unknown
            ) => Promise<CallToolResult>
          )(parsed.data, createRequestExtra());
        }
      }

      return (
        tool.handler as (
          value: unknown,
          extra?: unknown
        ) => Promise<CallToolResult>
      )(input, createRequestExtra());
    }) as ToolHandler<T>;
  };

  return { server, getHandler, getConfig };
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
      'search_todos',
      'update_todo',
      'complete_todo',
      'delete_todo',
    ];
    names.forEach((name) => {
      assert.doesNotThrow(() => getHandler(name));
    });
  });

  it('adds single and batch todos', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    const addHandler = getHandler<{
      description: string;
      priority: typeof DEFAULT_PRIORITY;
      category: typeof DEFAULT_CATEGORY;
    }>('add_todo');
    const batchHandler = getHandler<{
      items: {
        description: string;
        priority: typeof DEFAULT_PRIORITY;
        category: typeof DEFAULT_CATEGORY;
      }[];
    }>('add_todos');

    const addResult = await addHandler({
      description: 'Task A',
      priority: DEFAULT_PRIORITY,
      category: DEFAULT_CATEGORY,
    });
    assert.equal(getStructured(addResult)?.ok, true);

    const batchResult = await batchHandler({
      items: [
        {
          description: 'Task B',
          priority: DEFAULT_PRIORITY,
          category: DEFAULT_CATEGORY,
        },
        {
          description: 'Task C',
          priority: DEFAULT_PRIORITY,
          category: DEFAULT_CATEGORY,
        },
      ],
    });
    assert.equal(getStructured(batchResult)?.ok, true);

    const todos = await getTodos();
    assert.equal(todos.length, 3);
  });

  it('lists todos with counts', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    const [alpha, beta] = await addTodos([
      {
        description: 'Alpha task',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Beta task',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);
    assert.ok(alpha);
    assert.ok(beta);

    const listHandler = getHandler<Record<string, never>>('list_todos');
    const result = await listHandler({});
    const structured = getStructured(result)?.result as Record<string, unknown>;

    assert.deepEqual(structured.counts, {
      total: 2,
      pending: 2,
      completed: 0,
    });
    const descriptions = (structured.items as { description: string }[]).map(
      (item) => item.description
    );
    assert.deepEqual(descriptions, ['Alpha task', 'Beta task']);
  });

  it('lists all todos when no filter specified', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    const [first, second, third] = await addTodos([
      {
        description: 'First task',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Second task',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Third task',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);
    assert.ok(first);
    assert.ok(second);
    assert.ok(third);

    const listHandler = getHandler<Record<string, never>>('list_todos');
    const result = await listHandler({});
    const structured = getStructured(result)?.result as Record<string, unknown>;
    const descriptions = (structured.items as { description: string }[]).map(
      (item) => item.description
    );
    assert.equal(descriptions.length, 3);
    assert.deepEqual(structured.counts, {
      total: 3,
      pending: 3,
      completed: 0,
    });
  });

  it('lists empty results with summary', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

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

  it('paginates list_todos with cursor and limit', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    await addTodos([
      {
        description: 'Page item 1',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Page item 2',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Page item 3',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);

    const listHandler = getHandler<{
      status?: 'pending' | 'completed' | 'all';
      limit?: number;
      cursor?: string;
    }>('list_todos');

    const page1 = await listHandler({ limit: 2 });
    const page1Result = getStructured(page1)?.result as Record<string, unknown>;
    const page1Items = page1Result.items as { description: string }[];
    const nextCursor = page1Result.nextCursor as string | undefined;

    assert.equal(page1Items.length, 2);
    assert.equal(page1Result.hasMore, true);
    assert.equal(typeof nextCursor, 'string');

    const page2 = await listHandler({ limit: 2, cursor: nextCursor });
    const page2Result = getStructured(page2)?.result as Record<string, unknown>;
    const page2Items = page2Result.items as { description: string }[];

    assert.equal(page2Items.length, 1);
    assert.equal(page2Result.hasMore, false);
    assert.equal(page2Result.nextCursor, undefined);
  });

  it('filters by completed status', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    const [pending, completed] = await addTodos([
      {
        description: 'Pending task',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Completed task',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
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
    registerAllTools(server);

    const [todo, extra] = await addTodos([
      {
        description: 'Manage this task',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Keep pending to avoid auto-delete',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);
    assert.ok(todo);
    assert.ok(extra);

    const updateHandler = getHandler<{
      id: string;
      description?: string;
    }>('update_todo');
    const updateResult = await updateHandler({
      id: todo.id,
      description: 'Updated description',
    });
    assert.equal(getStructured(updateResult)?.ok, true);

    const completeHandler = getHandler<{ id: string }>('complete_todo');
    const completeResult = await completeHandler({ id: todo.id });
    assert.equal(getStructured(completeResult)?.ok, true);

    const deleteHandler = getHandler<{ id: string }>('delete_todo');
    const deleteResult = await deleteHandler({ id: todo.id });
    assert.equal(getStructured(deleteResult)?.ok, true);
  });

  it('handles update no-updates errors', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    const [todo] = await addTodos([
      {
        description: 'Has description',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);
    assert.ok(todo);

    const updateHandler = getHandler<{
      id: string;
      description?: string;
    }>('update_todo');

    const noUpdates = await updateHandler({ id: todo.id });
    const structured = getStructured(noUpdates);
    assert.equal(structured?.error?.code, 'E_BAD_REQUEST');
  });

  it('completes todo and handles already completed state', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    const [todo, extra] = await addTodos([
      {
        description: 'Finish this task',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Keep pending to avoid auto-delete',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);
    assert.ok(todo);
    assert.ok(extra);
    const completeHandler = getHandler<{ id: string }>('complete_todo');

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
  });

  it('delete_todo requires exact id', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    const [todo1, todo2] = await addTodos([
      {
        description: 'Item one',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Item two',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);
    assert.ok(todo1);
    assert.ok(todo2);

    const deleteHandler = getHandler<{ id: string }>('delete_todo');

    // Delete by exact id works
    const result = await deleteHandler({ id: todo1.id });
    const structured = getStructured(result);
    assert.equal(structured?.ok, true);

    // Check only one item remains
    const remaining = await getTodos();
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.id, todo2.id);
  });

  it('delete_todo returns error for non-existent id', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    await addTodos([
      {
        description: 'Some item',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);

    const deleteHandler = getHandler<{ id: string }>('delete_todo');
    const result = await deleteHandler({ id: 'non-existent-id' });

    const structured = getStructured(result);
    assert.equal(structured?.ok, false);
  });

  it('delete_todo is not marked idempotent', () => {
    const { server, getConfig } = createToolHarness();
    registerAllTools(server);

    const config = getConfig('delete_todo');
    assert.equal(
      isRecord(config) &&
        isRecord(config.annotations) &&
        config.annotations.idempotentHint,
      false
    );
  });

  it('invokes onTodosChanged callback for mutating operations', async () => {
    const { server, getHandler } = createToolHarness();
    let notifications = 0;
    registerAllTools(server, undefined, async () => {
      notifications += 1;
    });

    const addHandler = getHandler<{
      description: string;
      priority: typeof DEFAULT_PRIORITY;
      category: typeof DEFAULT_CATEGORY;
    }>('add_todo');
    const addResult = await addHandler({
      description: 'Notify test',
      priority: DEFAULT_PRIORITY,
      category: DEFAULT_CATEGORY,
    });
    const added = (getStructured(addResult)?.result as { item: { id: string } })
      .item;
    const guardResult = await addHandler({
      description: 'Keep one pending for notification assertions',
      priority: DEFAULT_PRIORITY,
      category: DEFAULT_CATEGORY,
    });
    assert.equal(getStructured(guardResult)?.ok, true);

    const updateHandler = getHandler<{
      id: string;
      description?: string;
    }>('update_todo');
    await updateHandler({ id: added.id, description: 'Notify updated' });

    const completeHandler = getHandler<{ id: string }>('complete_todo');
    await completeHandler({ id: added.id });

    const deleteHandler = getHandler<{ id: string }>('delete_todo');
    await deleteHandler({ id: added.id });

    assert.equal(notifications >= 5, true);
  });
});
