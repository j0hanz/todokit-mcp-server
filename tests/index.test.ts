import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createServer } from '../src/index.js';

describe('index entrypoint', () => {
  it('creates a server instance', async () => {
    const server = createServer();
    assert.ok(server instanceof McpServer);

    const internals = server as unknown as {
      _registeredResources?: Record<string, unknown> | undefined;
      _registeredResourceTemplates?: Record<string, unknown> | undefined;
      _registeredPrompts?: Record<string, unknown> | undefined;
    };

    assert.equal(
      Object.keys(internals._registeredResources ?? {}).includes(
        'internal://instructions'
      ),
      true
    );
    assert.equal(
      Object.keys(internals._registeredResources ?? {}).includes('todo://list'),
      true
    );
    assert.equal(
      Object.keys(internals._registeredResourceTemplates ?? {}).length,
      0
    );
    assert.equal(
      Object.keys(internals._registeredPrompts ?? {}).includes('get-help'),
      true
    );

    await server.close();
  });
});
