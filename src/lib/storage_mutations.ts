import { createErrorResponse } from './errors.js';
import type { MatchOutcome } from './resolve.js';
import type { Todo } from './types.js';

export type TodoUpdate = Partial<Omit<Todo, 'id' | 'createdAt'>>;

export function createNotFoundOutcome(id: string): MatchOutcome {
  return {
    kind: 'error',
    response: createErrorResponse(
      'E_NOT_FOUND',
      `Todo with ID ${id} not found`
    ),
  };
}

export type CompleteTodoOutcome =
  | MatchOutcome
  | { kind: 'already'; todo: Todo };
