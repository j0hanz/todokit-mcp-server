import { z, type ZodType } from 'zod';

import { IsoDateSchema, IsoDateTimeSchema } from '../schemas/iso_date.js';

export interface Todo {
  id: string;
  title: string;
  description?: string | undefined;
  completed: boolean;
  priority: 'low' | 'normal' | 'high';
  dueDate?: string | undefined;
  tags: string[];
  createdAt: string;
  updatedAt?: string | undefined;
  completedAt?: string | undefined;
}

const TodoSchema: ZodType<Todo> = z.strictObject({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  completed: z.boolean(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  dueDate: IsoDateSchema.optional(),
  tags: z.array(z.string()).default([]),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema.optional(),
  completedAt: IsoDateTimeSchema.optional(),
});

export const TodosSchema: ZodType<Todo[]> = z.array(TodoSchema);
