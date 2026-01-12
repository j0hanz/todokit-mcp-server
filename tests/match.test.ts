import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { addTodos, deleteTodoById, updateTodoById } from '../src/storage.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

const DEFAULT_PRIORITY = 'medium' as const;
const DEFAULT_CATEGORY = 'work' as const;

describe('id-based matching', { timeout: TEST_TIMEOUT_MS }, () => {
  it('returns not_found when updating a missing id', async () => {
    const outcome = await updateTodoById('missing-id', () => ({
      description: 'will not apply',
    }));
    assert.equal(outcome.kind, 'error');
    if (outcome.kind === 'error') {
      assert.equal(
        outcome.response.structuredContent.error.code,
        'E_NOT_FOUND'
      );
    }
  });

  it('returns not_found when deleting a missing id', async () => {
    const outcome = await deleteTodoById('missing-id');
    assert.equal(outcome.kind, 'error');
    if (outcome.kind === 'error') {
      assert.equal(
        outcome.response.structuredContent.error.code,
        'E_NOT_FOUND'
      );
    }
  });

  it('updates and deletes an existing id', async () => {
    const [todo, extra] = await addTodos([
      {
        description: 'Match test todo',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Keep pending to avoid auto-delete',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);
    assert.ok(todo);
    assert.ok(extra);

    const updated = await updateTodoById(todo.id, () => ({
      description: 'Updated match test todo',
    }));
    assert.equal(updated.kind, 'match');

    const deleted = await deleteTodoById(todo.id);
    assert.equal(deleted.kind, 'match');
  });
});
