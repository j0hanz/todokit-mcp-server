import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

import {
  addTodos,
  deleteTodoBySelector,
  getTodos,
  readFileIfExists,
  updateTodoBySelector,
} from '../src/storage.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

describe('storage', { timeout: TEST_TIMEOUT_MS }, () => {
  it('generates uuid-like ids', async () => {
    const [todo] = await addTodos([{ description: 'ID Check test' }]);
    assert.ok(todo);
    assert.match(todo.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('adds todos and filters by query', async () => {
    const [todoA, todoB, todoC] = await addTodos([
      { description: 'Alpha description here' },
      { description: 'Beta description here' },
      { description: 'Gamma description here' },
    ]);
    assert.ok(todoA);
    assert.ok(todoB);
    assert.ok(todoC);

    const byQuery = await getTodos({ query: 'alpha' });
    assert.deepEqual(
      byQuery.map((todo) => todo.id),
      [todoA.id]
    );

    const byBeta = await getTodos({ query: 'beta' });
    assert.deepEqual(
      byBeta.map((todo) => todo.id),
      [todoB.id]
    );
  });

  it('updates todo completion', async () => {
    const [todo] = await addTodos([{ description: 'Delta completion test' }]);
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
  });

  it('deletes todos', async () => {
    const [todo] = await addTodos([{ description: 'Epsilon delete test' }]);
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
    const items = Array.from({ length: count }, (_, index) => ({
      description: `Concurrent test item ${index}`,
    }));
    await Promise.all(items.map((item) => addTodos([item])));
    const todos = await getTodos();
    assert.equal(todos.length, count);
  });

  it('preserves AbortError semantics for aborted reads', async () => {
    const todoFile = process.env.TODOKIT_TODO_FILE;
    assert.ok(todoFile);

    await writeFile(todoFile, 'hello', { encoding: 'utf8' });
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => readFileIfExists(todoFile, 10_000, controller.signal),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'AbortError' &&
        !String(error.message).includes('File read timed out')
    );
  });

  it('maps internal timeouts to AbortError', async () => {
    const todoFile = process.env.TODOKIT_TODO_FILE;
    assert.ok(todoFile);

    const payload = 'a'.repeat(10_000_000);
    await writeFile(todoFile, payload, { encoding: 'utf8' });

    await assert.rejects(
      () => readFileIfExists(todoFile, 0),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'AbortError' &&
        String(error.message).includes('File read timed out')
    );
  });
});
