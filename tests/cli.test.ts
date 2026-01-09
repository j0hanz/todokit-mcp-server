import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseCliArgs } from '../src/index.js';

const TEST_TIMEOUT_MS = 5000;

describe('cli', { timeout: TEST_TIMEOUT_MS }, () => {
  it('parses known flags and ignores unknown flags', () => {
    const result = parseCliArgs([
      'node',
      'dist/index.js',
      '--todo-file',
      'todos.json',
      '--diagnostics',
      '--unknown-flag',
      'x',
    ]);

    assert.equal(result.todoFile, 'todos.json');
    assert.equal(result.diagnostics, true);
    assert.equal(result.logLevel, 'info');
  });

  it('validates log level', () => {
    const result = parseCliArgs([
      'node',
      'dist/index.js',
      '--log-level',
      'debug',
    ]);
    assert.equal(result.logLevel, 'debug');

    const invalid = parseCliArgs([
      'node',
      'dist/index.js',
      '--log-level',
      'nope',
    ]);
    assert.equal(invalid.logLevel, 'info');
  });

  it('returns defaults when argv is invalid', () => {
    const result = parseCliArgs(null as unknown as string[]);
    assert.equal(result.todoFile, undefined);
    assert.equal(result.diagnostics, false);
    assert.equal(result.logLevel, 'info');
  });
});
