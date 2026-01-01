import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  addTodo,
  deleteTodo,
  getTodos,
  normalizeTags,
  updateTodo,
} from '../src/lib/storage.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

describe('storage', { timeout: TEST_TIMEOUT_MS }, () => {
  it('normalizes tags', () => {
    assert.deepEqual(normalizeTags([' Work ', 'work', '', 'Home']), [
      'work',
      'home',
    ]);
  });

  it('adds todos and filters by fields', async () => {
    const todoA = await addTodo('Alpha', 'Alpha desc', 'high', '2025-01-10', [
      'Work',
    ]);
    const todoB = await addTodo('Beta', undefined, 'low', '2025-01-05', [
      'Home',
    ]);
    await addTodo('Gamma', undefined, 'normal');

    const byTag = await getTodos({ tag: 'work' });
    assert.deepEqual(
      byTag.map((todo) => todo.id),
      [todoA.id]
    );

    const dueBefore = await getTodos({ dueBefore: '2025-01-08' });
    assert.deepEqual(
      dueBefore.map((todo) => todo.id),
      [todoB.id]
    );

    const dueAfter = await getTodos({ dueAfter: '2025-01-08' });
    assert.deepEqual(
      dueAfter.map((todo) => todo.id),
      [todoA.id]
    );

    const byQuery = await getTodos({ query: 'alpha desc' });
    assert.deepEqual(
      byQuery.map((todo) => todo.id),
      [todoA.id]
    );
  });

  it('updates todo completion and tags', async () => {
    const todo = await addTodo('Delta');

    const completed = await updateTodo(todo.id, { completed: true });
    assert.equal(completed?.completed, true);
    assert.ok(completed?.completedAt);

    const reopened = await updateTodo(todo.id, { completed: false });
    assert.equal(reopened?.completed, false);
    assert.equal(reopened?.completedAt, undefined);

    const tagged = await updateTodo(todo.id, { tags: [' New ', 'NEW'] });
    assert.deepEqual(tagged?.tags, ['new']);
  });

  it('deletes todos', async () => {
    const todo = await addTodo('Epsilon');
    const deleted = await deleteTodo(todo.id);
    assert.equal(deleted, true);

    const missing = await deleteTodo('missing');
    assert.equal(missing, false);

    const remaining = await getTodos();
    assert.equal(remaining.length, 0);
  });
});
