import { z } from 'zod';

export const DefaultOutputSchema = z
  .object({
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
  })
  .strict();
