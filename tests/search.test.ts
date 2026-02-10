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
});
