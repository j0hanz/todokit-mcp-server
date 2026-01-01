import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  type ResolveTodoInput,
  resolveTodoTargetFromTodos,
  toResolveInput,
} from '../src/lib/resolve.js';
import { addTodo, getTodos } from '../src/lib/storage.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

async function resolveTodoTarget(input: ResolveTodoInput) {
  const todos = await getTodos();
  return resolveTodoTargetFromTodos(todos, input);
}

describe('match resolution', { timeout: TEST_TIMEOUT_MS }, () => {
  it('throws when no identifier provided', () => {
    assert.throws(() => toResolveInput({}), /Provide id or query/);
  });

  it('resolves by id', async () => {
    const todo = await addTodo('Match A');
    const result = await resolveTodoTarget({ id: todo.id });
    assert.equal(result.kind, 'match');
    if (result.kind === 'match') {
      assert.equal(result.todo.id, todo.id);
    }
  });

  it('returns not_found for missing query', async () => {
    const result = await resolveTodoTarget({ query: 'missing-query' });
    assert.equal(result.kind, 'not_found');
    if (result.kind === 'not_found') {
      assert.equal(result.response.structuredContent.error.code, 'E_NOT_FOUND');
    }
  });

  it('returns ambiguous for multiple matches', async () => {
    await addTodo('Shared Task');
    await addTodo('Shared Task Two');

    const result = await resolveTodoTarget({ query: 'Shared' });
    assert.equal(result.kind, 'ambiguous');
    if (result.kind === 'ambiguous') {
      assert.equal(result.response.structuredContent.error.code, 'E_AMBIGUOUS');
      assert.ok(result.previews.length > 0);
    }
  });
});
