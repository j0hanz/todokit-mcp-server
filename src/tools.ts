import { randomUUID } from 'node:crypto';

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

import type { z } from 'zod';

import { TOOL_ABORT_ERROR_NAME, TOOL_TIMEOUT_ERROR_NAME } from './constants.js';
import {
  nowMs,
  publishToolCallWithId,
  publishToolResult,
} from './diagnostics.js';
import { runWithRequestContext } from './requestContext.js';
import {
  createErrorResponse,
  createToolResponse,
  getErrorMessage,
} from './responses.js';
import {
  AddTodoSchema,
  AddTodosSchema,
  CompleteTodoSchema,
  DefaultOutputSchema,
  DeleteTodoSchema,
  ListTodosFilterSchema,
  type Todo,
  UpdateTodoSchema,
} from './schema.js';
import {
  addTodos,
  completeTodoById,
  type CompleteTodoOutcome,
  deleteTodoById,
  getCodedErrorCode,
  getTodos,
  type TodoUpdate,
  updateTodoById,
} from './storage.js';

const DEFAULT_TOOL_TIMEOUT_MS = 60_000;

let isInitialized = (): boolean => true;

export function setInitializationGuard(fn: () => boolean): void {
  isInitialized = fn;
}

function parseToolTimeoutMs(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_TOOL_TIMEOUT_MS;

  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return DEFAULT_TOOL_TIMEOUT_MS;
  }

  if (value <= 0) return null;
  return value;
}

function getToolTimeoutMs(): number | null {
  return parseToolTimeoutMs(process.env.TODOKIT_TOOL_TIMEOUT_MS);
}

function isNotNullish<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

interface CancelableRace {
  promise: Promise<never>;
  cancel: () => void;
}

function createAbortPromise(
  signal: AbortSignal | undefined,
  onAbort?: () => void
): CancelableRace | null {
  if (!signal) return null;

  if (signal.aborted) {
    onAbort?.();
    const error = new Error('Tool cancelled');
    error.name = TOOL_ABORT_ERROR_NAME;
    return { promise: Promise.reject(error), cancel: () => undefined };
  }

  let listener: (() => void) | null = null;

  const promise = new Promise<never>((_, reject) => {
    listener = () => {
      onAbort?.();
      const error = new Error('Tool cancelled');
      error.name = TOOL_ABORT_ERROR_NAME;
      reject(error);
    };
    signal.addEventListener('abort', listener, { once: true });
  });

  return {
    promise,
    cancel: () => {
      if (listener) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}

function createTimeoutPromise(
  ms: number,
  message: string,
  onTimeout?: () => void
): CancelableRace {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout?.();
      const error = new Error(message);
      error.name = TOOL_TIMEOUT_ERROR_NAME;
      reject(error);
    }, ms);
  });

  return {
    promise,
    cancel: () => {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    },
  };
}

function classifyInterruption(error: unknown): 'cancelled' | 'timeout' | null {
  if (!(error instanceof Error)) return null;
  if (error.name === TOOL_ABORT_ERROR_NAME) return 'cancelled';
  if (error.name === TOOL_TIMEOUT_ERROR_NAME) return 'timeout';
  return null;
}

function mapExecutionError(
  error: unknown,
  fallbackCode: string
): { code: string; message: string } {
  const coded = getCodedErrorCode(error);
  if (coded) {
    return { code: coded, message: getErrorMessage(error) };
  }
  return { code: fallbackCode, message: getErrorMessage(error) };
}

function createExecutionErrorResponse(
  error: unknown,
  fallbackCode: string
): CallToolResult {
  const mapped = mapExecutionError(error, fallbackCode);
  return createErrorResponse(mapped.code, mapped.message);
}

interface ToolConfig<
  InputArgs extends AnySchema,
  OutputArgs extends AnySchema,
> {
  title?: string;
  description?: string;
  inputSchema: InputArgs;
  outputSchema?: OutputArgs;
  annotations?: ToolAnnotations;
  icons?: { src: string; mimeType: string; sizes?: string[] }[];
  _meta?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractOutcome(result: CallToolResult): {
  ok: boolean;
  errorCode?: string | undefined;
} {
  const structured = result.structuredContent;
  if (!isRecord(structured)) return { ok: true };

  const { ok, error } = structured;
  if (ok !== false) return { ok: true };

  if (!isRecord(error)) return { ok: false };

  const { code } = error;
  return { ok: false, errorCode: typeof code === 'string' ? code : undefined };
}

type ToolInput<InputArgs extends AnySchema> = SchemaOutput<InputArgs>;

function publishSuccessResult(
  tool: string,
  requestId: string,
  startedAt: number,
  resolved: CallToolResult
): void {
  const durationMs = Math.max(0, nowMs() - startedAt);
  const outcome = extractOutcome(resolved);

  publishToolResult({
    v: 1,
    kind: 'tool_result',
    tool,
    requestId,
    at: new Date().toISOString(),
    durationMs,
    ok: outcome.ok,
    errorCode: outcome.errorCode,
  });
}

function publishFailureResult(
  tool: string,
  requestId: string,
  startedAt: number
): void {
  publishToolResult({
    v: 1,
    kind: 'tool_result',
    tool,
    requestId,
    at: new Date().toISOString(),
    durationMs: Math.max(0, nowMs() - startedAt),
    ok: false,
  });
}

function createWrappedHandler<InputArgs extends AnySchema>(
  tool: string,
  handler: ToolCallback<InputArgs>
): ToolCallback<InputArgs> {
  return ((
    input: ToolInput<InputArgs>,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ) => {
    const requestId = randomUUID();
    publishToolCallWithId(tool, input, requestId);

    const startedAt = nowMs();

    if (!isInitialized()) {
      const response = createErrorResponse(
        'E_NOT_INITIALIZED',
        'Server not initialized'
      );
      publishSuccessResult(tool, requestId, startedAt, response);
      return Promise.resolve(response);
    }

    if (extra.signal.aborted) {
      const response = createErrorResponse('E_CANCELLED', 'Tool cancelled');
      publishSuccessResult(tool, requestId, startedAt, response);
      return Promise.resolve(response);
    }

    const controller = new AbortController();
    const propagateAbort = (): void => {
      if (!controller.signal.aborted) controller.abort();
    };

    let result: CallToolResult | Promise<CallToolResult>;
    try {
      result = runWithRequestContext({ requestId, tool }, () =>
        handler(input, { ...extra, signal: controller.signal })
      );
    } catch (error: unknown) {
      publishFailureResult(tool, requestId, startedAt);
      const rejection =
        error instanceof Error ? error : new Error(String(error));
      return Promise.reject(rejection);
    }

    const timeoutMs = getToolTimeoutMs();
    const timeout = timeoutMs
      ? createTimeoutPromise(
          timeoutMs,
          `Tool ${tool} timed out`,
          propagateAbort
        )
      : null;

    const abort = createAbortPromise(extra.signal, propagateAbort);

    const race = Promise.race(
      [Promise.resolve(result), timeout?.promise, abort?.promise].filter(
        isNotNullish
      )
    );

    return race
      .finally(() => {
        timeout?.cancel();
        abort?.cancel();
      })
      .then((resolved) => {
        publishSuccessResult(tool, requestId, startedAt, resolved);
        return resolved;
      })
      .catch((error: unknown) => {
        const interruption = classifyInterruption(error);

        if (interruption) {
          const code = interruption === 'timeout' ? 'E_TIMEOUT' : 'E_CANCELLED';
          const response = createErrorResponse(
            code,
            error instanceof Error ? error.message : String(error)
          );
          publishSuccessResult(tool, requestId, startedAt, response);
          return response;
        }

        publishFailureResult(tool, requestId, startedAt);
        return createExecutionErrorResponse(error, 'E_TOOL_ERROR');
      });
  }) as unknown as ToolCallback<InputArgs>;
}

function registerToolWithDiagnostics<
  InputArgs extends AnySchema,
  OutputArgs extends AnySchema,
>(
  server: McpServer,
  name: string,
  config: ToolConfig<InputArgs, OutputArgs>,
  handler: ToolCallback<InputArgs>
): ReturnType<McpServer['registerTool']> {
  return server.registerTool(name, config, createWrappedHandler(name, handler));
}

// ---------------------------
// Handler: Add Item
// ---------------------------

type AddTodoInput = z.infer<typeof AddTodoSchema>;

const ADD_TODO_ACTIONS = [
  'list_todos',
  'update_todo',
  'complete_todo',
] as const;
const ADD_TODOS_ACTIONS = ['list_todos', 'update_todo'] as const;

function requireSingleTodo(todos: Todo[]): Todo {
  const todo = todos[0];
  if (!todo) throw new Error('Failed to create todo');
  return todo;
}

function buildAddTodoResponse(todo: Todo): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      item: todo,
      summary: 'Added todo',
      nextActions: [...ADD_TODO_ACTIONS],
    },
  });
}

function buildAddTodosResponse(todos: Todo[]): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      count: todos.length,
      ids: todos.map((t) => t.id),
      summary: `Added ${String(todos.length)} todos`,
      nextActions: [...ADD_TODOS_ACTIONS],
    },
  });
}

const addTodoToolConfig: ToolConfig<
  typeof AddTodoSchema,
  typeof DefaultOutputSchema
> = {
  description:
    "Create a new task. Use this for single items. For multiple items, prefer 'add_todos' to save time. Note: the storage file is automatically deleted when all tasks are marked as completed.",
  inputSchema: AddTodoSchema,
  outputSchema: DefaultOutputSchema,
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
  },
};

async function handleAddTodo(
  input: AddTodoInput,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const { description, priority, category, dueAt } = input;

  try {
    const todos = await addTodos(
      [{ description, priority, category, dueAt }],
      extra.signal
    );
    return buildAddTodoResponse(requireSingleTodo(todos));
  } catch (error) {
    return createExecutionErrorResponse(error, 'E_ADD_TODO');
  }
}

function registerAddTodo(server: McpServer, serverIcon?: string): void {
  registerToolWithDiagnostics(
    server,
    'add_todo',
    {
      ...addTodoToolConfig,
      ...(serverIcon
        ? {
            icons: [
              { src: serverIcon, mimeType: 'image/svg+xml', sizes: ['any'] },
            ],
          }
        : {}),
    },
    handleAddTodo
  );
}

// ---------------------------
// add_todos
// ---------------------------

type AddTodosInput = z.infer<typeof AddTodosSchema>;

const addTodosToolConfig: ToolConfig<
  typeof AddTodosSchema,
  typeof DefaultOutputSchema
> = {
  title: 'Add Todos (Batch)',
  description:
    'Create multiple tasks in one call to save time. Note: the storage file is automatically deleted when all tasks are marked as completed.',
  inputSchema: AddTodosSchema,
  outputSchema: DefaultOutputSchema,
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
  },
};

async function handleAddTodos(
  input: AddTodosInput,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  try {
    const todos = await addTodos(input.items, extra.signal);
    return buildAddTodosResponse(todos);
  } catch (error) {
    return createExecutionErrorResponse(error, 'E_ADD_TODOS');
  }
}

function registerAddTodos(server: McpServer, serverIcon?: string): void {
  registerToolWithDiagnostics(
    server,
    'add_todos',
    {
      ...addTodosToolConfig,
      ...(serverIcon
        ? {
            icons: [
              { src: serverIcon, mimeType: 'image/svg+xml', sizes: ['any'] },
            ],
          }
        : {}),
    },
    handleAddTodos
  );
}

// ---------------------------
// list_todos
// ---------------------------

type ListTodosFilters = z.infer<typeof ListTodosFilterSchema>;
type ListTodoStatus = 'pending' | 'completed' | 'all';

interface CountSummary {
  total: number;
  completed: number;
  pending: number;
}

function buildSummary(counts: CountSummary): string {
  if (counts.total === 0) {
    return 'No todos found';
  }
  return `Found ${String(counts.total)} todos (${String(counts.pending)} pending, ${String(
    counts.completed
  )} completed)`;
}

function resolveStatus(status: ListTodosFilters['status']): ListTodoStatus {
  return status ?? 'pending';
}

function buildListHint(status: ListTodoStatus, remaining: number): string {
  if (remaining <= 0) {
    return 'Tip: when all todos are completed, the storage file is automatically deleted.';
  }
  if (status === 'all') {
    return `...and ${String(
      remaining
    )} more. Narrow the list by using status='pending' or status='completed', or operate by ID.`;
  }
  return `...and ${String(
    remaining
  )} more. Use status='all' to include completed items, or operate by ID.`;
}

function buildListResponse(params: {
  items: readonly Todo[];
  counts: CountSummary;
  filteredCounts: CountSummary;
  status: ListTodoStatus;
  returned: number;
  truncated: boolean;
  remaining: number;
  summary: string;
  hint: string;
}): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      items: params.items,
      summary: params.summary,
      counts: {
        total: params.counts.total,
        pending: params.counts.pending,
        completed: params.counts.completed,
      },
      filteredCounts: {
        total: params.filteredCounts.total,
        pending: params.filteredCounts.pending,
        completed: params.filteredCounts.completed,
      },
      status: params.status,
      returned: params.returned,
      truncated: params.truncated,
      remaining: params.remaining,
      hint: params.hint,
    },
  });
}

function shouldIncludeTodo(todo: Todo, status: ListTodoStatus): boolean {
  if (status === 'all') return true;
  if (status === 'completed') return todo.completed;
  return !todo.completed;
}

function countTodo(
  todo: Todo,
  counts: { total: number; completed: number }
): void {
  counts.total += 1;
  if (todo.completed) counts.completed += 1;
}

async function handleListTodos(
  filters: ListTodosFilters,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const allTodos = await getTodos(extra.signal);
  const status = resolveStatus(filters.status);

  const limit = 50;
  const items: Todo[] = [];

  const totalCounts = { total: 0, completed: 0 };
  const filteredCounts = { total: 0, completed: 0 };

  for (const todo of allTodos) {
    countTodo(todo, totalCounts);

    if (!shouldIncludeTodo(todo, status)) continue;

    countTodo(todo, filteredCounts);

    if (items.length < limit) {
      items.push(todo);
    }
  }

  const counts: CountSummary = {
    total: totalCounts.total,
    completed: totalCounts.completed,
    pending: totalCounts.total - totalCounts.completed,
  };

  const filtered: CountSummary = {
    total: filteredCounts.total,
    completed: filteredCounts.completed,
    pending: filteredCounts.total - filteredCounts.completed,
  };

  const truncated = filtered.total > items.length;
  const remaining = Math.max(0, filtered.total - items.length);

  let summary: string;
  if (filtered.total === 0) {
    summary = 'No todos found';
  } else if (truncated) {
    summary = `Showing ${String(items.length)} of ${String(filtered.total)} ${status} todos (${buildSummary(
      counts
    )})`;
  } else {
    summary = `Showing ${String(filtered.total)} ${status} todos (${buildSummary(counts)})`;
  }

  return buildListResponse({
    items,
    counts,
    filteredCounts: filtered,
    status,
    returned: items.length,
    truncated,
    remaining,
    summary,
    hint: buildListHint(status, remaining),
  });
}

function registerListTodos(server: McpServer, serverIcon?: string): void {
  registerToolWithDiagnostics(
    server,
    'list_todos',
    {
      title: 'List Todos',
      description:
        "List todos with an optional status filter. Default is status='pending' to keep responses short; use status='all' to include completed. Note: the storage file is automatically deleted when all tasks are marked as completed.",
      inputSchema: ListTodosFilterSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
      },
      ...(serverIcon
        ? {
            icons: [
              { src: serverIcon, mimeType: 'image/svg+xml', sizes: ['any'] },
            ],
          }
        : {}),
    },
    async (filters, extra) => {
      try {
        return await handleListTodos(filters, extra);
      } catch (error) {
        return createExecutionErrorResponse(error, 'E_LIST_TODOS');
      }
    }
  );
}

// ---------------------------
// Handler: Update Item
// ---------------------------

type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>;
type UpdateFields = TodoUpdate;

function buildUpdatePayload(input: UpdateTodoInput): UpdateFields | null {
  const updates: UpdateFields = {};

  if (input.description !== undefined) updates.description = input.description;
  if (input.priority !== undefined) updates.priority = input.priority;
  if (input.category !== undefined) updates.category = input.category;
  if (input.dueAt !== undefined) updates.dueAt = input.dueAt;

  return Object.keys(updates).length > 0 ? updates : null;
}

async function handleUpdateTodo(
  input: UpdateTodoInput,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const outcome = await updateTodoById(
    input.id,
    () => buildUpdatePayload(input),
    extra.signal
  );

  if (outcome.kind === 'error') {
    return outcome.response;
  }

  if (outcome.kind === 'no_updates') {
    return createErrorResponse('E_BAD_REQUEST', 'No fields provided to update');
  }

  return createToolResponse({
    ok: true,
    result: {
      item: outcome.todo,
      summary: 'Updated todo',
      nextActions: ['list_todos', 'complete_todo'],
    },
  });
}

function registerUpdateTodo(server: McpServer, serverIcon?: string): void {
  registerToolWithDiagnostics(
    server,
    'update_todo',
    {
      title: 'Update Todo',
      description: 'Update fields on a todo item',
      inputSchema: UpdateTodoSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
      },
      ...(serverIcon
        ? {
            icons: [
              { src: serverIcon, mimeType: 'image/svg+xml', sizes: ['any'] },
            ],
          }
        : {}),
    },
    async (input, extra) => {
      try {
        return await handleUpdateTodo(input, extra);
      } catch (error) {
        return createExecutionErrorResponse(error, 'E_UPDATE_TODO');
      }
    }
  );
}

// ---------------------------
// Handler: Complete Item
// ---------------------------

type CompleteTodoInput = z.infer<typeof CompleteTodoSchema>;

function buildStatusResponse(todo: Todo, summary: string): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      item: todo,
      summary,
      nextActions: ['list_todos'],
    },
  });
}

function buildCompletionSummary(already: boolean): string {
  return already ? 'Todo is already completed' : 'Completed todo';
}

function buildOutcomeResponse(outcome: CompleteTodoOutcome): CallToolResult {
  if (outcome.kind === 'error') return outcome.response;

  const already = outcome.kind === 'already';
  return buildStatusResponse(outcome.todo, buildCompletionSummary(already));
}

async function handleCompleteTodo(
  input: CompleteTodoInput,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const outcome = await completeTodoById(input.id, true, extra.signal);
  return buildOutcomeResponse(outcome);
}

function registerCompleteTodo(server: McpServer, serverIcon?: string): void {
  registerToolWithDiagnostics(
    server,
    'complete_todo',
    {
      title: 'Complete Todo',
      description: 'Mark a todo as completed',
      inputSchema: CompleteTodoSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
      },
      ...(serverIcon
        ? {
            icons: [
              { src: serverIcon, mimeType: 'image/svg+xml', sizes: ['any'] },
            ],
          }
        : {}),
    },
    async (input, extra) => {
      try {
        return await handleCompleteTodo(input, extra);
      } catch (error) {
        return createExecutionErrorResponse(error, 'E_COMPLETE_TODO');
      }
    }
  );
}

// ---------------------------
// Handler: Delete Item
// ---------------------------

type DeleteTodoInput = z.infer<typeof DeleteTodoSchema>;

function buildDeleteResponse(todo: Todo): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [todo.id],
      summary: 'Deleted todo',
      nextActions: ['list_todos'],
    },
  });
}

async function handleDeleteTodo(
  input: DeleteTodoInput,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const outcome = await deleteTodoById(input.id, extra.signal);

  if (outcome.kind === 'error') {
    return outcome.response;
  }

  return buildDeleteResponse(outcome.todo);
}

function registerDeleteTodo(server: McpServer, serverIcon?: string): void {
  registerToolWithDiagnostics(
    server,
    'delete_todo',
    {
      title: 'Delete Todo',
      description: 'Delete a todo item by ID',
      inputSchema: DeleteTodoSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
      },
      ...(serverIcon
        ? {
            icons: [
              { src: serverIcon, mimeType: 'image/svg+xml', sizes: ['any'] },
            ],
          }
        : {}),
    },
    async (input, extra) => {
      try {
        return await handleDeleteTodo(input, extra);
      } catch (error) {
        return createExecutionErrorResponse(error, 'E_DELETE_TODO');
      }
    }
  );
}

const TOOL_REGISTRATIONS: readonly ((
  server: McpServer,
  serverIcon?: string
) => void)[] = [
  registerAddTodo,
  registerAddTodos,
  registerListTodos,
  registerUpdateTodo,
  registerCompleteTodo,
  registerDeleteTodo,
];

export function registerAllTools(server: McpServer, serverIcon?: string): void {
  TOOL_REGISTRATIONS.forEach((register) => {
    register(server, serverIcon);
  });
}
