import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  nowMs,
  publishToolCall,
  publishToolResult,
} from '../lib/diagnostics.js';
import { registerAddTodo } from './add_todo.js';
import { registerAddTodos } from './add_todos.js';
import { registerCompleteTodo } from './complete_todo.js';
import { registerDeleteTodo } from './delete_todo.js';
import { registerDeleteTodos } from './delete_todos.js';
import { registerListTodos } from './list_todos.js';
import { registerUpdateTodo } from './update_todo.js';

type ToolHandler = (input: unknown) => Promise<CallToolResult>;

const WRAP_FLAG_KEY = '__todokitRegisterToolWrapped';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getStructuredContent(result: CallToolResult): unknown {
  return (result as unknown as { structuredContent?: unknown })
    .structuredContent;
}

function getOkFlag(structured: unknown): boolean | undefined {
  if (!isRecord(structured)) return undefined;
  const ok = structured.ok;
  return typeof ok === 'boolean' ? ok : undefined;
}

function getErrorCode(structured: unknown): string | undefined {
  if (!isRecord(structured)) return undefined;
  const error = structured.error;
  if (!isRecord(error)) return undefined;
  const code = error.code;
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

function createWrappedHandler(tool: string, handler: ToolHandler): ToolHandler {
  return async (input: unknown) => {
    publishToolCall(tool, input);
    const start = nowMs();

    try {
      const result = await handler(input);
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
      return result;
    } catch (error) {
      const durationMs = Math.max(0, nowMs() - start);
      publishToolResult({
        v: 1,
        kind: 'tool_result',
        tool,
        at: new Date().toISOString(),
        durationMs,
        ok: false,
      });
      throw error;
    }
  };
}

function wrapRegisterTool(server: McpServer): void {
  const flags = server as unknown as Record<string, unknown>;
  if (flags[WRAP_FLAG_KEY] === true) return;
  flags[WRAP_FLAG_KEY] = true;

  const original = (
    server.registerTool as unknown as (
      name: string,
      config: unknown,
      handler: unknown
    ) => unknown
  ).bind(server);

  (
    server as unknown as {
      registerTool: (
        name: string,
        config: unknown,
        handler: unknown
      ) => unknown;
    }
  ).registerTool = (name, config, handler) => {
    if (typeof handler !== 'function') {
      return original(name, config, handler);
    }

    const toolHandler = handler as unknown as ToolHandler;
    return original(name, config, createWrappedHandler(name, toolHandler));
  };
}

export function registerAllTools(server: McpServer): void {
  wrapRegisterTool(server);
  registerAddTodo(server);
  registerAddTodos(server);
  registerListTodos(server);
  registerUpdateTodo(server);
  registerCompleteTodo(server);
  registerDeleteTodo(server);
  registerDeleteTodos(server);
}
