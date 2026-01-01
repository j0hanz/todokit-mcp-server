import { createErrorResponse, type ErrorResponse } from './errors.js';
import { filterTodos } from './storage_filters.js';
import type { Todo } from './types.js';

export interface TodoMatchPreview {
  id: string;
  title: string;
  priority: Todo['priority'];
  dueDate?: string;
  completed: boolean;
}

const PREVIEW_LIMIT = 5;

function buildMatchPreviews(
  todos: Todo[],
  limit: number = PREVIEW_LIMIT
): TodoMatchPreview[] {
  return todos.slice(0, limit).map((todo) => ({
    id: todo.id,
    title: todo.title,
    priority: todo.priority,
    completed: todo.completed,
    ...(todo.dueDate === undefined ? {} : { dueDate: todo.dueDate }),
  }));
}

export type ResolveTodoInput =
  | { id: string; query?: never }
  | { query: string; id?: never };

export function toResolveInput(input: {
  id?: string;
  query?: string;
}): ResolveTodoInput {
  if (input.id) {
    return { id: input.id };
  }
  if (input.query) {
    return { query: input.query };
  }
  throw new Error('Provide id or query to identify the todo');
}

export type ResolveTodoResult =
  | { kind: 'match'; todo: Todo }
  | { kind: 'missing'; response: ErrorResponse }
  | { kind: 'not_found'; response: ErrorResponse }
  | {
      kind: 'ambiguous';
      response: ErrorResponse;
      matches: Todo[];
      previews: TodoMatchPreview[];
      query: string;
    };

export type MatchOutcome =
  | { kind: 'match'; todo: Todo }
  | {
      kind: 'ambiguous';
      response: ErrorResponse;
      matches: Todo[];
      previews: TodoMatchPreview[];
      query: string;
    }
  | { kind: 'error'; response: ErrorResponse };

export function unwrapResolution(result: ResolveTodoResult): MatchOutcome {
  if (result.kind === 'match') {
    return result;
  }
  if (result.kind === 'ambiguous') {
    return result;
  }
  return { kind: 'error', response: result.response };
}

function createMissingIdentifierError(): ErrorResponse {
  return createErrorResponse(
    'E_BAD_REQUEST',
    'Provide id or query to identify the todo'
  );
}

function createNotFoundError(target: string): ErrorResponse {
  return createErrorResponse('E_NOT_FOUND', `Todo "${target}" not found`);
}

function createAmbiguousError(
  query: string,
  matches: Todo[]
): { response: ErrorResponse; previews: TodoMatchPreview[] } {
  const previews = buildMatchPreviews(matches);
  const response = createErrorResponse(
    'E_AMBIGUOUS',
    `Multiple todos match "${query}"`,
    {
      matches: previews,
      totalMatches: matches.length,
      hint: `Multiple todos match "${query}". Use id for an exact match.`,
    }
  );
  return { response, previews };
}

function resolveByIdFromTodos(todos: Todo[], id: string): ResolveTodoResult {
  const match = todos.find((todo) => todo.id === id);
  if (!match) {
    return { kind: 'not_found', response: createNotFoundError(id) };
  }
  return { kind: 'match', todo: match };
}

function resolveByQueryFromTodos(
  todos: Todo[],
  query: string
): ResolveTodoResult {
  const trimmedQuery = query.trim();
  if (trimmedQuery.length === 0) {
    return { kind: 'missing', response: createMissingIdentifierError() };
  }
  const matches = filterTodos(todos, { query: trimmedQuery });
  return resolveQueryMatches(trimmedQuery, matches);
}

function resolveQueryMatches(
  query: string,
  matches: Todo[]
): ResolveTodoResult {
  const [firstMatch] = matches;
  if (matches.length === 1 && firstMatch) {
    return { kind: 'match', todo: firstMatch };
  }
  if (matches.length === 0) {
    return { kind: 'not_found', response: createNotFoundError(query) };
  }
  const { response, previews } = createAmbiguousError(query, matches);
  return {
    kind: 'ambiguous',
    response,
    matches,
    previews,
    query,
  };
}

export function resolveTodoTargetFromTodos(
  todos: Todo[],
  input: ResolveTodoInput
): ResolveTodoResult {
  if (input.id !== undefined) {
    return resolveByIdFromTodos(todos, input.id);
  }
  return resolveByQueryFromTodos(todos, input.query);
}
