import assert from 'node:assert/strict';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { describe, it } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { registerAllTools } from '../src/tools.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

type ToolHandler<T> = (input: T) => Promise<CallToolResult>;

type StructuredResult = {
  structuredContent?: {
    ok?: boolean;
    error?: { code?: string };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

describe('diagnostics', { timeout: TEST_TIMEOUT_MS }, () => {
  it('publishes tool and storage events via registerTool wrapper', async () => {
    const toolEvents: unknown[] = [];
    const storageEvents: unknown[] = [];

    const onTool = (message: unknown): void => {
      toolEvents.push(message);
    };
    const onStorage = (message: unknown): void => {
      storageEvents.push(message);
    };

    subscribe('todokit:tool', onTool);
    subscribe('todokit:storage', onStorage);

    try {
      const { server, getHandler } = createToolHarness();
      registerAllTools(server);

      const addHandler = getHandler<{ description: string }>('add_todo');
      const addResult = await addHandler({ description: 'Diag Task' });
      assert.equal((addResult as StructuredResult).structuredContent?.ok, true);

      const callEvent = toolEvents.find((event) => {
        if (!isRecord(event)) return false;
        return event.kind === 'tool_call' && event.tool === 'add_todo';
      });
      assert.ok(callEvent);
      assert.equal(isRecord(callEvent) && typeof callEvent.requestId, 'string');

      const resultEvent = toolEvents.find((event) => {
        if (!isRecord(event)) return false;
        return event.kind === 'tool_result' && event.tool === 'add_todo';
      });
      assert.ok(resultEvent);

      const callId =
        isRecord(callEvent) && typeof callEvent.requestId === 'string'
          ? callEvent.requestId
          : null;
      const resultId =
        isRecord(resultEvent) && typeof resultEvent.requestId === 'string'
          ? resultEvent.requestId
          : null;

      assert.equal(callId !== null, true);
      assert.equal(resultId, callId);

      assert.ok(
        storageEvents.some((event) => {
          if (!isRecord(event)) return false;
          return event.kind === 'storage';
        })
      );

      assert.ok(
        storageEvents.some((event) => {
          if (!isRecord(event)) return false;
          return (
            event.kind === 'storage' &&
            event.requestId === callId &&
            event.tool === 'add_todo'
          );
        })
      );
    } finally {
      unsubscribe('todokit:tool', onTool);
      unsubscribe('todokit:storage', onStorage);
    }
  });
});
