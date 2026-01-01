import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerAllTools } from './tools/index.js';

const server = new McpServer(
  { name: 'todokit', version: '1.0.0' },
  {
    instructions: 'Todokit to-do list manager',
    capabilities: { logging: {} },
  }
);

registerAllTools(server);

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  try {
    await server.close();
  } catch (error: unknown) {
    console.error(`Shutdown error (${signal}):`, error);
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  console.error('Server error:', error);
  process.exit(1);
});
