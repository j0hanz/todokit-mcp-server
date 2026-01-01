import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { toResolveInput } from '../lib/resolve.js';
import { normalizeTags, updateTodoBySelector } from '../lib/storage.js';
import type { TodoUpdate } from '../lib/storage_mutations.js';
import { createToolResponse } from '../lib/tool_response.js';
import type { Todo } from '../lib/types.js';
import { UpdateTodoSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';

type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>;
type UpdateFields = TodoUpdate;
type ClearField = NonNullable<UpdateTodoInput['clearFields']>[number];

function normalizeTagOps(tagOps: UpdateTodoInput['tagOps']): {
  add: string[];
  remove: Set<string>;
} {
  return {
    add: normalizeTags(tagOps?.add ?? []),
    remove: new Set(normalizeTags(tagOps?.remove ?? [])),
  };
}

function getTagOps(tagOps?: UpdateTodoInput['tagOps']): {
  add: string[];
  remove: Set<string>;
} | null {
  if (!tagOps) return null;
  const { add, remove } = normalizeTagOps(tagOps);
  if (add.length === 0 && remove.size === 0) return null;
  return { add, remove };
}

function mergeTags(
  current: string[],
  ops: { add: string[]; remove: Set<string> } | null
): string[] {
  const toAdd = ops?.add ?? [];
  const toRemove = ops?.remove ?? new Set();
  return normalizeTags([...current, ...toAdd]).filter((t) => !toRemove.has(t));
}

function resolveTags(
  baseTags: string[],
  clears: Set<ClearField>,
  tagOps?: UpdateTodoInput['tagOps'],
  newTags?: string[]
): string[] | undefined {
  if (newTags !== undefined) return newTags;

  const shouldClear = clears.has('tags');
  const ops = getTagOps(tagOps);

  if (!shouldClear && !ops) return undefined;
  return mergeTags(shouldClear ? [] : baseTags, ops);
}

function assignContentFields(
  updates: UpdateFields,
  fields: Omit<UpdateTodoInput, 'clearFields' | 'tagOps'>
): void {
  if (fields.title !== undefined) updates.title = fields.title;
  if (fields.description !== undefined)
    updates.description = fields.description;
}

function assignStatusFields(
  updates: UpdateFields,
  fields: Omit<UpdateTodoInput, 'clearFields' | 'tagOps'>
): void {
  if (fields.completed !== undefined) updates.completed = fields.completed;
  if (fields.priority !== undefined) updates.priority = fields.priority;
  if (fields.dueDate !== undefined) updates.dueDate = fields.dueDate;
}

function assignFields(
  updates: UpdateFields,
  fields: Omit<UpdateTodoInput, 'clearFields' | 'tagOps'>
): void {
  assignContentFields(updates, fields);
  assignStatusFields(updates, fields);
}

function applyClears(updates: UpdateFields, clears: Set<ClearField>): void {
  if (clears.has('description')) updates.description = undefined;
  if (clears.has('dueDate')) updates.dueDate = undefined;
}

function buildUpdatePayload(
  baseTodo: Todo,
  input: UpdateTodoInput
): UpdateFields | null {
  const { clearFields = [], tagOps, ...fields } = input;
  const clears = new Set(clearFields);
  const updates: UpdateFields = {};

  assignFields(updates, fields);
  applyClears(updates, clears);

  const resolvedTags = resolveTags(baseTodo.tags, clears, tagOps, fields.tags);
  if (resolvedTags !== undefined) updates.tags = resolvedTags;

  return Object.keys(updates).length > 0 ? updates : null;
}

async function handleUpdateTodo(
  input: UpdateTodoInput
): Promise<CallToolResult> {
  const selector =
    input.id !== undefined ? { id: input.id } : { query: input.query };
  const outcome = await updateTodoBySelector(toResolveInput(selector), (todo) =>
    buildUpdatePayload(todo, input)
  );
  if (outcome.kind === 'error' || outcome.kind === 'ambiguous') {
    return outcome.response;
  }
  if (outcome.kind === 'no_updates') {
    return createErrorResponse('E_BAD_REQUEST', 'No fields provided to update');
  }

  return createToolResponse({
    ok: true,
    result: {
      item: outcome.todo,
      summary: `Updated todo "${outcome.todo.title}"`,
      nextActions: ['list_todos', 'complete_todo'],
    },
  });
}

export function registerUpdateTodo(server: McpServer): void {
  server.registerTool(
    'update_todo',
    {
      title: 'Update Todo',
      description: 'Update fields on a todo item (supports search and tag ops)',
      inputSchema: UpdateTodoSchema,
      outputSchema: DefaultOutputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: true,
      },
    },
    async (input) => {
      try {
        return await handleUpdateTodo(input);
      } catch (err) {
        return createErrorResponse('E_UPDATE_TODO', getErrorMessage(err));
      }
    }
  );
}
