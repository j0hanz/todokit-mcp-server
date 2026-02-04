import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse, resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  addTodos,
  completeTodoById,
  deleteTodoById,
  getTodos,
  updateTodoById,
} from '../src/storage.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

const DEFAULT_PRIORITY = 'medium' as const;
const DEFAULT_CATEGORY = 'work' as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, { encoding: 'utf8' });
  } catch (error: unknown) {
    if (isRecord(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

describe('storage', { timeout: TEST_TIMEOUT_MS }, () => {
  it('generates uuid-like ids', async () => {
    const [todo] = await addTodos([
      {
        description: 'ID Check test',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);
    assert.ok(todo);
    assert.match(todo.id, /^[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('updates todo completion', async () => {
    const [todo, extra] = await addTodos([
      {
        description: 'Delta completion test',
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

    const completed = await updateTodoById(todo.id, () => ({
      completed: true,
    }));
    assert.equal(completed.kind, 'match');
    if (completed.kind !== 'match') {
      throw new Error('Expected todo match');
    }
    assert.equal(completed.todo.completed, true);
    assert.ok(completed.todo.completedAt);

    const reopened = await updateTodoById(todo.id, () => ({
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
    const [todo] = await addTodos([
      {
        description: 'Epsilon delete test',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);
    assert.ok(todo);
    const deleted = await deleteTodoById(todo.id);
    assert.equal(deleted.kind, 'match');

    const missing = await deleteTodoById('missing');
    assert.equal(missing.kind, 'error');

    const remaining = await getTodos();
    assert.equal(remaining.length, 0);
  });

  it('serializes concurrent writes', async () => {
    const count = 25;
    const items = Array.from({ length: count }, (_, index) => ({
      description: `Concurrent test item ${index}`,
      priority: DEFAULT_PRIORITY,
      category: DEFAULT_CATEGORY,
    }));
    await Promise.all(items.map((item) => addTodos([item])));
    const todos = await getTodos();
    assert.equal(todos.length, count);
  });

  it('rejects oversized todo storage files', async () => {
    const todoFile = process.env.TODOKIT_TODO_FILE;
    assert.ok(todoFile);

    const previous = process.env.TODOKIT_MAX_TODO_FILE_BYTES;
    process.env.TODOKIT_MAX_TODO_FILE_BYTES = '10';

    try {
      await writeFile(
        todoFile,
        JSON.stringify([{ id: 'x' }]) + 'x'.repeat(100),
        {
          encoding: 'utf8',
        }
      );

      await assert.rejects(
        () => getTodos(),
        (error: unknown) =>
          error instanceof Error &&
          (error as unknown as { code?: unknown }).code ===
            'E_STORAGE_TOO_LARGE'
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TODOKIT_MAX_TODO_FILE_BYTES;
      } else {
        process.env.TODOKIT_MAX_TODO_FILE_BYTES = previous;
      }
    }
  });

  it('rejects cross-drive todo paths when outside cwd is disallowed', async () => {
    if (process.platform !== 'win32') return;
    const root = parse(process.cwd()).root;
    const match = root.match(/^([A-Za-z]):\\$/);
    if (!match) return;

    const currentDrive = match[1]?.toUpperCase();
    const otherDrive = currentDrive === 'C' ? 'D' : 'C';

    delete process.env.TODOKIT_ALLOW_OUTSIDE_CWD;
    process.env.TODOKIT_TODO_FILE = `${otherDrive}:\\todokit-test\\todos.json`;

    await assert.rejects(
      () => getTodos(),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('within the current working directory')
    );
  });

  it('rejects symlinks pointing outside cwd', async (t) => {
    delete process.env.TODOKIT_ALLOW_OUTSIDE_CWD;

    // Create a secret file outside CWD
    const outsideDir = await mkdtemp(join(tmpdir(), 'todokit-secret-'));
    const secretFile = join(outsideDir, 'secret.json');
    await writeFile(secretFile, '[]', 'utf8');

    // Create a directory inside CWD
    const localDir = resolve('dist/tests/temp-storage');
    await mkdir(localDir, { recursive: true });

    // Create symlink: local -> outside
    const linkPath = join(localDir, 'todos-link.json');
    try {
      await symlink(secretFile, linkPath, 'file');
    } catch (e) {
      // Clean up before skipping
      await rm(outsideDir, { recursive: true, force: true });
      await rm(localDir, { recursive: true, force: true });

      if ((e as { code?: string }).code === 'EPERM') {
        t.skip('Skipping symlink test due to Windows EPERM');
        return;
      }
      throw e;
    }

    process.env.TODOKIT_TODO_FILE = linkPath;

    try {
      await assert.rejects(
        () => getTodos(),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes('within the current working directory')
      );
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
      await rm(localDir, { recursive: true, force: true });
    }
  });

  it('fails fast when a write lock is held', async () => {
    const todoFile = process.env.TODOKIT_TODO_FILE;
    assert.ok(todoFile);

    const previous = process.env.TODOKIT_LOCK_TIMEOUT_MS;
    process.env.TODOKIT_LOCK_TIMEOUT_MS = '50';

    try {
      await writeFile(`${todoFile}.lock`, 'locked', { encoding: 'utf8' });

      await assert.rejects(
        () =>
          addTodos([
            {
              description: 'Lock contention',
              priority: DEFAULT_PRIORITY,
              category: DEFAULT_CATEGORY,
            },
          ]),
        (error: unknown) =>
          error instanceof Error &&
          (error as unknown as { code?: unknown }).code ===
            'E_STORAGE_LOCK_TIMEOUT'
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TODOKIT_LOCK_TIMEOUT_MS;
      } else {
        process.env.TODOKIT_LOCK_TIMEOUT_MS = previous;
      }
    }
  });

  it('deletes the storage file when all todos are completed', async () => {
    const todoFile = process.env.TODOKIT_TODO_FILE;
    assert.ok(todoFile);

    const [first, second] = await addTodos([
      {
        description: 'Finish one',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
      {
        description: 'Finish two',
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
      },
    ]);
    assert.ok(first);
    assert.ok(second);

    await completeTodoById(first.id, true);
    const stillThere = await readTextIfExists(todoFile);
    assert.ok(stillThere);

    await completeTodoById(second.id, true);
    const deleted = await readTextIfExists(todoFile);
    assert.equal(deleted, null);

    const remaining = await getTodos();
    assert.equal(remaining.length, 0);
  });

  it('deletes the storage file on no-op completion when all todos are already completed', async () => {
    const todoFile = process.env.TODOKIT_TODO_FILE;
    assert.ok(todoFile);

    const now = new Date().toISOString();
    const persisted = [
      {
        id: 'completed-1',
        description: 'Already completed',
        completed: true,
        priority: DEFAULT_PRIORITY,
        category: DEFAULT_CATEGORY,
        createdAt: now,
        updatedAt: now,
        completedAt: now,
      },
    ];
    await writeFile(todoFile, JSON.stringify(persisted, null, 2) + '\n', {
      encoding: 'utf8',
    });

    const outcome = await completeTodoById('completed-1', true);
    assert.equal(outcome.kind, 'already');

    const deleted = await readTextIfExists(todoFile);
    assert.equal(deleted, null);
  });
});
