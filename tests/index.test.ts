import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createServer } from '../src/index.js';

describe('index entrypoint', () => {
  it('creates a server instance', async () => {
    const server = createServer();
    assert.ok(server instanceof McpServer);
    await server.close();
  });

  it('maps SDK tool errors to structured error codes when possible', async () => {
    const server = createServer();
    try {
      const target = server as unknown as {
        createToolError?: (message: string) => unknown;
      };
      assert.equal(typeof target.createToolError, 'function');

      const result = target.createToolError?.('Input validation error: boom');
      assert.ok(result && typeof result === 'object');

      const structured = (result as { structuredContent?: unknown })
        .structuredContent;
      assert.ok(structured && typeof structured === 'object');

      const error = (structured as { error?: unknown }).error;
      assert.ok(error && typeof error === 'object');

      const code = (error as { code?: unknown }).code;
      assert.equal(code, 'E_INVALID_PARAMS');
    } finally {
      await server.close();
    }
  });
});
