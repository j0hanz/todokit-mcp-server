import { z, type ZodType } from 'zod';

const IsoDateTimeSchema: ZodType<string> = z.iso.datetime({
  offset: true,
});

type Priority = 'low' | 'medium' | 'high';

const PrioritySchema: ZodType<Priority> = z.enum(['low', 'medium', 'high']);

const CategorySchema: ZodType<string> = z
  .string()
  .min(1)
  .max(50)
  .describe('Task category (e.g. work, bug, testing, docs)');

export interface Todo {
  id: string;
  description: string;
  completed: boolean;
  priority: Priority;
  category: string;
  dueAt?: string | undefined;
  createdAt: string;
  updatedAt?: string | undefined;
  completedAt?: string | undefined;
}

export const TodoSchema: ZodType<Todo> = z.strictObject({
  id: z.string(),
  description: z.string(),
  completed: z.boolean(),
  priority: PrioritySchema,
  category: CategorySchema,
  dueAt: IsoDateTimeSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
});

export const TodosSchema: ZodType<Todo[]> = z.array(TodoSchema);

type Status = 'pending' | 'completed' | 'all';

interface TodoInput {
  description: string;
  priority: Priority;
  category: string;
  dueAt?: string | undefined;
}

interface AddTodosInput {
  items: TodoInput[];
}

interface TodoByIdInput {
  id: string;
}

type DeleteTodoInput = TodoByIdInput;

type CompleteTodoInput = TodoByIdInput;

interface UpdateTodoInput {
  id: string;
  description?: string | undefined;
  priority?: Priority | undefined;
  category?: string | undefined;
  dueAt?: string | undefined;
}

interface ListTodosFilterInput {
  status?: Status | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

interface SearchTodosInput {
  query: string;
  status?: Status | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

const StatusSchema: ZodType<Status> = z.enum(['pending', 'completed', 'all']);
const PaginationLimitSchema: ZodType<number> = z
  .number()
  .int()
  .min(1)
  .max(100)
  .describe('Maximum number of items to return (1-100, default: 50)');
const PaginationCursorSchema: ZodType<string> = z
  .string()
  .min(1)
  .max(512)
  .describe('Opaque pagination cursor returned by a previous response');

const TodoInputSchema: ZodType<TodoInput> = z.strictObject({
  description: z.string().min(1).max(2000).describe('Description of the todo'),
  priority: PrioritySchema.describe('Task priority: low, medium, or high'),
  category: CategorySchema.describe(
    'Task category: work, bug, testing, or docs'
  ),
  dueAt: IsoDateTimeSchema.optional().describe(
    'Optional due date/time as an ISO 8601 timestamp with offset'
  ),
});

export const AddTodoSchema: ZodType<TodoInput> = TodoInputSchema;

export const AddTodosSchema: ZodType<AddTodosInput> = z.strictObject({
  items: z
    .array(TodoInputSchema)
    .min(1)
    .max(50)
    .describe('Todos to add in a single batch'),
});

const TodoByIdSchema: ZodType<TodoByIdInput> = z.strictObject({
  id: z.string().min(1).max(100).describe('The ID of the todo'),
});

export const DeleteTodoSchema: ZodType<DeleteTodoInput> = TodoByIdSchema;

export const CompleteTodoSchema: ZodType<CompleteTodoInput> = TodoByIdSchema;

export const UpdateTodoSchema: ZodType<UpdateTodoInput> = z.strictObject({
  id: z.string().min(1).max(100).describe('The ID of the todo to update'),
  description: z
    .string()
    .min(1)
    .max(2000)
    .optional()
    .describe('New description'),
  priority: PrioritySchema.optional().describe(
    'New priority: low, medium, or high'
  ),
  category: CategorySchema.optional().describe(
    'New category: work, bug, testing, or docs'
  ),
  dueAt: IsoDateTimeSchema.optional().describe(
    'Replace due date/time as an ISO 8601 timestamp with offset'
  ),
});

export const ListTodosFilterSchema: ZodType<ListTodosFilterInput> =
  z.strictObject({
    status: StatusSchema.optional().describe(
      'Filter by status: pending, completed, or all (default: pending). Results may be truncated for safety.'
    ),
    limit: PaginationLimitSchema.optional(),
    cursor: PaginationCursorSchema.optional(),
  });

export const SearchTodosSchema: ZodType<SearchTodosInput> = z.strictObject({
  query: z
    .string()
    .min(1)
    .max(100)
    .describe('Search query for description or category'),
  status: StatusSchema.optional().describe(
    'Filter matches by status: pending, completed, or all (default: pending).'
  ),
  limit: PaginationLimitSchema.optional(),
  cursor: PaginationCursorSchema.optional(),
});

const CountsSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
});

const NextActionsSchema = z.array(z.string().min(1).max(64)).min(1).max(10);

export const AddTodoOutputSchema = z.strictObject({
  ok: z.literal(true),
  result: z.strictObject({
    item: TodoSchema,
    summary: z.string(),
    nextActions: NextActionsSchema,
  }),
});

export const AddTodosOutputSchema = z.strictObject({
  ok: z.literal(true),
  result: z.strictObject({
    count: z.number().int().nonnegative(),
    ids: z.array(z.string()).max(50),
    summary: z.string(),
    nextActions: NextActionsSchema,
  }),
});

export const ListTodosOutputSchema = z.strictObject({
  ok: z.literal(true),
  result: z.strictObject({
    items: z.array(TodoSchema),
    summary: z.string(),
    counts: CountsSchema,
    filteredCounts: CountsSchema,
    status: StatusSchema,
    returned: z.number().int().nonnegative(),
    truncated: z.boolean(),
    remaining: z.number().int().nonnegative(),
    hint: z.string(),
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
    nextCursor: z.string().optional(),
  }),
});

export const UpdateTodoOutputSchema = z.strictObject({
  ok: z.literal(true),
  result: z.strictObject({
    item: TodoSchema,
    summary: z.string(),
    nextActions: NextActionsSchema,
  }),
});

export const CompleteTodoOutputSchema = z.strictObject({
  ok: z.literal(true),
  result: z.strictObject({
    item: TodoSchema,
    summary: z.string(),
    nextActions: NextActionsSchema,
  }),
});

export const DeleteTodoOutputSchema = z.strictObject({
  ok: z.literal(true),
  result: z.strictObject({
    deletedIds: z.array(z.string()).min(1),
    summary: z.string(),
    nextActions: NextActionsSchema,
  }),
});

export const SearchTodosOutputSchema = z.strictObject({
  ok: z.literal(true),
  result: z.strictObject({
    items: z.array(TodoSchema),
    query: z.string(),
    status: StatusSchema,
    summary: z.string(),
    returned: z.number().int().nonnegative(),
    totalMatches: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    hasMore: z.boolean(),
    nextCursor: z.string().optional(),
    nextActions: NextActionsSchema,
  }),
});

interface DefaultOutput {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string } | undefined;
}

export const DefaultOutputSchema: ZodType<DefaultOutput> = z.strictObject({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
});
