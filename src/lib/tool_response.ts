import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

interface ToolResponse<
  T extends Record<string, unknown>,
> extends CallToolResult {
  structuredContent: T;
}

export function createToolResponse<T extends Record<string, unknown>>(
  structuredContent: T
): ToolResponse<T> {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}
