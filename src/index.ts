import { pathToFileURL } from 'node:url';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerAllTools } from './tools/index.js';

let shuttingDown = false;
let activeServer: McpServer | null = null;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'todokit', version: '1.0.0' },
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

function isEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isEntrypoint()) {
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  startServer().catch((error: unknown) => {
    console.error('Server error:', error);
    process.exitCode = 1;
  });
}
