#!/usr/bin/env node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerAllTools } from './tools/index.js';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version?: string };
const SERVER_VERSION = packageJson.version ?? '0.0.0';

let shuttingDown = false;
let activeServer: McpServer | null = null;

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
  if (shuttingDown) {
    return;
  }
  if (!activeServer) {
    process.exitCode = 0;
    return;
  }
  shuttingDown = true;
  try {
    await activeServer.close();
  } catch (error: unknown) {
    console.error(`Shutdown error (${signal}):`, error);
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

export async function startServer(): Promise<void> {
  activeServer = createServer();
  const transport = new StdioServerTransport();
  await activeServer.connect(transport);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  startServer().catch((error: unknown) => {
    console.error('Server error:', error);
    process.exitCode = 1;
  });
}
