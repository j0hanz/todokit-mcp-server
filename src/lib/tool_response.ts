import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function createToolResponse<T extends Record<string, unknown>>(
  structuredContent: T
): CallToolResult & { structuredContent: T } {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}
