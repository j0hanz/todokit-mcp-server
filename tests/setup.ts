import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'node:test';

let tempDir = '';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'todokit-test-'));
  process.env.TODOKIT_TODO_FILE = join(tempDir, 'todos.json');
});

afterEach(async () => {
  delete process.env.TODOKIT_TODO_FILE;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
  tempDir = '';
});
