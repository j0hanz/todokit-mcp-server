import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'node:test';

import { closeDb } from '../src/storage.js';

let tempDir = '';

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'todokit-test-'));
  process.env.TODOKIT_TODO_FILE = join(tempDir, 'todos.json');
  process.env.TODOKIT_ALLOW_OUTSIDE_CWD = 'true';
});

afterEach(async () => {
  await closeDb();
  delete process.env.TODOKIT_TODO_FILE;
  delete process.env.TODOKIT_ALLOW_OUTSIDE_CWD;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
  tempDir = '';
});
