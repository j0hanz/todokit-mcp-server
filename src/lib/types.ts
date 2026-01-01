import { z } from 'zod';

import { IsoDateSchema } from '../schemas/iso_date.js';

const TodoSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  completed: z.boolean(),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  dueDate: IsoDateSchema.optional(),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
  completedAt: z.string().optional(),
});

export const TodosSchema = z.array(TodoSchema);

export type Todo = z.infer<typeof TodoSchema>;
