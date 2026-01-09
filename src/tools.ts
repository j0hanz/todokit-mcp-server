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
  IsoDateSchema,
  ListTodosFilterSchema,
  PrioritySchema,
  StatusSchema,
  TagSchema,
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
  normalizeTags,
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
  title: 'Add Todo',
  description: 'Add a new todo item',
  inputSchema: AddTodoSchema,
  outputSchema: DefaultOutputSchema,
  annotations: {
    readOnlyHint: false,
    idempotentHint: false,
  },
};

async function handleAddTodo(input: AddTodoInput): Promise<CallToolResult> {
  const { title, description, priority, dueDate, tags } = input;
  try {
    const todos = await addTodos([
      { title, description, priority, dueDate, tags },
    ]);
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
type SortBy = 'dueDate' | 'priority' | 'createdAt' | 'title';
type SortOrder = 'asc' | 'desc';

interface NormalizedFilters {
  completed?: boolean | undefined;
  priority?: Todo['priority'] | undefined;
  tag?: string | undefined;
  dueBefore?: string | undefined;
  dueAfter?: string | undefined;
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
  overdue: number;
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
const PRIORITY_WEIGHT: Record<Todo['priority'], number> = {
  low: 1,
  normal: 2,
  high: 3,
};
const MISSING_DUE_DATE = '9999-12-31';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function getTodayIso(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = pad2(now.getMonth() + 1);
  const day = pad2(now.getDate());
  return `${year}-${month}-${day}`;
}

function isOverdue(todo: Todo, todayIso: string): boolean {
  if (!todo.dueDate) return false;
  if (todo.completed) return false;
  return todo.dueDate < todayIso;
}

const COMPARATORS: Record<SortBy, (a: Todo, b: Todo) => number> = {
  dueDate: (a, b) =>
    (a.dueDate ?? MISSING_DUE_DATE).localeCompare(
      b.dueDate ?? MISSING_DUE_DATE
    ),
  priority: (a, b) => PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority],
  title: (a, b) => a.title.localeCompare(b.title),
  createdAt: (a, b) => a.createdAt.localeCompare(b.createdAt),
};

function sortTodos(
  todos: readonly Todo[],
  sortBy: SortBy,
  order: SortOrder
): Todo[] {
  const direction = order === 'desc' ? -1 : 1;
  const comparator = COMPARATORS[sortBy];

  return todos.toSorted((a, b) => {
    const diff = comparator(a, b);
    if (diff !== 0) return diff * direction;
    return a.createdAt.localeCompare(b.createdAt);
  });
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
    priority: filters.priority,
    tag: filters.tag,
    dueBefore: filters.dueBefore,
    dueAfter: filters.dueAfter,
    query: filters.query,
    sortBy: filters.sortBy ?? 'createdAt',
    order: filters.order ?? 'asc',
    limit: filters.limit ?? DEFAULT_LIMIT,
    offset: filters.offset ?? DEFAULT_OFFSET,
  };
}

function computeCounts(todos: readonly Todo[], todayIso: string): CountSummary {
  const orderState = createOrderState();
  const totals = todos.reduce(
    (current, todo) => {
      current.completed += Number(todo.completed);
      current.overdue += Number(isOverdue(todo, todayIso));
      updateOrderState(orderState, todo.createdAt);
      return current;
    },
    { completed: 0, overdue: 0 }
  );
  const total = todos.length;
  return {
    total,
    completed: totals.completed,
    pending: total - totals.completed,
    overdue: totals.overdue,
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
  const overdueSuffix =
    counts.overdue > 0 ? `, ${String(counts.overdue)} overdue` : '';
  return `Showing ${String(pageCount)} of ${String(counts.total)} todos (${String(
    counts.pending
  )} pending, ${String(counts.completed)} completed${overdueSuffix}).`;
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
        overdue: counts.overdue,
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
    priority: normalized.priority,
    tag: normalized.tag,
    dueBefore: normalized.dueBefore,
    dueAfter: normalized.dueAfter,
    query: normalized.query,
  });

  const todayIso = getTodayIso();
  const counts = computeCounts(allTodos, todayIso);
  const sorted: readonly Todo[] = canReuseOrder(
    normalized.sortBy,
    normalized.order,
    counts
  )
    ? allTodos
    : sortTodos(allTodos, normalized.sortBy, normalized.order);
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

function normalizeTagOps(tagOps: UpdateTodoInput['tagOps']): {
  add: string[];
  remove: Set<string>;
} {
  return {
    add: normalizeTags(tagOps?.add ?? []),
    remove: new Set(normalizeTags(tagOps?.remove ?? [])),
  };
}

function getTagOps(tagOps?: UpdateTodoInput['tagOps']): {
  add: string[];
  remove: Set<string>;
} | null {
  if (!tagOps) return null;
  const { add, remove } = normalizeTagOps(tagOps);
  if (add.length === 0 && remove.size === 0) return null;
  return { add, remove };
}

function mergeTags(
  current: string[],
  ops: { add: string[]; remove: Set<string> } | null
): string[] {
  const toAdd = ops?.add ?? [];
  const toRemove = ops?.remove ?? new Set();
  return normalizeTags([...current, ...toAdd]).filter((t) => !toRemove.has(t));
}

function resolveTags(
  baseTags: string[],
  clears: Set<ClearField>,
  tagOps?: UpdateTodoInput['tagOps'],
  newTags?: string[]
): string[] | undefined {
  if (newTags !== undefined) return newTags;

  const shouldClear = clears.has('tags');
  const ops = getTagOps(tagOps);

  if (!shouldClear && !ops) return undefined;
  return mergeTags(shouldClear ? [] : baseTags, ops);
}

function assignContentFields(
  updates: UpdateFields,
  fields: Omit<UpdateTodoInput, 'clearFields' | 'tagOps'>
): void {
  if (fields.title !== undefined) updates.title = fields.title;
  if (fields.description !== undefined)
    updates.description = fields.description;
}

function assignStatusFields(
  updates: UpdateFields,
  fields: Omit<UpdateTodoInput, 'clearFields' | 'tagOps'>
): void {
  if (fields.completed !== undefined) updates.completed = fields.completed;
  if (fields.priority !== undefined) updates.priority = fields.priority;
  if (fields.dueDate !== undefined) updates.dueDate = fields.dueDate;
}

function assignFields(
  updates: UpdateFields,
  fields: Omit<UpdateTodoInput, 'clearFields' | 'tagOps'>
): void {
  assignContentFields(updates, fields);
  assignStatusFields(updates, fields);
}

function applyClears(updates: UpdateFields, clears: Set<ClearField>): void {
  if (clears.has('description')) updates.description = undefined;
  if (clears.has('dueDate')) updates.dueDate = undefined;
}

function buildUpdatePayload(
  baseTodo: Todo,
  input: UpdateTodoInput
): UpdateFields | null {
  const { clearFields = [], tagOps, ...fields } = input;
  const clears = new Set(clearFields);
  const updates: UpdateFields = {};

  assignFields(updates, fields);
  applyClears(updates, clears);

  const resolvedTags = resolveTags(baseTodo.tags, clears, tagOps, fields.tags);
  if (resolvedTags !== undefined) updates.tags = resolvedTags;

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
      description: 'Update fields on a todo item (supports search and tag ops)',
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

type FilterKey =
  | 'status'
  | 'priority'
  | 'tag'
  | 'dueBefore'
  | 'dueAfter'
  | 'query';
const FILTER_KEYS: FilterKey[] = [
  'status',
  'priority',
  'tag',
  'dueBefore',
  'dueAfter',
  'query',
];

function hasAtLeastOneFilter(v: Record<string, unknown>): boolean {
  return FILTER_KEYS.some((key) => v[key] !== undefined);
}

const DeleteTodosSchema = z
  .strictObject({
    status: StatusSchema.optional().describe('Filter by status'),
    priority: PrioritySchema.optional().describe('Filter by priority'),
    tag: TagSchema.optional().describe('Filter by tag'),
    dueBefore: IsoDateSchema.optional().describe(
      'Delete todos due before this date (ISO format)'
    ),
    dueAfter: IsoDateSchema.optional().describe(
      'Delete todos due after this date (ISO format)'
    ),
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
    priority: input.priority,
    tag: input.tag,
    dueBefore: input.dueBefore,
    dueAfter: input.dueAfter,
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
