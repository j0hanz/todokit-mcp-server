import {
  type core,
  z,
  type ZodNever,
  type ZodObject,
  type ZodOptional,
  type ZodString,
  type ZodType,
} from 'zod';

import { IsoDateSchema } from './iso_date.js';

type Priority = 'low' | 'normal' | 'high';
type Status = 'pending' | 'completed' | 'all';
type SortBy = 'dueDate' | 'priority' | 'createdAt' | 'title';
type SortOrder = 'asc' | 'desc';
type ClearField = 'description' | 'dueDate' | 'tags';

interface TodoInput {
  title: string;
  description?: string | undefined;
  priority?: Priority | undefined;
  dueDate?: string | undefined;
  tags?: string[] | undefined;
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

interface TagOpsInput {
  add?: string[] | undefined;
  remove?: string[] | undefined;
}

interface UpdateTodoFieldsInput {
  title?: string | undefined;
  description?: string | undefined;
  completed?: boolean | undefined;
  priority?: Priority | undefined;
  dueDate?: string | undefined;
  tags?: string[] | undefined;
  clearFields?: ClearField[] | undefined;
  tagOps?: TagOpsInput | undefined;
}

type UpdateTodoInput = (SelectorById | SelectorByQuery) & UpdateTodoFieldsInput;

interface ListTodosFilterInput {
  completed?: boolean | undefined;
  status?: Status | undefined;
  query?: string | undefined;
  priority?: Priority | undefined;
  tag?: string | undefined;
  dueBefore?: string | undefined;
  dueAfter?: string | undefined;
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

const TagSchema = z.string().min(1).max(50);
const SortBySchema: ZodType<SortBy> = z.enum([
  'dueDate',
  'priority',
  'createdAt',
  'title',
]);
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
  description: z
    .string()
    .max(2000)
    .optional()
    .describe('Optional description of the todo'),
  priority: z
    .enum(['low', 'normal', 'high'])
    .optional()
    .describe('Priority level (default: normal)'),
  dueDate: IsoDateSchema.optional().describe(
    'Due date in ISO format (YYYY-MM-DD)'
  ),
  tags: z
    .array(TagSchema)
    .max(50)
    .optional()
    .describe('Tags for categorization'),
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

export const DeleteTodoSchema: ZodType<DeleteTodoInput> = z.union([
  deleteTodoSelector.byId.extend({
    dryRun: z
      .boolean()
      .optional()
      .describe('Simulate the deletion without changing data'),
  }),
  deleteTodoSelector.byQuery.extend({
    dryRun: z
      .boolean()
      .optional()
      .describe('Simulate the deletion without changing data'),
  }),
]);

const completeTodoSelector = buildSelectorSchemas(
  'The ID of the todo to complete',
  'Search text to find a single todo to complete'
);

export const CompleteTodoSchema: ZodType<CompleteTodoInput> = z.union([
  completeTodoSelector.byId.extend({
    completed: z
      .boolean()
      .optional()
      .describe('Set completion status (default: true)'),
  }),
  completeTodoSelector.byQuery.extend({
    completed: z
      .boolean()
      .optional()
      .describe('Set completion status (default: true)'),
  }),
]);

const TagOpsSchema: ZodType<TagOpsInput> = z.strictObject({
  add: z.array(TagSchema).max(50).optional().describe('Tags to add'),
  remove: z.array(TagSchema).max(50).optional().describe('Tags to remove'),
});

const updateTodoSelector = buildSelectorSchemas(
  'The ID of the todo to update',
  'Search text to find a single todo to update'
);

const UpdateTodoFieldsSchema = {
  title: z.string().min(1).max(200).optional().describe('New title'),
  description: z.string().max(2000).optional().describe('New description'),
  completed: z.boolean().optional().describe('Completion status'),
  priority: z
    .enum(['low', 'normal', 'high'])
    .optional()
    .describe('New priority level'),
  dueDate: IsoDateSchema.optional().describe('New due date (ISO format)'),
  tags: z.array(TagSchema).max(50).optional().describe('New tags'),
  clearFields: z
    .array(z.enum(['description', 'dueDate', 'tags']))
    .max(3)
    .optional()
    .describe('Fields to clear'),
  tagOps: TagOpsSchema.optional().describe('Tag modifications to apply'),
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
    status: z
      .enum(['pending', 'completed', 'all'])
      .optional()
      .describe('Filter by status'),
    query: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Search text in title, description, or tags'),
    priority: z
      .enum(['low', 'normal', 'high'])
      .optional()
      .describe('Filter by priority level'),
    tag: TagSchema.optional().describe('Filter by tag (must contain)'),
    dueBefore: IsoDateSchema.optional().describe(
      'Filter todos due before this date (ISO format)'
    ),
    dueAfter: IsoDateSchema.optional().describe(
      'Filter todos due after this date (ISO format)'
    ),
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
