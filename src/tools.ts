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

import { z } from 'zod';

import {
  nowMs,
  publishToolCallWithId,
  publishToolResult,
} from './diagnostics.js';
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
  completeTodoBySelector,
  type CompleteTodoOutcome,
  deleteAllTodos,
  deleteTodoBySelector,
  getTodos,
  type TodoUpdate,
  toResolveInput,
  updateTodoBySelector,
} from './storage.js';

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
    const result = handler(input, extra);
    return Promise.resolve(result)
      .then((resolved) => {
        publishSuccessResult(tool, requestId, start, resolved);
        return resolved;
      })
      .catch((error: unknown) => {
        publishFailureResult(tool, requestId, start);
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
      items: todos,
      summary: `Added ${String(todos.length)} todos`,
      nextActions: [...ADD_TODOS_ACTIONS],
    },
  });
}

const addTodoToolConfig = {
  description: 'Add a new todo item',
  inputSchema: AddTodoSchema,
  outputSchema: DefaultOutputSchema,
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
  },
};

async function handleAddTodo(input: AddTodoInput): Promise<CallToolResult> {
  const { description } = input;
  try {
    const todos = await addTodos([{ description }]);
    return buildAddTodoResponse(requireSingleTodo(todos));
  } catch (err) {
    return createErrorResponse('E_ADD_TODO', getErrorMessage(err));
  }
}

export function registerAddTodo(server: McpServer): void {
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
  description: 'Add multiple todo items in one call',
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
    return createErrorResponse('E_ADD_TODOS', getErrorMessage(err));
  }
}

export function registerAddTodos(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'add_todos',
    addTodosToolConfig,
    handleAddTodos
  );
}

type ListTodosFilters = z.infer<typeof ListTodosFilterSchema>;

interface CountSummary {
  total: number;
  completed: number;
  pending: number;
}

function computeCounts(todos: readonly Todo[]): CountSummary {
  const completed = todos.filter((t) => t.completed).length;
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

function resolveCompletedFilter(
  status: ListTodosFilters['status']
): boolean | undefined {
  if (status === 'pending') return false;
  if (status === 'completed') return true;
  return undefined;
}

function buildListResponse(
  todos: readonly Todo[],
  counts: CountSummary
): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      items: todos,
      summary: buildSummary(counts),
      counts: {
        total: counts.total,
        pending: counts.pending,
        completed: counts.completed,
      },
    },
  });
}

async function handleListTodos(
  filters: ListTodosFilters
): Promise<CallToolResult> {
  const completed = resolveCompletedFilter(filters.status);
  const allTodos = await getTodos({ completed });
  const counts = computeCounts(allTodos);
  return buildListResponse(allTodos, counts);
}

export function registerListTodos(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'list_todos',
    {
      title: 'List Todos',
      description: 'List all todos with optional status filter',
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
        return createErrorResponse('E_LIST_TODOS', getErrorMessage(err));
      }
    }
  );
}

type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>;
type UpdateFields = TodoUpdate;

function buildUpdatePayload(input: UpdateTodoInput): UpdateFields | null {
  const updates: UpdateFields = {};
  if (input.description !== undefined) updates.description = input.description;
  return Object.keys(updates).length > 0 ? updates : null;
}

async function handleUpdateTodo(
  input: UpdateTodoInput
): Promise<CallToolResult> {
  const outcome = await updateTodoBySelector(
    toResolveInput({ id: input.id }),
    () => buildUpdatePayload(input)
  );
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
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

export function registerUpdateTodo(server: McpServer): void {
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
        return createErrorResponse('E_UPDATE_TODO', getErrorMessage(err));
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
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
    return outcome.response;
  }
  const already = outcome.kind === 'already';
  const summary = buildCompletionSummary(already);
  return buildStatusResponse(outcome.todo, summary);
}

async function handleCompleteTodo(
  input: CompleteTodoInput
): Promise<CallToolResult> {
  const outcome = await completeTodoBySelector(
    toResolveInput({ id: input.id }),
    true
  );
  return buildOutcomeResponse(outcome);
}

export function registerCompleteTodo(server: McpServer): void {
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
        return createErrorResponse('E_COMPLETE_TODO', getErrorMessage(err));
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
  const outcome = await deleteTodoBySelector(toResolveInput({ id: input.id }));
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
    return outcome.response;
  }
  return buildDeleteResponse(outcome.todo);
}

export function registerDeleteTodo(server: McpServer): void {
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
        idempotentHint: true,
        destructiveHint: true,
      },
    },
    async (input) => {
      try {
        return await handleDeleteTodo(input);
      } catch (err) {
        return createErrorResponse('E_DELETE_TODO', getErrorMessage(err));
      }
    }
  );
}

async function handleDeleteTodos(): Promise<CallToolResult> {
  const deletedIds = await deleteAllTodos();
  return createToolResponse({
    ok: true,
    result: {
      deletedIds,
      summary:
        deletedIds.length === 0
          ? 'No todos to delete'
          : `Deleted ${String(deletedIds.length)} todos`,
      nextActions: ['add_todo'],
    },
  });
}

export function registerDeleteTodos(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'delete_todos',
    {
      title: 'Delete All Todos',
      description: 'Delete all todos from the list',
      inputSchema: z.object({}),
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
        destructiveHint: true,
      },
    },
    async () => {
      try {
        return await handleDeleteTodos();
      } catch (err) {
        return createErrorResponse('E_DELETE_TODOS', getErrorMessage(err));
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
  registerDeleteTodos,
];

export function registerAllTools(server: McpServer): void {
  TOOL_REGISTRATIONS.forEach((register) => {
    register(server);
  });
}
