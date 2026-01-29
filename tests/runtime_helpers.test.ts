import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  closeDbSafely,
  closeServerSafely,
  disableDiagnosticsSafely,
} from '../src/index.js';

describe('runtime helpers', () => {
  it('closes database safely without throwing', async () => {
    await closeDbSafely();
  });

  it('disables diagnostics safely and always returns null', () => {
    let called = 0;
    const disposer = (): void => {
      called += 1;
    };
    assert.equal(disableDiagnosticsSafely(disposer), null);
    assert.equal(called, 1);

    assert.equal(
      disableDiagnosticsSafely(() => {
        throw new Error('boom');
      }),
      null
    );
  });

  it('handles server shutdown paths', async () => {
    const previousExitCode = process.exitCode;

    try {
      await closeServerSafely(null, 'SIGTERM');
      assert.equal(process.exitCode, 0);

      let closed = false;
      const server = {
        close: async () => {
          closed = true;
        },
      } as McpServer;

      await closeServerSafely(server, 'SIGTERM');
      assert.equal(closed, true);
      assert.equal(process.exitCode, 0);

      const failingServer = {
        close: async () => {
          throw new Error('fail');
        },
      } as unknown as McpServer;
      const originalError = console.error;
      console.error = () => undefined;
      try {
        await closeServerSafely(failingServer, 'SIGTERM');
      } finally {
        console.error = originalError;
      }
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
