import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { closeDb } from './db.js';

export async function closeDbSafely(): Promise<void> {
  try {
    await closeDb();
  } catch (error: unknown) {
    console.error('Error closing database:', error);
  }
}

export function disableDiagnosticsSafely(disposer: (() => void) | null): null {
  try {
    disposer?.();
  } catch {
    // Ignore.
  }
  return null;
}

export async function closeServerSafely(
  server: McpServer | null,
  signal: NodeJS.Signals
): Promise<void> {
  if (!server) {
    process.exitCode = 0;
    return;
  }

  try {
    await server.close();
    process.exitCode = 0;
  } catch (error: unknown) {
    console.error(`Shutdown error (${signal}):`, error);
    process.exitCode = 1;
  }
}
