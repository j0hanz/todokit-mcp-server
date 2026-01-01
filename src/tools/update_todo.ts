import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { z } from 'zod';

import { createErrorResponse, getErrorMessage } from '../lib/errors.js';
import { toResolveInput } from '../lib/resolve.js';
import { normalizeTags, updateTodoBySelector } from '../lib/storage.js';
import { createToolResponse } from '../lib/tool_response.js';
import type { Todo } from '../lib/types.js';
import { UpdateTodoSchema } from '../schemas/inputs.js';
import { DefaultOutputSchema } from '../schemas/outputs.js';

type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>;
type TagOps = UpdateTodoInput['tagOps'];
type UpdateFields = Omit<
  UpdateTodoInput,
  'id' | 'query' | 'clearFields' | 'tagOps'
>;

type ClearField = NonNullable<UpdateTodoInput['clearFields']>[number];

function applyClearFields(
  updates: UpdateFields,
  fieldsToClear: Set<ClearField>
): void {
  if (fieldsToClear.has('description')) {
    updates.description = undefined;
  }
  if (fieldsToClear.has('dueDate')) {
    updates.dueDate = undefined;
  }
}

function countTags(tags?: string[]): number {
  return tags ? tags.length : 0;
}

function hasTagOps(tagOps?: TagOps): boolean {
  return countTags(tagOps?.add) > 0 || countTags(tagOps?.remove) > 0;
}

function shouldApplyTagUpdates(
  updates: UpdateFields,
  fieldsToClear: Set<ClearField>,
  tagOps?: TagOps
): boolean {
  if (updates.tags !== undefined) return false;
  return fieldsToClear.has('tags') || hasTagOps(tagOps);
}

function resolveBaseTags(
  baseTodo: Todo,
  fieldsToClear: Set<ClearField>
): string[] {
  if (fieldsToClear.has('tags')) {
    return [];
  }
  return baseTodo.tags;
}

function safeTagList(tags?: string[]): string[] {
  return tags ?? [];
}

function buildMergedTags(
  baseTodo: Todo,
  fieldsToClear: Set<ClearField>,
  tagOps?: TagOps
): string[] {
  const baseTags = resolveBaseTags(baseTodo, fieldsToClear);
  const addTags = normalizeTags(safeTagList(tagOps?.add));
  const removeTags = new Set(normalizeTags(safeTagList(tagOps?.remove)));
  return normalizeTags([...baseTags, ...addTags]).filter(
    (tag) => !removeTags.has(tag)
  );
}

function applyTagUpdates(
  updates: UpdateFields,
  baseTodo: Todo,
  fieldsToClear: Set<ClearField>,
  tagOps?: TagOps
): void {
  if (!shouldApplyTagUpdates(updates, fieldsToClear, tagOps)) return;
  updates.tags = buildMergedTags(baseTodo, fieldsToClear, tagOps);
}

function assignIfDefined<K extends keyof UpdateFields>(
  updates: UpdateFields,
  key: K,
  value: UpdateFields[K]
): void {
  if (value !== undefined) {
    updates[key] = value;
  }
}

function buildBaseUpdates(input: UpdateTodoInput): UpdateFields {
  const updates: UpdateFields = {};
  assignIfDefined(updates, 'title', input.title);
  assignIfDefined(updates, 'description', input.description);
  assignIfDefined(updates, 'completed', input.completed);
  assignIfDefined(updates, 'priority', input.priority);
  assignIfDefined(updates, 'dueDate', input.dueDate);
  assignIfDefined(updates, 'tags', input.tags);
  return updates;
}

function buildUpdatePayload(
  baseTodo: Todo,
  input: UpdateTodoInput
): UpdateFields | null {
  const { clearFields, tagOps } = input;
  const fieldsToClear = new Set<ClearField>(clearFields ?? []);
  const nextUpdates = buildBaseUpdates(input);

  applyClearFields(nextUpdates, fieldsToClear);
  applyTagUpdates(nextUpdates, baseTodo, fieldsToClear, tagOps);

  return Object.keys(nextUpdates).length > 0 ? nextUpdates : null;
}

async function handleUpdateTodo(
  input: UpdateTodoInput
): Promise<CallToolResult> {
  const outcome = await updateTodoBySelector(
    toResolveInput({ id: input.id, query: input.query }),
    (todo) => buildUpdatePayload(todo, input)
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
