import {
  type core,
  z,
  type ZodNever,
  type ZodObject,
  type ZodOptional,
  type ZodString,
  type ZodType,
} from 'zod';

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

export interface Todo {
  id: string;
  title: string;
  description?: string | undefined;
  completed: boolean;
  createdAt: string;
  updatedAt?: string | undefined;
  completedAt?: string | undefined;
}

const TodoSchema: ZodType<Todo> = z.strictObject({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  completed: z.boolean(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
});

export const TodosSchema: ZodType<Todo[]> = z.array(TodoSchema);

type Status = 'pending' | 'completed' | 'all';
type SortBy = 'createdAt' | 'title';
type SortOrder = 'asc' | 'desc';
type ClearField = 'description';

interface TodoInput {
  title: string;
  description: string;
}

interface AddTodosInput {
  items: TodoInput[];
}

interface SelectorById {
  id: string;
  query?: undefined;
}

interface SelectorByQuery {
  query: string;
  id?: undefined;
}

type DeleteTodoInput = (SelectorById | SelectorByQuery) & {
  dryRun?: boolean | undefined;
};
type CompleteTodoInput = (SelectorById | SelectorByQuery) & {
  completed?: boolean | undefined;
};

interface UpdateTodoFieldsInput {
  title?: string | undefined;
  description?: string | undefined;
  completed?: boolean | undefined;
  clearFields?: ClearField[] | undefined;
}

type UpdateTodoInput = (SelectorById | SelectorByQuery) & UpdateTodoFieldsInput;

interface ListTodosFilterInput {
  completed?: boolean | undefined;
  status?: Status | undefined;
  query?: string | undefined;
  sortBy?: SortBy | undefined;
  order?: SortOrder | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

type SelectorByIdSchema = ZodObject<
  {
    id: ZodString;
    query: ZodOptional<ZodNever>;
  },
  core.$strict
>;
type SelectorByQuerySchema = ZodObject<
  {
    query: ZodString;
    id: ZodOptional<ZodNever>;
  },
  core.$strict
>;

interface SelectorSchemas {
  byId: SelectorByIdSchema;
  byQuery: SelectorByQuerySchema;
}

export const StatusSchema: ZodType<Status> = z.enum([
  'pending',
  'completed',
  'all',
]);
const ClearFieldSchema: ZodType<ClearField> = z.enum(['description']);
const SortBySchema: ZodType<SortBy> = z.enum(['createdAt', 'title']);
const SortOrderSchema: ZodType<SortOrder> = z.enum(['asc', 'desc']);

function buildSelectorSchemas(
  idDescription: string,
  queryDescription: string
): SelectorSchemas {
  return {
    byId: z.strictObject({
      id: z.string().min(1).max(100).describe(idDescription),
      query: z.never().optional(),
    }),
    byQuery: z.strictObject({
      query: z.string().min(1).max(200).describe(queryDescription),
      id: z.never().optional(),
    }),
  };
}
const TodoInputSchema: ZodType<TodoInput> = z.strictObject({
  title: z.string().min(1).max(200).describe('The title of the todo'),
  description: z.string().min(1).max(2000).describe('Description of the todo'),
});

export const AddTodoSchema: ZodType<TodoInput> = TodoInputSchema;

export const AddTodosSchema: ZodType<AddTodosInput> = z.strictObject({
  items: z
    .array(TodoInputSchema)
    .min(1)
    .max(50)
    .describe('Todos to add in a single batch'),
});

const deleteTodoSelector = buildSelectorSchemas(
  'The ID of the todo to delete',
  'Search text to find a single todo to delete'
);
const DeleteTodoFields = {
  dryRun: z
    .boolean()
    .optional()
    .describe('Simulate the deletion without changing data'),
};

export const DeleteTodoSchema: ZodType<DeleteTodoInput> = z.union([
  deleteTodoSelector.byId.extend(DeleteTodoFields),
  deleteTodoSelector.byQuery.extend(DeleteTodoFields),
]);

const completeTodoSelector = buildSelectorSchemas(
  'The ID of the todo to complete',
  'Search text to find a single todo to complete'
);
const CompleteTodoFields = {
  completed: z
    .boolean()
    .optional()
    .describe('Set completion status (default: true)'),
};

export const CompleteTodoSchema: ZodType<CompleteTodoInput> = z.union([
  completeTodoSelector.byId.extend(CompleteTodoFields),
  completeTodoSelector.byQuery.extend(CompleteTodoFields),
]);

const updateTodoSelector = buildSelectorSchemas(
  'The ID of the todo to update',
  'Search text to find a single todo to update'
);

const UpdateTodoFieldsSchema = {
  title: z.string().min(1).max(200).optional().describe('New title'),
  description: z.string().max(2000).optional().describe('New description'),
  completed: z.boolean().optional().describe('Completion status'),
  clearFields: z
    .array(ClearFieldSchema)
    .max(1)
    .optional()
    .describe('Fields to clear'),
};

export const UpdateTodoSchema: ZodType<UpdateTodoInput> = z.union([
  updateTodoSelector.byId.extend(UpdateTodoFieldsSchema),
  updateTodoSelector.byQuery.extend(UpdateTodoFieldsSchema),
]);

export const ListTodosFilterSchema: ZodType<ListTodosFilterInput> =
  z.strictObject({
    completed: z
      .boolean()
      .optional()
      .describe('Filter by completion status (deprecated; use status)'),
    status: StatusSchema.optional().describe('Filter by status'),
    query: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Search text in title or description'),
    sortBy: SortBySchema.optional().describe('Sort results by field'),
    order: SortOrderSchema.optional().describe('Sort order (default: asc)'),
    limit: z
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe('Max number of results to return (default: 50)'),
    offset: z
      .int()
      .min(0)
      .max(10000)
      .optional()
      .describe('Number of results to skip'),
  });

interface DefaultOutput {
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string } | undefined;
}

export const DefaultOutputSchema: ZodType<DefaultOutput> = z.strictObject({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});
