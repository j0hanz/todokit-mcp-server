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
  StatusSchema,
  type Todo,
  UpdateTodoSchema,
} from './schema.js';
import {
  addTodos,
  completeTodoBySelector,
  type CompleteTodoOutcome,
  deleteTodoBySelector,
  deleteTodosByIds,
  getTodos,
  resolveTodoTargetFromTodos,
  type TodoUpdate,
  toResolveInput,
  unwrapResolution,
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
      summary: `Added todo "${todo.title}"`,
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
  const { title, description } = input;
  try {
    const todos = await addTodos([{ title, description }]);
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
type SortBy = 'createdAt' | 'title';
type SortOrder = 'asc' | 'desc';

interface NormalizedFilters {
  completed?: boolean | undefined;
  query?: string | undefined;
  sortBy: SortBy;
  order: SortOrder;
  limit: number;
  offset: number;
}

interface CountSummary {
  total: number;
  completed: number;
  pending: number;
  isCreatedAtAsc: boolean;
  isCreatedAtDesc: boolean;
}

interface OrderState {
  previousCreatedAt: string | null;
  isCreatedAtAsc: boolean;
  isCreatedAtDesc: boolean;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

const COMPARATORS: Record<SortBy, (a: Todo, b: Todo) => number> = {
  title: (a, b) => a.title.localeCompare(b.title),
  createdAt: (a, b) => a.createdAt.localeCompare(b.createdAt),
};

function createTodoComparator(
  sortBy: SortBy,
  order: SortOrder
): (a: Todo, b: Todo) => number {
  const direction = order === 'desc' ? -1 : 1;
  const comparator = COMPARATORS[sortBy];
  return (a, b) => {
    const diff = comparator(a, b);
    if (diff !== 0) return diff * direction;
    return a.createdAt.localeCompare(b.createdAt);
  };
}

function sortTodos(
  todos: readonly Todo[],
  sortBy: SortBy,
  order: SortOrder
): Todo[] {
  const comparator = createTodoComparator(sortBy, order);
  return todos.toSorted(comparator);
}

interface IndexedTodo {
  todo: Todo;
  index: number;
}

function createIndexedComparator(
  comparator: (a: Todo, b: Todo) => number
): (a: IndexedTodo, b: IndexedTodo) => number {
  return (left, right) => {
    const diff = comparator(left.todo, right.todo);
    if (diff !== 0) return diff;
    return left.index - right.index;
  };
}

function getHeapItem(heap: IndexedTodo[], index: number): IndexedTodo {
  const item = heap[index];
  if (!item) {
    throw new Error('Heap index out of range');
  }
  return item;
}

function swapHeapItems(heap: IndexedTodo[], left: number, right: number): void {
  const temp = getHeapItem(heap, left);
  heap[left] = getHeapItem(heap, right);
  heap[right] = temp;
}

function siftUpHeap(
  heap: IndexedTodo[],
  index: number,
  isWorse: (a: IndexedTodo, b: IndexedTodo) => boolean
): void {
  let i = index;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!isWorse(getHeapItem(heap, i), getHeapItem(heap, parent))) break;
    swapHeapItems(heap, i, parent);
    i = parent;
  }
}

function siftDownHeap(
  heap: IndexedTodo[],
  index: number,
  isWorse: (a: IndexedTodo, b: IndexedTodo) => boolean
): void {
  let i = index;
  for (;;) {
    const left = i * 2 + 1;
    if (left >= heap.length) break;
    const right = left + 1;
    let worst = left;
    if (
      right < heap.length &&
      isWorse(getHeapItem(heap, right), getHeapItem(heap, left))
    ) {
      worst = right;
    }
    if (!isWorse(getHeapItem(heap, worst), getHeapItem(heap, i))) break;
    swapHeapItems(heap, i, worst);
    i = worst;
  }
}

function pushHeapItem(
  heap: IndexedTodo[],
  item: IndexedTodo,
  isWorse: (a: IndexedTodo, b: IndexedTodo) => boolean
): void {
  heap.push(item);
  siftUpHeap(heap, heap.length - 1, isWorse);
}

function selectTopKSorted(
  todos: readonly Todo[],
  k: number,
  comparator: (a: Todo, b: Todo) => number
): Todo[] {
  if (k <= 0) return [];
  if (k >= todos.length) return todos.toSorted(comparator);

  const indexedComparator = createIndexedComparator(comparator);
  const heap: IndexedTodo[] = [];
  const isWorse = (a: IndexedTodo, b: IndexedTodo): boolean =>
    indexedComparator(a, b) > 0;

  for (let index = 0; index < todos.length; index += 1) {
    const todo = todos[index];
    if (!todo) continue;
    const item: IndexedTodo = { todo, index };
    if (heap.length < k) {
      pushHeapItem(heap, item, isWorse);
      continue;
    }
    const root = heap[0];
    if (root && indexedComparator(item, root) < 0) {
      heap[0] = item;
      siftDownHeap(heap, 0, isWorse);
    }
  }

  return heap.toSorted(indexedComparator).map((item) => item.todo);
}

function resolveCompletedFilter(
  status: ListTodosFilters['status'],
  completed: ListTodosFilters['completed']
): boolean | undefined {
  if (status === 'pending') return false;
  if (status === 'completed') return true;
  return completed;
}

function normalizeFilters(filters: ListTodosFilters): NormalizedFilters {
  return {
    completed: resolveCompletedFilter(filters.status, filters.completed),
    query: filters.query,
    sortBy: filters.sortBy ?? 'createdAt',
    order: filters.order ?? 'asc',
    limit: filters.limit ?? DEFAULT_LIMIT,
    offset: filters.offset ?? DEFAULT_OFFSET,
  };
}

function computeCounts(todos: readonly Todo[]): CountSummary {
  const orderState = createOrderState();
  const totals = todos.reduce(
    (current, todo) => {
      current.completed += Number(todo.completed);
      updateOrderState(orderState, todo.createdAt);
      return current;
    },
    { completed: 0 }
  );
  const total = todos.length;
  return {
    total,
    completed: totals.completed,
    pending: total - totals.completed,
    isCreatedAtAsc: orderState.isCreatedAtAsc,
    isCreatedAtDesc: orderState.isCreatedAtDesc,
  };
}

function createOrderState(): OrderState {
  return {
    previousCreatedAt: null,
    isCreatedAtAsc: true,
    isCreatedAtDesc: true,
  };
}

function updateOrderState(state: OrderState, current: string): void {
  const previous = state.previousCreatedAt;
  if (previous === null) {
    state.previousCreatedAt = current;
    return;
  }
  if (current < previous) {
    state.isCreatedAtAsc = false;
  } else if (current > previous) {
    state.isCreatedAtDesc = false;
  }
  state.previousCreatedAt = current;
}

function buildSummary(counts: CountSummary, pageCount: number): string {
  if (counts.total === 0) {
    return 'No todos found';
  }
  return `Showing ${String(pageCount)} of ${String(counts.total)} todos (${String(
    counts.pending
  )} pending, ${String(counts.completed)} completed).`;
}

function paginateTodos(
  todos: readonly Todo[],
  offset: number,
  limit: number
): Todo[] {
  return todos.slice(offset, offset + limit);
}

function canReuseOrder(
  sortBy: SortBy,
  order: SortOrder,
  counts: CountSummary
): boolean {
  if (sortBy !== 'createdAt') return false;
  return order === 'asc' ? counts.isCreatedAtAsc : counts.isCreatedAtDesc;
}

function buildListResponse(
  paged: readonly Todo[],
  counts: CountSummary,
  normalized: NormalizedFilters
): CallToolResult {
  const summary = buildSummary(counts, paged.length);
  const hasMore = normalized.offset + paged.length < counts.total;

  return createToolResponse({
    ok: true,
    result: {
      items: paged,
      summary,
      counts: {
        total: counts.total,
        pending: counts.pending,
        completed: counts.completed,
      },
      limit: normalized.limit,
      offset: normalized.offset,
      hasMore,
    },
  });
}

async function handleListTodos(
  filters: ListTodosFilters
): Promise<CallToolResult> {
  const normalized = normalizeFilters(filters);
  const allTodos = await getTodos({
    completed: normalized.completed,
    query: normalized.query,
  });

  const counts = computeCounts(allTodos);
  const comparator = createTodoComparator(normalized.sortBy, normalized.order);
  const pageSize = normalized.offset + normalized.limit;
  const needsPartial = pageSize < allTodos.length;
  let sorted: readonly Todo[];
  if (canReuseOrder(normalized.sortBy, normalized.order, counts)) {
    sorted = allTodos;
  } else if (needsPartial) {
    sorted = selectTopKSorted(allTodos, pageSize, comparator);
  } else {
    sorted = sortTodos(allTodos, normalized.sortBy, normalized.order);
  }
  const paged = paginateTodos(sorted, normalized.offset, normalized.limit);
  return buildListResponse(paged, counts, normalized);
}

export function registerListTodos(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'list_todos',
    {
      title: 'List Todos',
      description: 'List todos with filtering, search, sorting, and pagination',
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
type ClearField = NonNullable<UpdateTodoInput['clearFields']>[number];

function assignFields(
  updates: UpdateFields,
  fields: Omit<UpdateTodoInput, 'clearFields'>
): void {
  if (fields.title !== undefined) updates.title = fields.title;
  if (fields.description !== undefined)
    updates.description = fields.description;
  if (fields.completed !== undefined) updates.completed = fields.completed;
}

function applyClears(updates: UpdateFields, clears: Set<ClearField>): void {
  if (clears.has('description')) updates.description = undefined;
}

function buildUpdatePayload(
  _baseTodo: Todo,
  input: UpdateTodoInput
): UpdateFields | null {
  const { clearFields = [], ...fields } = input;
  const clears = new Set(clearFields);
  const updates: UpdateFields = {};

  assignFields(updates, fields);
  applyClears(updates, clears);

  return Object.keys(updates).length > 0 ? updates : null;
}

async function handleUpdateTodo(
  input: UpdateTodoInput
): Promise<CallToolResult> {
  const selector =
    input.id !== undefined ? { id: input.id } : { query: input.query };
  const outcome = await updateTodoBySelector(toResolveInput(selector), (todo) =>
    buildUpdatePayload(todo, input)
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
      summary: `Updated todo "${outcome.todo.title}"`,
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

function buildCompletionSummary(
  title: string,
  already: boolean,
  targetCompleted: boolean
): string {
  if (already && targetCompleted) {
    return `Todo "${title}" is already completed`;
  }
  if (already) {
    return `Todo "${title}" is already pending`;
  }
  if (targetCompleted) {
    return `Completed todo "${title}"`;
  }
  return `Reopened todo "${title}"`;
}

function buildOutcomeResponse(
  outcome: CompleteTodoOutcome,
  targetCompleted: boolean
): CallToolResult {
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
    return outcome.response;
  }
  const already = outcome.kind === 'already';
  const summary = buildCompletionSummary(
    outcome.todo.title,
    already,
    targetCompleted
  );
  return buildStatusResponse(outcome.todo, summary);
}

async function handleCompleteTodo(
  input: CompleteTodoInput
): Promise<CallToolResult> {
  const targetCompleted = input.completed ?? true;
  const selector =
    input.id !== undefined ? { id: input.id } : { query: input.query };
  const outcome = await completeTodoBySelector(
    toResolveInput(selector),
    targetCompleted
  );
  return buildOutcomeResponse(outcome, targetCompleted);
}

export function registerCompleteTodo(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'complete_todo',
    {
      title: 'Complete Todo',
      description: 'Set completion status for a todo item',
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

function getSelector(input: DeleteTodoInput): { id?: string; query?: string } {
  return input.id !== undefined ? { id: input.id } : { query: input.query };
}

function buildDryRunMultiple(
  previews: readonly unknown[],
  total: number
): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [],
      summary: `Dry run: ${String(total)} todos would be deleted`,
      matches: previews,
      totalMatches: total,
      dryRun: true,
    },
  });
}

function buildDeleteResponse(todo: Todo, dryRun: boolean): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [todo.id],
      summary: dryRun
        ? `Dry run: would delete todo "${todo.title}"`
        : `Deleted todo "${todo.title}"`,
      ...(dryRun ? { dryRun: true } : { nextActions: ['list_todos'] }),
    },
  });
}

async function handleDeleteTodo(
  input: DeleteTodoInput
): Promise<CallToolResult> {
  const selector = getSelector(input);
  const dryRun = input.dryRun ?? false;

  if (dryRun) {
    const todos = await getTodos();
    const outcome = unwrapResolution(
      resolveTodoTargetFromTodos(todos, toResolveInput(selector))
    );
    if (outcome.kind === 'error') return outcome.response;
    if (outcome.kind === 'ambiguous') {
      return buildDryRunMultiple(outcome.previews, outcome.matches.length);
    }
    return buildDeleteResponse(outcome.todo, true);
  }

  const outcome = await deleteTodoBySelector(toResolveInput(selector));
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
    return outcome.response;
  }
  return buildDeleteResponse(outcome.todo, false);
}

export function registerDeleteTodo(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'delete_todo',
    {
      title: 'Delete Todo',
      description: 'Delete a todo item (supports dry-run)',
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

type FilterKey = 'status' | 'query';
const FILTER_KEYS: FilterKey[] = ['status', 'query'];

function hasAtLeastOneFilter(v: Record<string, unknown>): boolean {
  return FILTER_KEYS.some((key) => v[key] !== undefined);
}

const DeleteTodosSchema = z
  .strictObject({
    status: StatusSchema.optional().describe('Filter by status'),
    query: z.string().min(1).max(200).optional().describe('Search text filter'),
    dryRun: z
      .boolean()
      .optional()
      .describe('Preview deletion without removing data'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Max items to delete (default: 10, safety limit)'),
  })
  .refine(hasAtLeastOneFilter, {
    error: 'At least one filter is required for bulk delete',
  });

type DeleteTodosInput = z.infer<typeof DeleteTodosSchema>;

const DEFAULT_DELETE_LIMIT = 10;
const COMPLETED_FILTER_BY_STATUS: Record<
  'pending' | 'completed' | 'all',
  boolean | undefined
> = {
  pending: false,
  completed: true,
  all: undefined,
};

function resolveDeleteCompletedFilter(
  status?: 'pending' | 'completed' | 'all'
): boolean | undefined {
  return COMPLETED_FILTER_BY_STATUS[status ?? 'all'];
}

function buildPreview(todo: Todo): { id: string; title: string } {
  return { id: todo.id, title: todo.title };
}

function buildNoMatchResponse(): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [],
      summary: 'No todos matched the filters',
      totalMatched: 0,
    },
  });
}

function buildDryRunResponse(
  toDelete: Todo[],
  totalMatched: number
): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds: [],
      summary: `Dry run: ${String(toDelete.length)} of ${String(totalMatched)} matching todos would be deleted`,
      matches: toDelete.map(buildPreview),
      totalMatched,
      dryRun: true,
    },
  });
}

function buildDeletedResponse(
  deletedIds: string[],
  totalMatched: number
): CallToolResult {
  return createToolResponse({
    ok: true,
    result: {
      deletedIds,
      summary: `Deleted ${String(deletedIds.length)} todos`,
      totalMatched,
      nextActions: ['list_todos'],
    },
  });
}

async function handleDeleteTodos(
  input: DeleteTodosInput
): Promise<CallToolResult> {
  const { limit = DEFAULT_DELETE_LIMIT, dryRun = false } = input;

  const matches = await getTodos({
    completed: resolveDeleteCompletedFilter(input.status),
    query: input.query,
  });

  const totalMatched = matches.length;
  if (totalMatched === 0) {
    return buildNoMatchResponse();
  }

  const toDelete = matches.slice(0, limit);

  if (dryRun) {
    return buildDryRunResponse(toDelete, totalMatched);
  }

  const deletedIds = await deleteTodosByIds(toDelete.map((t) => t.id));
  return buildDeletedResponse(deletedIds, totalMatched);
}

export function registerDeleteTodos(server: McpServer): void {
  registerToolWithDiagnostics(
    server,
    'delete_todos',
    {
      title: 'Delete Todos (Bulk)',
      description:
        'Delete multiple todos matching filters (requires at least one filter, defaults to limit=10 for safety)',
      inputSchema: DeleteTodosSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
      },
    },
    async (input) => {
      try {
        return await handleDeleteTodos(input);
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
