import { z } from 'zod';

const IsoDateTimeSchema = z.iso.datetime({ offset: true });

// -----------------------------
// Domain enums (single source)
// -----------------------------

const PRIORITY_VALUES = ['low', 'medium', 'high'] as const;
type Priority = (typeof PRIORITY_VALUES)[number];
const PrioritySchema = z.enum(PRIORITY_VALUES);

const CATEGORY_VALUES = ['work', 'bug', 'testing', 'docs'] as const;
type Category = (typeof CATEGORY_VALUES)[number];
const CategorySchema = z.enum(CATEGORY_VALUES);

const STATUS_VALUES = ['pending', 'completed', 'all'] as const;
const StatusSchema = z.enum(STATUS_VALUES);

// -----------------------------
// Domain model
// -----------------------------

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

const TodoSchema = z.strictObject({
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

export const TodosSchema = z.array(TodoSchema);

// -----------------------------
// Tool inputs
// -----------------------------

const TodoInputSchema = z.strictObject({
  description: z.string().min(1).max(2000).describe('Description of the todo'),
  priority: PrioritySchema.describe('Task priority: low, medium, or high'),
  category: CategorySchema.describe(
    'Task category: work, bug, testing, or docs'
  ),
  dueAt: IsoDateTimeSchema.optional().describe(
    'Optional due date/time as an ISO 8601 timestamp with offset'
  ),
});

export const AddTodoSchema = TodoInputSchema;

export const AddTodosSchema = z.strictObject({
  items: z
    .array(TodoInputSchema)
    .min(1)
    .max(50)
    .describe('Todos to add in a single batch'),
});

const TodoIdBaseSchema = z.string().min(1).max(100);

const TodoByIdSchema = z.strictObject({
  id: TodoIdBaseSchema.describe('The ID of the todo'),
});

export const DeleteTodoSchema = TodoByIdSchema;
export const CompleteTodoSchema = TodoByIdSchema;

export const UpdateTodoSchema = z.strictObject({
  id: TodoIdBaseSchema.describe('The ID of the todo to update'),
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

export const ListTodosFilterSchema = z.strictObject({
  status: StatusSchema.optional().describe(
    'Filter by status: pending, completed, or all (default: pending). Results may be truncated for safety.'
  ),
});

// -----------------------------
// Default output (tool results)
// -----------------------------

export const DefaultOutputSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    result: z.unknown().optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    error: z.strictObject({ code: z.string(), message: z.string() }),
    result: z.unknown().optional(),
  }),
]);
