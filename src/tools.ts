import { Buffer } from 'node:buffer';
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
  AddTodoOutputSchema,
  AddTodoSchema,
  AddTodosOutputSchema,
  AddTodosSchema,
  CompleteTodoOutputSchema,
  CompleteTodoSchema,
  DeleteTodoOutputSchema,
  DeleteTodoSchema,
  ListTodosFilterSchema,
  ListTodosOutputSchema,
  SearchTodosOutputSchema,
  SearchTodosSchema,
  type Todo,
  UpdateTodoOutputSchema,
  UpdateTodoSchema,
} from './schema.js';
import {
  addTodos,
  completeTodoById,
  type CompleteTodoOutcome,
  deleteTodoById,
  getCodedErrorCode,
  getTodos,
  searchTodos,
  type TodoUpdate,
  updateTodoById,
} from './storage.js';

const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 100;
const CURSOR_VERSION = 1 as const;

type CursorToolName = 'list_todos' | 'search_todos';

interface PaginationCursorPayload {
  v: typeof CURSOR_VERSION;
  tool: CursorToolName;
  status: ListTodoStatus;
  offset: number;
  query?: string | undefined;
}

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

function mapExecutionError(
  error: unknown,
  fallbackCode: string
): { code: string; message: string } {
  const coded = getCodedErrorCode(error);
  if (coded) {
    return { code: coded, message: getErrorMessage(error) };
  }
  const systemCode =
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as Record<string, unknown>).code === 'string'
      ? ((error as Record<string, unknown>).code as string)
      : undefined;
  if (systemCode) {
    return { code: systemCode, message: getErrorMessage(error) };
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

type OnTodosChanged = () => Promise<void> | void;

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
      const response = createExecutionErrorResponse(error, 'E_TOOL_ERROR');
      publishSuccessResult(tool, requestId, startedAt, response);
      return Promise.resolve(response);
    }

    // Optimization: Inline promise creation to avoid helper closures
    const timeoutMs = getToolTimeoutMs();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const promises: Promise<CallToolResult>[] = [Promise.resolve(result)];
    const cleanups: (() => void)[] = [];

    if (timeoutMs) {
      promises.push(
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => {
            propagateAbort();
            const error = new Error(`Tool ${tool} timed out`);
            error.name = TOOL_TIMEOUT_ERROR_NAME;
            reject(error);
          }, timeoutMs);
        })
      );
      cleanups.push(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
      });
    }

    promises.push(
      new Promise<never>((_, reject) => {
        const listener = (): void => {
          propagateAbort();
          const error = new Error('Tool cancelled');
          error.name = TOOL_ABORT_ERROR_NAME;
          reject(error);
        };
        if (extra.signal.aborted) {
          listener();
        } else {
          extra.signal.addEventListener('abort', listener, { once: true });
          cleanups.push(() => {
            extra.signal.removeEventListener('abort', listener);
          });
        }
      })
    );

    return Promise.race(promises)
      .finally(() => {
        for (const cleanup of cleanups) cleanup();
      })
      .then((resolved) => {
        publishSuccessResult(tool, requestId, startedAt, resolved);
        return resolved;
      })
      .catch((error: unknown) => {
        // Inlined classification
        let code = 'E_TOOL_ERROR';
        if (error instanceof Error) {
          if (error.name === TOOL_TIMEOUT_ERROR_NAME) code = 'E_TIMEOUT';
          else if (error.name === TOOL_ABORT_ERROR_NAME) code = 'E_CANCELLED';
        }

        if (code !== 'E_TOOL_ERROR') {
          const response = createErrorResponse(code, getErrorMessage(error));
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

function resolvePageLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) return DEFAULT_PAGE_LIMIT;
  return Math.min(MAX_PAGE_LIMIT, limit);
}

function encodeCursor(payload: PaginationCursorPayload): string {
  const raw = JSON.stringify(payload);
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): PaginationCursorPayload | null {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed)) return null;

    const { v: version, tool, status, offset, query } = parsed;

    if (version !== CURSOR_VERSION) return null;
    if (tool !== 'list_todos' && tool !== 'search_todos') return null;
    if (status !== 'pending' && status !== 'completed' && status !== 'all') {
      return null;
    }
    if (typeof offset !== 'number' || !Number.isInteger(offset) || offset < 0) {
      return null;
    }
    if (query !== undefined && typeof query !== 'string') return null;

    return {
      v: CURSOR_VERSION,
      tool,
      status,
      offset,
      query,
    };
  } catch {
    return null;
  }
}

function validateCursor(
  raw: string | undefined
): PaginationCursorPayload | null {
  if (!raw) return null;
  if (raw.length > 512) return null;
  return decodeCursor(raw);
}

async function notifyTodosChanged(
  onTodosChanged?: OnTodosChanged
): Promise<void> {
  if (!onTodosChanged) return;
  try {
    await onTodosChanged();
  } catch {
    // Notification failures must not break tool results.
  }
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
  typeof AddTodoOutputSchema
> = {
  description:
    "Create a new task. Use this for single items. For multiple items, prefer 'add_todos' to save time. Note: the storage file is automatically deleted when all tasks are marked as completed.",
  inputSchema: AddTodoSchema,
  outputSchema: AddTodoOutputSchema,
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
  },
};

async function handleAddTodo(
  input: AddTodoInput,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  onTodosChanged?: OnTodosChanged
): Promise<CallToolResult> {
  const { description, priority, category, dueAt } = input;

  try {
    const todos = await addTodos(
      [{ description, priority, category, dueAt }],
      extra.signal
    );
    await notifyTodosChanged(onTodosChanged);
    return buildAddTodoResponse(requireSingleTodo(todos));
  } catch (error) {
    return createExecutionErrorResponse(error, 'E_ADD_TODO');
  }
}

function registerAddTodo(
  server: McpServer,
  serverIcon?: string,
  onTodosChanged?: OnTodosChanged
): void {
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
    async (input, extra) => {
      return handleAddTodo(input, extra, onTodosChanged);
    }
  );
}

// ---------------------------
// add_todos
// ---------------------------

type AddTodosInput = z.infer<typeof AddTodosSchema>;

const addTodosToolConfig: ToolConfig<
  typeof AddTodosSchema,
  typeof AddTodosOutputSchema
> = {
  title: 'Add Todos (Batch)',
  description:
    'Create multiple tasks in one call to save time. Note: the storage file is automatically deleted when all tasks are marked as completed.',
  inputSchema: AddTodosSchema,
  outputSchema: AddTodosOutputSchema,
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
  },
};

async function handleAddTodos(
  input: AddTodosInput,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  onTodosChanged?: OnTodosChanged
): Promise<CallToolResult> {
  try {
    const todos = await addTodos(input.items, extra.signal);
    await notifyTodosChanged(onTodosChanged);
    return buildAddTodosResponse(todos);
  } catch (error) {
    return createExecutionErrorResponse(error, 'E_ADD_TODOS');
  }
}

function registerAddTodos(
  server: McpServer,
  serverIcon?: string,
  onTodosChanged?: OnTodosChanged
): void {
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
    async (input, extra) => {
      return handleAddTodos(input, extra, onTodosChanged);
    }
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

function buildListHint(
  status: ListTodoStatus,
  remaining: number,
  hasMore: boolean
): string {
  if (!hasMore || remaining <= 0) {
    return 'Tip: when all todos are completed, the storage file is automatically deleted.';
  }
  if (status === 'all') {
    return `...and ${String(
      remaining
    )} more. Use nextCursor to get the next page, or narrow by status='pending'/'completed'.`;
  }
  return `...and ${String(
    remaining
  )} more. Use nextCursor to get the next page. Use status='all' to include completed items.`;
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
  limit: number;
  hasMore: boolean;
  nextCursor?: string | undefined;
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
      limit: params.limit,
      hasMore: params.hasMore,
      ...(params.nextCursor === undefined
        ? {}
        : { nextCursor: params.nextCursor }),
    },
  });
}

function shouldIncludeTodo(todo: Todo, status: ListTodoStatus): boolean {
  if (status === 'all') return true;
  if (status === 'completed') return todo.completed;
  return !todo.completed;
}

function calculateTodoMetrics(
  todos: readonly Todo[],
  status: ListTodoStatus
): {
  totalTotal: number;
  totalCompleted: number;
  filteredTotal: number;
  filteredCompleted: number;
} {
  let totalTotal = 0;
  let totalCompleted = 0;
  let filteredTotal = 0;
  let filteredCompleted = 0;

  for (const todo of todos) {
    totalTotal++;
    if (todo.completed) totalCompleted++;

    if (shouldIncludeTodo(todo, status)) {
      filteredTotal++;
      if (todo.completed) filteredCompleted++;
    }
  }

  return { totalTotal, totalCompleted, filteredTotal, filteredCompleted };
}

function collectPagedTodos(
  todos: readonly Todo[],
  status: ListTodoStatus,
  offset: number,
  limit: number
): Todo[] {
  const items: Todo[] = [];
  let skipped = 0;
  let collected = 0;

  for (const todo of todos) {
    if (collected >= limit) break;

    if (shouldIncludeTodo(todo, status)) {
      if (skipped < offset) {
        skipped++;
      } else {
        items.push(todo);
        collected++;
      }
    }
  }
  return items;
}

function filterAndSliceTodos(
  todos: readonly Todo[],
  status: ListTodoStatus,
  offset: number,
  limit: number
): { items: Todo[]; filteredTotal: number } {
  const items: Todo[] = [];
  let filteredTotal = 0;

  for (const todo of todos) {
    if (shouldIncludeTodo(todo, status)) {
      if (filteredTotal >= offset && items.length < limit) {
        items.push(todo);
      }
      filteredTotal++;
    }
  }
  return { items, filteredTotal };
}

type ListOffsetResolution =
  | { ok: true; offset: number }
  | { ok: false; response: CallToolResult };

function resolveListOffset(
  filters: ListTodosFilters,
  status: ListTodoStatus,
  total: number
): ListOffsetResolution {
  const cursor = validateCursor(filters.cursor);
  if (filters.cursor && !cursor) {
    return {
      ok: false,
      response: createErrorResponse(
        'E_INVALID_PARAMS',
        'Invalid pagination cursor. Start with list_todos without a cursor.'
      ),
    };
  }

  if (!cursor) return { ok: true, offset: 0 };
  if (cursor.tool !== 'list_todos') {
    return {
      ok: false,
      response: createErrorResponse(
        'E_INVALID_PARAMS',
        'Cursor does not belong to list_todos.'
      ),
    };
  }
  if (cursor.status !== status) {
    return {
      ok: false,
      response: createErrorResponse(
        'E_INVALID_PARAMS',
        'Cursor does not match the requested status filter.'
      ),
    };
  }
  if (cursor.offset > 0 && cursor.offset >= total) {
    return {
      ok: false,
      response: createErrorResponse(
        'E_INVALID_PARAMS',
        'Pagination cursor is out of range. Restart pagination without a cursor.'
      ),
    };
  }
  return { ok: true, offset: cursor.offset };
}

function buildListSummary(params: {
  filteredTotal: number;
  offset: number;
  returned: number;
  status: ListTodoStatus;
  truncated: boolean;
  counts: CountSummary;
}): string {
  if (params.filteredTotal === 0) {
    return 'No todos found';
  }

  if (params.offset > 0 || params.truncated) {
    return `Showing ${String(params.offset + 1)}-${String(params.offset + params.returned)} of ${String(
      params.filteredTotal
    )} ${params.status} todos (${buildSummary(params.counts)})`;
  }

  return `Showing ${String(params.filteredTotal)} ${params.status} todos (${buildSummary(
    params.counts
  )})`;
}

async function handleListTodos(
  filters: ListTodosFilters,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const allTodos = await getTodos(extra.signal);
  const status = resolveStatus(filters.status);
  const limit = resolvePageLimit(filters.limit);

  // Optimization: Single pass for stats and filtering via helper
  const { totalTotal, totalCompleted, filteredTotal, filteredCompleted } =
    calculateTodoMetrics(allTodos, status);

  const resolvedOffset = resolveListOffset(filters, status, filteredTotal);
  if (!resolvedOffset.ok) {
    return resolvedOffset.response;
  }
  const { offset } = resolvedOffset;

  // Pass 2: Collect Items (only if needed)
  let items: Todo[] = [];
  if (filteredTotal > 0 && offset < filteredTotal) {
    items = collectPagedTodos(allTodos, status, offset, limit);
  }

  const counts: CountSummary = {
    total: totalTotal,
    completed: totalCompleted,
    pending: totalTotal - totalCompleted,
  };

  const filtered: CountSummary = {
    total: filteredTotal,
    completed: filteredCompleted,
    pending: filteredTotal - filteredCompleted,
  };

  const nextOffset = offset + items.length;
  const hasMore = nextOffset < filtered.total;
  const remaining = Math.max(0, filtered.total - nextOffset);
  const nextCursor = hasMore
    ? encodeCursor({
        v: CURSOR_VERSION,
        tool: 'list_todos',
        status,
        offset: nextOffset,
      })
    : undefined;
  const truncated = hasMore;

  const summary = buildListSummary({
    filteredTotal: filtered.total,
    offset,
    returned: items.length,
    status,
    truncated,
    counts,
  });

  return buildListResponse({
    items,
    counts,
    filteredCounts: filtered,
    status,
    returned: items.length,
    truncated,
    remaining,
    summary,
    hint: buildListHint(status, remaining, hasMore),
    limit,
    hasMore,
    nextCursor,
  });
}

function registerListTodos(server: McpServer, serverIcon?: string): void {
  registerToolWithDiagnostics(
    server,
    'list_todos',
    {
      title: 'List Todos',
      description:
        "List todos with optional status filtering and cursor pagination. Default is status='pending' to keep responses short; use status='all' to include completed.",
      inputSchema: ListTodosFilterSchema,
      outputSchema: ListTodosOutputSchema,
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
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  onTodosChanged?: OnTodosChanged
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

  await notifyTodosChanged(onTodosChanged);
  return createToolResponse({
    ok: true,
    result: {
      item: outcome.todo,
      summary: 'Updated todo',
      nextActions: ['list_todos', 'complete_todo'],
    },
  });
}

function registerUpdateTodo(
  server: McpServer,
  serverIcon?: string,
  onTodosChanged?: OnTodosChanged
): void {
  registerToolWithDiagnostics(
    server,
    'update_todo',
    {
      title: 'Update Todo',
      description: 'Update fields on a todo item',
      inputSchema: UpdateTodoSchema,
      outputSchema: UpdateTodoOutputSchema,
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
        return await handleUpdateTodo(input, extra, onTodosChanged);
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
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  onTodosChanged?: OnTodosChanged
): Promise<CallToolResult> {
  const outcome = await completeTodoById(input.id, true, extra.signal);
  if (outcome.kind !== 'error') {
    await notifyTodosChanged(onTodosChanged);
  }
  return buildOutcomeResponse(outcome);
}

function registerCompleteTodo(
  server: McpServer,
  serverIcon?: string,
  onTodosChanged?: OnTodosChanged
): void {
  registerToolWithDiagnostics(
    server,
    'complete_todo',
    {
      title: 'Complete Todo',
      description: 'Mark a todo as completed',
      inputSchema: CompleteTodoSchema,
      outputSchema: CompleteTodoOutputSchema,
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
        return await handleCompleteTodo(input, extra, onTodosChanged);
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
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  onTodosChanged?: OnTodosChanged
): Promise<CallToolResult> {
  const outcome = await deleteTodoById(input.id, extra.signal);

  if (outcome.kind === 'error') {
    return outcome.response;
  }

  await notifyTodosChanged(onTodosChanged);
  return buildDeleteResponse(outcome.todo);
}

function registerDeleteTodo(
  server: McpServer,
  serverIcon?: string,
  onTodosChanged?: OnTodosChanged
): void {
  registerToolWithDiagnostics(
    server,
    'delete_todo',
    {
      title: 'Delete Todo',
      description: 'Delete a todo item by ID',
      inputSchema: DeleteTodoSchema,
      outputSchema: DeleteTodoOutputSchema,
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
        return await handleDeleteTodo(input, extra, onTodosChanged);
      } catch (error) {
        return createExecutionErrorResponse(error, 'E_DELETE_TODO');
      }
    }
  );
}

// ---------------------------
// Handler: Search Item
// ---------------------------

type SearchTodosInput = z.infer<typeof SearchTodosSchema>;

async function handleSearchTodos(
  input: SearchTodosInput,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<CallToolResult> {
  const { query } = input;
  const status = resolveStatus(input.status);
  const limit = resolvePageLimit(input.limit);
  const cursor = validateCursor(input.cursor);

  if (input.cursor && !cursor) {
    return createErrorResponse(
      'E_INVALID_PARAMS',
      'Invalid pagination cursor. Start with search_todos without a cursor.'
    );
  }

  if (cursor) {
    if (cursor.tool !== 'search_todos') {
      return createErrorResponse(
        'E_INVALID_PARAMS',
        'Cursor does not belong to search_todos.'
      );
    }
    if (cursor.status !== status || cursor.query !== query) {
      return createErrorResponse(
        'E_INVALID_PARAMS',
        'Cursor does not match the current search query and status.'
      );
    }
  }

  const allMatches = await searchTodos(query, extra.signal);

  // Optimization: Single pass for filtering and slicing.
  const offset = cursor?.offset ?? 0;
  const { items, filteredTotal } = filterAndSliceTodos(
    allMatches,
    status,
    offset,
    limit
  );

  if (offset > 0 && offset >= filteredTotal) {
    return createErrorResponse(
      'E_INVALID_PARAMS',
      'Pagination cursor is out of range. Restart search without a cursor.'
    );
  }

  const nextOffset = offset + items.length;
  const hasMore = nextOffset < filteredTotal;
  const remaining = Math.max(0, filteredTotal - nextOffset);
  const nextCursor = hasMore
    ? encodeCursor({
        v: CURSOR_VERSION,
        tool: 'search_todos',
        status,
        query,
        offset: nextOffset,
      })
    : undefined;

  if (filteredTotal === 0) {
    return createToolResponse({
      ok: true,
      result: {
        items: [],
        query,
        status,
        summary: `No todos found matching "${query}"`,
        returned: 0,
        totalMatches: 0,
        remaining: 0,
        limit,
        hasMore: false,
        nextActions: ['list_todos', 'add_todo'],
      },
    });
  }

  const summary =
    offset > 0 || hasMore
      ? `Showing ${String(offset + 1)}-${String(offset + items.length)} of ${String(filteredTotal)} matches for "${query}" (${status})`
      : `Found ${filteredTotal} matches for "${query}" (${status})`;

  return createToolResponse({
    ok: true,
    result: {
      items,
      query,
      status,
      summary,
      returned: items.length,
      totalMatches: filteredTotal,
      remaining,
      limit,
      hasMore,
      ...(nextCursor === undefined ? {} : { nextCursor }),
      nextActions: ['update_todo', 'complete_todo'],
    },
  });
}

function registerSearchTodos(server: McpServer, serverIcon?: string): void {
  registerToolWithDiagnostics(
    server,
    'search_todos',
    {
      title: 'Search Todos',
      description:
        "Search todos by description or category. Supports status filtering and cursor pagination. Default status is 'pending'.",
      inputSchema: SearchTodosSchema,
      outputSchema: SearchTodosOutputSchema,
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
    async (input, extra) => {
      try {
        return await handleSearchTodos(input, extra);
      } catch (error) {
        return createExecutionErrorResponse(error, 'E_SEARCH_TODOS');
      }
    }
  );
}

const TOOL_REGISTRATIONS: readonly ((
  server: McpServer,
  serverIcon?: string,
  onTodosChanged?: OnTodosChanged
) => void)[] = [
  registerAddTodo,
  registerAddTodos,
  registerListTodos,
  registerUpdateTodo,
  registerCompleteTodo,
  registerDeleteTodo,
  registerSearchTodos,
];

export function registerAllTools(
  server: McpServer,
  serverIcon?: string,
  onTodosChanged?: OnTodosChanged
): void {
  TOOL_REGISTRATIONS.forEach((register) => {
    register(server, serverIcon, onTodosChanged);
  });
}
