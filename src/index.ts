#!/usr/bin/env node
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import packageJson from '../package.json' with { type: 'json' };
import { parseCliArgs } from './lib/cli.js';
import { closeDb } from './lib/db.js';
import {
  enableDefaultDiagnosticsSubscribers,
  publishLifecycleEvent,
} from './lib/diagnostics.js';
import { createStderrLogger } from './lib/log.js';
import { registerAllTools } from './tools/index.js';

const SERVER_VERSION =
  typeof packageJson.version === 'string' && packageJson.version.length > 0
    ? packageJson.version
    : '0.0.0';

let shuttingDown = false;
let activeServer: McpServer | null = null;
let disableDiagnostics: (() => void) | null = null;

async function closeDbSafely(): Promise<void> {
  try {
    await closeDb();
  } catch (error: unknown) {
    console.error('Error closing database:', error);
  }
}

function disableDiagnosticsSafely(): void {
  try {
    disableDiagnostics?.();
  } catch {
    // Ignore.
  } finally {
    disableDiagnostics = null;
  }
}

async function closeServerSafely(signal: NodeJS.Signals): Promise<void> {
  if (!activeServer) {
    process.exitCode = 0;
    return;
  }

  try {
    await activeServer.close();
    process.exitCode = 0;
  } catch (error: unknown) {
    console.error(`Shutdown error (${signal}):`, error);
    process.exitCode = 1;
  }
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'todokit', version: SERVER_VERSION },
    {
      instructions: 'Todokit to-do list manager',
      capabilities: { logging: {} },
    }
  );

  registerAllTools(server);
  return server;
}

export async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  publishLifecycleEvent({
    v: 1,
    kind: 'lifecycle',
    event: 'shutdown',
    at: new Date().toISOString(),
    signal,
  });

  await closeDbSafely();
  disableDiagnosticsSafely();
  await closeServerSafely(signal);
}

export async function startServer(): Promise<void> {
  activeServer = createServer();
  const transport = new StdioServerTransport();
  await activeServer.connect(transport);
}

process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled rejection:', reason);
  process.exitCode = 1;
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error);
  process.exitCode = 1;
});

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  const cli = parseCliArgs(process.argv);
  if (cli.todoFile) {
    process.env.TODOKIT_TODO_FILE = cli.todoFile;
  }

  if (cli.diagnostics) {
    const logger = createStderrLogger(cli.logLevel);
    disableDiagnostics = enableDefaultDiagnosticsSubscribers({
      logger: (line: string): void => {
        logger.debug(line);
      },
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  startServer().catch((error: unknown) => {
    console.error('Server error:', error);
    process.exitCode = 1;
  });
}
