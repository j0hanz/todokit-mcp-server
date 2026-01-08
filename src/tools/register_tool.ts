import type {
  McpServer,
  ToolCallback,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  AnySchema,
  SchemaOutput,
} from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {
  CallToolResult,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';

import {
  nowMs,
  publishToolCall,
  publishToolResult,
} from '../lib/diagnostics.js';

interface ToolConfig<
  InputArgs extends AnySchema,
  OutputArgs extends AnySchema,
> {
  title?: string;
  description?: string;
  inputSchema: InputArgs;
  outputSchema?: OutputArgs;
  annotations?: ToolAnnotations;
  _meta?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStructuredContent(result: CallToolResult): unknown {
  return result.structuredContent;
}

function getOkFlag(structured: unknown): boolean | undefined {
  if (!isRecord(structured)) return undefined;
  const { ok } = structured;
  return typeof ok === 'boolean' ? ok : undefined;
}

function getErrorCode(structured: unknown): string | undefined {
  if (!isRecord(structured)) return undefined;
  const { error } = structured;
  if (!isRecord(error)) return undefined;
  const { code } = error;
  return typeof code === 'string' ? code : undefined;
}

function extractOutcome(result: CallToolResult): {
  ok: boolean;
  errorCode?: string | undefined;
} {
  const structured = getStructuredContent(result);
  const ok = getOkFlag(structured);
  if (ok !== false) return { ok: true };
  return { ok: false, errorCode: getErrorCode(structured) };
}

function publishSuccess(
  tool: string,
  start: number,
  result: CallToolResult
): void {
  const durationMs = Math.max(0, nowMs() - start);
  const outcome = extractOutcome(result);
  publishToolResult({
    v: 1,
    kind: 'tool_result',
    tool,
    at: new Date().toISOString(),
    durationMs,
    ok: outcome.ok,
    errorCode: outcome.errorCode,
  });
}

function publishFailure(tool: string, start: number): void {
  publishToolResult({
    v: 1,
    kind: 'tool_result',
    tool,
    at: new Date().toISOString(),
    durationMs: Math.max(0, nowMs() - start),
    ok: false,
  });
}

type ToolInput<InputArgs extends AnySchema> = SchemaOutput<InputArgs>;

function createWrappedHandler<InputArgs extends AnySchema>(
  tool: string,
  handler: ToolCallback<InputArgs>
): ToolCallback<InputArgs> {
  const wrapped = (
    input: ToolInput<InputArgs>,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): Promise<CallToolResult> => {
    publishToolCall(tool, input);
    const start = nowMs();
    const result = handler(input, extra);
    return Promise.resolve(result)
      .then((resolved) => {
        publishSuccess(tool, start, resolved);
        return resolved;
      })
      .catch((error: unknown) => {
        publishFailure(tool, start);
        throw error;
      });
  };
  return wrapped as ToolCallback<InputArgs>;
}

export function registerToolWithDiagnostics<
  OutputArgs extends AnySchema,
  InputArgs extends AnySchema,
>(
  server: McpServer,
  name: string,
  config: ToolConfig<InputArgs, OutputArgs>,
  handler: ToolCallback<InputArgs>
): ReturnType<McpServer['registerTool']> {
  return server.registerTool(name, config, createWrappedHandler(name, handler));
}
