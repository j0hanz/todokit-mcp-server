import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type {
  ServerNotification,
  ServerRequest,
} from '@modelcontextprotocol/sdk/types.js';

import { addTodos } from '../src/storage.js';
import { registerAllTools } from '../src/tools.js';
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

function createToolHarness() {
  const tools = new Map<string, { config: unknown; handler: unknown }>();
  const server = {
    registerTool(name: string, config: unknown, handler: unknown) {
      tools.set(name, { config, handler });
      return {} as unknown;
    },
  } as McpServer;

  const getHandler = <T>(name: string): ToolHandler<T> => {
    const tool = tools.get(name);
    if (!tool) {
      throw new Error(`Missing handler for ${name}`);
    }

    return (async (input: T) => {
      return (
        tool.handler as (
          value: unknown,
          extra?: unknown
        ) => Promise<CallToolResult>
      )(input, createRequestExtra());
    }) as ToolHandler<T>;
  };

  return { server, getHandler };
}

function getStructured(result: CallToolResult) {
  return (result as StructuredResult).structuredContent;
}

describe('search_todos', { timeout: TEST_TIMEOUT_MS }, () => {
  it('finds items by description', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    await addTodos([
      { description: 'Buy milk', priority: 'high', category: 'personal' },
      { description: 'Walk dog', priority: 'medium', category: 'personal' },
      { description: 'Write code', priority: 'high', category: 'work' },
    ]);

    const searchHandler = getHandler<{ query: string }>('search_todos');
    const result = await searchHandler({ query: 'milk' });

    const structured = getStructured(result);
    assert.equal(structured?.ok, true);

    const items = (structured?.result as any).items as any[];
    assert.equal(items.length, 1);
    assert.equal(items[0].description, 'Buy milk');
  });

  it('finds items by category', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    await addTodos([
      { description: 'Buy milk', priority: 'high', category: 'personal' },
      { description: 'Write code', priority: 'high', category: 'work' },
    ]);

    const searchHandler = getHandler<{ query: string }>('search_todos');
    const result = await searchHandler({ query: 'work' });

    const structured = getStructured(result);
    const items = (structured?.result as any).items as any[];
    assert.equal(items.length, 1);
    assert.equal(items[0].category, 'work');
  });

  it('returns empty list for no matches', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    await addTodos([
      { description: 'Buy milk', priority: 'high', category: 'personal' },
    ]);

    const searchHandler = getHandler<{ query: string }>('search_todos');
    const result = await searchHandler({ query: 'astronaut' });

    const structured = getStructured(result);
    const items = (structured?.result as any).items as any[];
    assert.equal(items.length, 0);
  });

  it('matches case-insensitively', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    await addTodos([
      {
        description: 'Prepare Release Notes',
        priority: 'high',
        category: 'work',
      },
    ]);

    const searchHandler = getHandler<{ query: string }>('search_todos');
    const result = await searchHandler({ query: 'release notes' });

    const structured = getStructured(result);
    const items = (structured?.result as any).items as any[];
    assert.equal(items.length, 1);
    assert.equal(items[0].description, 'Prepare Release Notes');
  });

  it('matches Unicode text with accent-insensitive search', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    await addTodos([
      {
        description: 'Plan café launch',
        priority: 'medium',
        category: 'réunions',
      },
    ]);

    const searchHandler = getHandler<{ query: string }>('search_todos');
    const result = await searchHandler({ query: 'reunions' });

    const structured = getStructured(result);
    const items = (structured?.result as any).items as any[];
    assert.equal(items.length, 1);
    assert.equal(items[0].category, 'réunions');
  });

  it('supports status filtering and cursor pagination', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    const [one, two, three] = await addTodos([
      { description: 'Task alpha', priority: 'high', category: 'work' },
      { description: 'Task beta', priority: 'high', category: 'work' },
      { description: 'Task gamma', priority: 'high', category: 'work' },
    ]);
    assert.ok(one);
    assert.ok(two);
    assert.ok(three);

    const completeHandler = getHandler<{ id: string }>('complete_todo');
    await completeHandler({ id: two.id });

    const searchHandler = getHandler<{
      query: string;
      status?: 'pending' | 'completed' | 'all';
      limit?: number;
      cursor?: string;
    }>('search_todos');

    const pendingResult = await searchHandler({ query: 'Task' });
    const pendingStructured = getStructured(pendingResult)?.result as any;
    assert.equal(pendingStructured.totalMatches, 2);
    assert.equal(pendingStructured.status, 'pending');

    const page1 = await searchHandler({
      query: 'Task',
      status: 'all',
      limit: 2,
    });
    const page1Structured = getStructured(page1)?.result as any;
    assert.equal(page1Structured.returned, 2);
    assert.equal(page1Structured.hasMore, true);
    assert.equal(typeof page1Structured.nextCursor, 'string');

    const page2 = await searchHandler({
      query: 'Task',
      status: 'all',
      limit: 2,
      cursor: page1Structured.nextCursor as string,
    });
    const page2Structured = getStructured(page2)?.result as any;
    assert.equal(page2Structured.returned, 1);
    assert.equal(page2Structured.hasMore, false);
  });

  it('returns invalid params for mismatched cursor context', async () => {
    const { server, getHandler } = createToolHarness();
    registerAllTools(server);

    await addTodos([
      { description: 'Cursor target', priority: 'medium', category: 'work' },
      { description: 'Cursor other', priority: 'medium', category: 'work' },
    ]);

    const searchHandler = getHandler<{
      query: string;
      status?: 'pending' | 'completed' | 'all';
      limit?: number;
      cursor?: string;
    }>('search_todos');

    const first = await searchHandler({
      query: 'Cursor',
      status: 'all',
      limit: 1,
    });
    const firstStructured = getStructured(first)?.result as any;
    const cursor = firstStructured.nextCursor as string;
    assert.equal(typeof cursor, 'string');

    const mismatched = await searchHandler({
      query: 'target',
      status: 'all',
      cursor,
    });
    const mismatchedStructured = getStructured(mismatched);
    assert.equal(mismatchedStructured?.ok, false);
    assert.equal(mismatchedStructured?.error?.code, 'E_INVALID_PARAMS');
  });
});
