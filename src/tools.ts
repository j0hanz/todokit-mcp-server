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
const TOOL_ABORT_ERROR_NAME = 'TodokitToolAbort';
const TOOL_TIMEOUT_ERROR_NAME = 'TodokitToolTimeout';

let isInitialized = (): boolean => true;

export function setInitializationGuard(fn: () => boolean): void {
  isInitialized = fn;
}

function getToolTimeoutMs(): number | null {
  const raw = process.env.TODOKIT_TOOL_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_TOOL_TIMEOUT_MS;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return DEFAULT_TOOL_TIMEOUT_MS;
  }
  if (value <= 0) return null;
  return value;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function createAbortPromise(
  signal: AbortSignal | undefined
): { promise: Promise<never>; cancel: () => void } | null {
  if (!signal) return null;
  if (signal.aborted) {
    const error = new Error('Tool cancelled');
    error.name = TOOL_ABORT_ERROR_NAME;
    return { promise: Promise.reject(error), cancel: () => undefined };
  }
  let listener: (() => void) | null = null;
  const promise = new Promise<never>((_, reject) => {
    listener = () => {
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
  message: string
): { promise: Promise<never>; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
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
  const wrapped = (
    input: ToolInput<InputArgs>,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): Promise<CallToolResult> => {
    const requestId = randomUUID();
    publishToolCallWithId(tool, input, requestId);
    const start = nowMs();
    if (!isInitialized()) {
      const response = createErrorResponse(
        'E_NOT_INITIALIZED',
        'Server not initialized'
      );
      publishSuccessResult(tool, requestId, start, response);
      return Promise.resolve(response);
    }
    if (extra.signal.aborted) {
      const response = createErrorResponse('E_CANCELLED', 'Tool cancelled');
      publishSuccessResult(tool, requestId, start, response);
      return Promise.resolve(response);
    }
    let result: CallToolResult | Promise<CallToolResult>;
    try {
      result = runWithRequestContext({ requestId, tool }, () =>
        handler(input, extra)
      );
    } catch (error: unknown) {
      publishFailureResult(tool, requestId, start);
      const rejection =
        error instanceof Error ? error : new Error(String(error));
      return Promise.reject(rejection);
    }

    const timeoutMs = getToolTimeoutMs();
    const timeout = timeoutMs
      ? createTimeoutPromise(timeoutMs, `Tool ${tool} timed out`)
      : null;
    const abort = createAbortPromise(extra.signal);
    const race = Promise.race(
      [Promise.resolve(result), timeout?.promise, abort?.promise].filter(
        isDefined
      )
    );

    return race
      .finally(() => {
        timeout?.cancel();
        abort?.cancel();
      })
      .then((resolved) => {
        publishSuccessResult(tool, requestId, start, resolved);
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
          publishSuccessResult(tool, requestId, start, response);
          return response;
        }
        publishFailureResult(tool, requestId, start);

        const mapped = mapExecutionError(error, 'E_TOOL_ERROR');
        return createErrorResponse(mapped.code, mapped.message);
      });
  };
  return wrapped as ToolCallback<InputArgs>;
}

function registerToolWithDiagnostics<
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

type AddTodoInput = z.infer<typeof AddTodoSchema>;

const ADD_TODO_ACTIONS = [
  'list_todos',
  'update_todo',
  'complete_todo',
] as const;
const ADD_TODOS_ACTIONS = ['list_todos', 'update_todo'] as const;

function requireSingleTodo(todos: Todo[]): Todo {
  const todo = todos[0];
  if (!todo) {
    throw new Error('Failed to create todo');
  }
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

const addTodoToolConfig = {
  description:
    "Create a new task. Use this for single items. For multiple items, prefer 'add_todos' to save time. Note: the storage file is automatically deleted when all tasks are marked as completed.",
  inputSchema: AddTodoSchema,
  outputSchema: DefaultOutputSchema,
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
  },
};

async function handleAddTodo(input: AddTodoInput): Promise<CallToolResult> {
  const { description, priority, category, dueAt } = input;
  try {
    const todos = await addTodos([{ description, priority, category, dueAt }]);
    return buildAddTodoResponse(requireSingleTodo(todos));
  } catch (err) {
    const mapped = mapExecutionError(err, 'E_ADD_TODO');
    return createErrorResponse(mapped.code, mapped.message);
  }
}

function registerAddTodo(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'add_todo',
    addTodoToolConfig,
    handleAddTodo
  );
}

type AddTodosInput = z.infer<typeof AddTodosSchema>;

const addTodosToolConfig = {
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

async function handleAddTodos(input: AddTodosInput): Promise<CallToolResult> {
  try {
    const todos = await addTodos(input.items);
    return buildAddTodosResponse(todos);
  } catch (err) {
    const mapped = mapExecutionError(err, 'E_ADD_TODOS');
    return createErrorResponse(mapped.code, mapped.message);
  }
}

function registerAddTodos(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'add_todos',
    addTodosToolConfig,
    handleAddTodos
  );
}

type ListTodosFilters = z.infer<typeof ListTodosFilterSchema>;

type ListTodoStatus = 'pending' | 'completed' | 'all';

interface CountSummary {
  total: number;
  completed: number;
  pending: number;
}

function computeCounts(todos: readonly Todo[]): CountSummary {
  let completed = 0;
  for (const todo of todos) {
    if (todo.completed) completed += 1;
  }
  return {
    total: todos.length,
    completed,
    pending: todos.length - completed,
  };
}

function buildSummary(counts: CountSummary): string {
  if (counts.total === 0) {
    return 'No todos found';
  }
  return `Found ${String(counts.total)} todos (${String(counts.pending)} pending, ${String(counts.completed)} completed)`;
}

function resolveStatus(status: ListTodosFilters['status']): ListTodoStatus {
  return status ?? 'pending';
}

function buildListHint(status: ListTodoStatus, remaining: number): string {
  if (remaining <= 0) {
    return 'Tip: when all todos are completed, the storage file is automatically deleted.';
  }
  if (status === 'all') {
    return `...and ${String(remaining)} more. Narrow the list by using status='pending' or status='completed', or operate by ID.`;
  }
  return `...and ${String(remaining)} more. Use status='all' to include completed items, or operate by ID.`;
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

async function handleListTodos(
  filters: ListTodosFilters
): Promise<CallToolResult> {
  const allTodos = await getTodos();
  const counts = computeCounts(allTodos);

  const status = resolveStatus(filters.status);
  let filtered: readonly Todo[];
  if (status === 'pending') {
    filtered = allTodos.filter((todo) => !todo.completed);
  } else if (status === 'completed') {
    filtered = allTodos.filter((todo) => todo.completed);
  } else {
    filtered = allTodos;
  }
  const filteredCounts = computeCounts(filtered);

  const limit = 50;
  const items = filtered.slice(0, limit);
  const truncated = filtered.length > items.length;
  const remaining = Math.max(0, filtered.length - items.length);

  let summary: string;
  if (filteredCounts.total === 0) {
    summary = 'No todos found';
  } else if (truncated) {
    summary = `Showing ${String(items.length)} of ${String(filteredCounts.total)} ${status} todos (${buildSummary(counts)})`;
  } else {
    summary = `Showing ${String(filteredCounts.total)} ${status} todos (${buildSummary(counts)})`;
  }

  return buildListResponse({
    items,
    counts,
    filteredCounts,
    status,
    returned: items.length,
    truncated,
    remaining,
    summary,
    hint: buildListHint(status, remaining),
  });
}

function registerListTodos(server: McpServer): void {
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
    },
    async (filters) => {
      try {
        return await handleListTodos(filters);
      } catch (err) {
        const mapped = mapExecutionError(err, 'E_LIST_TODOS');
        return createErrorResponse(mapped.code, mapped.message);
      }
    }
  );
}

type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>;
type UpdateFields = TodoUpdate;

function buildUpdatePayload(input: UpdateTodoInput): UpdateFields | null {
  const updates: UpdateFields = {};
  if (input.description !== undefined) {
    updates.description = input.description;
  }
  if (input.priority !== undefined) {
    updates.priority = input.priority;
  }
  if (input.category !== undefined) {
    updates.category = input.category;
  }
  if (input.dueAt !== undefined) {
    updates.dueAt = input.dueAt;
  }
  return Object.keys(updates).length > 0 ? updates : null;
}

async function handleUpdateTodo(
  input: UpdateTodoInput
): Promise<CallToolResult> {
  const outcome = await updateTodoById(input.id, () =>
    buildUpdatePayload(input)
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

function registerUpdateTodo(server: McpServer): void {
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
    },
    async (input) => {
      try {
        return await handleUpdateTodo(input);
      } catch (err) {
        const mapped = mapExecutionError(err, 'E_UPDATE_TODO');
        return createErrorResponse(mapped.code, mapped.message);
      }
    }
  );
}

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
  if (already) {
    return 'Todo is already completed';
  }
  return 'Completed todo';
}

function buildOutcomeResponse(outcome: CompleteTodoOutcome): CallToolResult {
  if (outcome.kind === 'error') {
    return outcome.response;
  }
  const already = outcome.kind === 'already';
  const summary = buildCompletionSummary(already);
  return buildStatusResponse(outcome.todo, summary);
}

async function handleCompleteTodo(
  input: CompleteTodoInput
): Promise<CallToolResult> {
  const outcome = await completeTodoById(input.id, true);
  return buildOutcomeResponse(outcome);
}

function registerCompleteTodo(server: McpServer): void {
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
    },
    async (input) => {
      try {
        return await handleCompleteTodo(input);
      } catch (err) {
        const mapped = mapExecutionError(err, 'E_COMPLETE_TODO');
        return createErrorResponse(mapped.code, mapped.message);
      }
    }
  );
}

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
  input: DeleteTodoInput
): Promise<CallToolResult> {
  const outcome = await deleteTodoById(input.id);
  if (outcome.kind === 'error') {
    return outcome.response;
  }
  return buildDeleteResponse(outcome.todo);
}

function registerDeleteTodo(server: McpServer): void {
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
    },
    async (input) => {
      try {
        return await handleDeleteTodo(input);
      } catch (err) {
        const mapped = mapExecutionError(err, 'E_DELETE_TODO');
        return createErrorResponse(mapped.code, mapped.message);
      }
    }
  );
}

const TOOL_REGISTRATIONS: ((server: McpServer) => void)[] = [
  registerAddTodo,
  registerAddTodos,
  registerListTodos,
  registerUpdateTodo,
  registerCompleteTodo,
  registerDeleteTodo,
];

export function registerAllTools(server: McpServer): void {
  TOOL_REGISTRATIONS.forEach((register) => {
    register(server);
  });
}
