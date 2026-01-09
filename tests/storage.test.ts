import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  addTodos,
  deleteTodoBySelector,
  getTodos,
  normalizeTags,
  updateTodoBySelector,
} from '../src/storage.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

describe('storage', { timeout: TEST_TIMEOUT_MS }, () => {
  it('generates uuid-like ids', async () => {
    const [todo] = await addTodos([{ title: 'ID Check' }]);
    assert.ok(todo);
    assert.match(todo.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('normalizes tags', () => {
    assert.deepEqual(normalizeTags([' Work ', 'work', '', 'Home']), [
      'work',
      'home',
    ]);
  });

  it('adds todos and filters by fields', async () => {
    const [todoA, todoB] = await addTodos([
      {
        title: 'Alpha',
        description: 'Alpha desc',
        priority: 'high',
        dueDate: '2025-01-10',
        tags: ['Work'],
      },
      {
        title: 'Beta',
        priority: 'low',
        dueDate: '2025-01-05',
        tags: ['Home'],
      },
      { title: 'Gamma', priority: 'normal' },
    ]);
    assert.ok(todoA);
    assert.ok(todoB);

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
    const [todo] = await addTodos([{ title: 'Delta' }]);
    assert.ok(todo);

    const completed = await updateTodoBySelector({ id: todo.id }, () => ({
      completed: true,
    }));
    assert.equal(completed.kind, 'match');
    if (completed.kind !== 'match') {
      throw new Error('Expected todo match');
    }
    assert.equal(completed.todo.completed, true);
    assert.ok(completed.todo.completedAt);

    const reopened = await updateTodoBySelector({ id: todo.id }, () => ({
      completed: false,
    }));
    assert.equal(reopened.kind, 'match');
    if (reopened.kind !== 'match') {
      throw new Error('Expected todo match');
    }
    assert.equal(reopened.todo.completed, false);
    assert.equal(reopened.todo.completedAt, undefined);

    const tagged = await updateTodoBySelector({ id: todo.id }, () => ({
      tags: [' New ', 'NEW'],
    }));
    assert.equal(tagged.kind, 'match');
    if (tagged.kind !== 'match') {
      throw new Error('Expected todo match');
    }
    assert.deepEqual(tagged.todo.tags, ['new']);
  });

  it('deletes todos', async () => {
    const [todo] = await addTodos([{ title: 'Epsilon' }]);
    assert.ok(todo);
    const deleted = await deleteTodoBySelector({ id: todo.id });
    assert.equal(deleted.kind, 'match');

    const missing = await deleteTodoBySelector({ id: 'missing' });
    assert.equal(missing.kind, 'error');

    const remaining = await getTodos();
    assert.equal(remaining.length, 0);
  });

  it('serializes concurrent writes', async () => {
    const count = 25;
    const titles = Array.from({ length: count }, (_, index) => `Task ${index}`);
    await Promise.all(titles.map((title) => addTodos([{ title }])));
    const todos = await getTodos();
    assert.equal(todos.length, count);
  });
});
