import {
  channel,
  type Channel,
  subscribe,
  unsubscribe,
} from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';

export interface ToolCallEvent {
  v: 1;
  kind: 'tool_call';
  tool: string;
  at: string;
  input: { type: string; keys?: string[]; size?: number };
}

export interface ToolResultEvent {
  v: 1;
  kind: 'tool_result';
  tool: string;
  at: string;
  durationMs: number;
  ok: boolean;
  errorCode?: string | undefined;
}

export interface StorageEvent {
  v: 1;
  kind: 'storage';
  op: 'read' | 'write' | 'close';
  at: string;
  durationMs?: number | undefined;
  cacheHit?: boolean | undefined;
  todoCount?: number | undefined;
  renameRetries?: number | undefined;
}

export interface LifecycleEvent {
  v: 1;
  kind: 'lifecycle';
  event: 'shutdown';
  at: string;
  signal?: string | undefined;
}

const toolDiagnosticsChannel: Channel = channel('todokit:tool');
const storageDiagnosticsChannel: Channel = channel('todokit:storage');
const lifecycleDiagnosticsChannel: Channel = channel('todokit:lifecycle');

function safePublish(target: Channel, message: unknown): void {
  try {
    target.publish(message);
  } catch {
    // Diagnostics must never break tool execution.
  }
}

function summarizeInput(input: unknown): ToolCallEvent['input'] {
  if (Array.isArray(input)) {
    return { type: 'array', size: input.length };
  }
  if (typeof input === 'object' && input !== null) {
    const keys = Object.keys(input);
    return { type: 'object', keys: keys.slice(0, 10) };
  }
  return { type: typeof input };
}

export function nowMs(): number {
  return performance.now();
}

export function publishToolCall(tool: string, input: unknown): void {
  const event: ToolCallEvent = {
    v: 1,
    kind: 'tool_call',
    tool,
    at: new Date().toISOString(),
    input: summarizeInput(input),
  };
  safePublish(toolDiagnosticsChannel, event);
}

export function publishToolResult(event: ToolResultEvent): void {
  safePublish(toolDiagnosticsChannel, event);
}

export function publishStorageEvent(event: StorageEvent): void {
  safePublish(storageDiagnosticsChannel, event);
}

export function publishLifecycleEvent(event: LifecycleEvent): void {
  safePublish(lifecycleDiagnosticsChannel, event);
}

type Logger = (line: string) => void;

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ v: 1, kind: 'diagnostics_error' });
  }
}

function createDiagnosticsSubscriber(
  logger: Logger
): (message: unknown) => void {
  return (message: unknown): void => {
    try {
      logger(safeStringify(message));
    } catch {
      // Ignore.
    }
  };
}

export function enableDefaultDiagnosticsSubscribers(options?: {
  logger?: Logger | undefined;
}): () => void {
  const logger =
    options?.logger ??
    ((line: string): void => {
      console.error(line);
    });

  const onMessage = createDiagnosticsSubscriber(logger);

  subscribe('todokit:tool', onMessage);
  subscribe('todokit:storage', onMessage);
  subscribe('todokit:lifecycle', onMessage);

  return () => {
    unsubscribe('todokit:tool', onMessage);
    unsubscribe('todokit:storage', onMessage);
    unsubscribe('todokit:lifecycle', onMessage);
  };
}
