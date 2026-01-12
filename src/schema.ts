import { z, type ZodType } from 'zod';

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

interface IsoDateParts {
  year: number;
  month: number;
  day: number;
}

function parseIsoDateParts(value: string): IsoDateParts | null {
  const match = ISO_DATE_REGEX.exec(value);
  if (!match) return null;
  const [, yearPart, monthPart, dayPart] = match;
  return {
    year: Number(yearPart),
    month: Number(monthPart),
    day: Number(dayPart),
  };
}

function isMatchingUtcDate({ year, month, day }: IsoDateParts): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  const actual = [
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  ];
  const expected = [year, month, day];
  return expected.every((value, index) => value === actual[index]);
}

function isValidIsoDate(value: string): boolean {
  const parts = parseIsoDateParts(value);
  if (!parts) return false;
  return isMatchingUtcDate(parts);
}

export const IsoDateSchema: ZodType<string> = z
  .string()
  .refine((value) => isValidIsoDate(value), {
    error: 'Invalid date (YYYY-MM-DD)',
  });

export const IsoDateTimeSchema: ZodType<string> = z.iso.datetime({
  offset: true,
});

type Priority = 'low' | 'medium' | 'high';

export const PrioritySchema: ZodType<Priority> = z.enum([
  'low',
  'medium',
  'high',
]);

export interface Todo {
  id: string;
  description: string;
  completed: boolean;
  priority?: Priority | undefined;
  tags?: string[] | undefined;
  dueAt?: string | undefined;
  createdAt: string;
  updatedAt?: string | undefined;
  completedAt?: string | undefined;
}

export const TodoSchema: ZodType<Todo> = z.strictObject({
  id: z.string(),
  description: z.string(),
  completed: z.boolean(),
  priority: PrioritySchema.optional(),
  tags: z.array(z.string().min(1).max(50)).max(50).optional(),
  dueAt: IsoDateTimeSchema.optional(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
});

export const TodosSchema: ZodType<Todo[]> = z.array(TodoSchema);

type Status = 'pending' | 'completed' | 'all';

interface TodoInput {
  description: string;
  priority?: Priority | undefined;
  tags?: string[] | undefined;
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
  tags?: string[] | undefined;
  dueAt?: string | undefined;
}

interface ListTodosFilterInput {
  status?: Status | undefined;
}

export const StatusSchema: ZodType<Status> = z.enum([
  'pending',
  'completed',
  'all',
]);

const TodoInputSchema: ZodType<TodoInput> = z.strictObject({
  description: z.string().min(1).max(2000).describe('Description of the todo'),
  priority: PrioritySchema.optional().describe(
    'Task priority: low, medium, or high'
  ),
  tags: z
    .array(z.string().min(1).max(50))
    .max(50)
    .optional()
    .describe('Optional tags for grouping (e.g., ["work", "bug"])'),
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
  tags: z
    .array(z.string().min(1).max(50))
    .max(50)
    .optional()
    .describe('Replace tags for this todo'),
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
