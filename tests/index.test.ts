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
});
