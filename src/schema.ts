import { z, type ZodType } from 'zod';

const IsoDateTimeSchema: ZodType<string> = z.iso.datetime({
  offset: true,
});

type Priority = 'low' | 'medium' | 'high';

const PrioritySchema: ZodType<Priority> = z.enum(['low', 'medium', 'high']);

type Category = 'work' | 'bug' | 'testing' | 'docs';

const CategorySchema: ZodType<Category> = z.enum([
  'work',
  'bug',
  'testing',
  'docs',
]);

export interface Todo {
  id: string;
  description: string;
  completed: boolean;
  priority: Priority;
  category: Category;
  dueAt?: string | undefined;
  createdAt: string;
  updatedAt?: string | undefined;
  completedAt?: string | undefined;
}

const TodoSchema: ZodType<Todo> = z.strictObject({
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
  category: Category;
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
  category?: Category | undefined;
  dueAt?: string | undefined;
}

interface ListTodosFilterInput {
  status?: Status | undefined;
}

const StatusSchema: ZodType<Status> = z.enum(['pending', 'completed', 'all']);

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
  });

type DefaultOutput =
  | { ok: true; result?: unknown }
  | {
      ok: false;
      error: { code: string; message: string };
      result?: unknown;
    };

export const DefaultOutputSchema: ZodType<DefaultOutput> = z.discriminatedUnion(
  'ok',
  [
    z.strictObject({
      ok: z.literal(true),
      result: z.unknown().optional(),
    }),
    z.strictObject({
      ok: z.literal(false),
      error: z.strictObject({ code: z.string(), message: z.string() }),
      result: z.unknown().optional(),
    }),
  ]
);
