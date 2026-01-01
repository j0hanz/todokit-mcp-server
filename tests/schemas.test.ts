import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TodosSchema } from '../src/lib/types.js';
import {
  AddTodoSchema,
  DeleteTodoSchema,
  UpdateTodoSchema,
} from '../src/schemas/inputs.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

describe('schemas', { timeout: TEST_TIMEOUT_MS }, () => {
  it('rejects unknown fields on add', () => {
    const result = AddTodoSchema.safeParse({ title: 'Test', extra: 'nope' });
    assert.equal(result.success, false);
  });

  it('rejects unknown fields on nested tagOps', () => {
    const result = UpdateTodoSchema.safeParse({
      id: '1',
      tagOps: { add: ['tag'], extra: 'nope' },
    });
    assert.equal(result.success, false);
  });

  it('rejects empty delete payload', () => {
    const result = DeleteTodoSchema.safeParse({});
    assert.equal(result.success, false);
  });

  it('rejects invalid timestamps in todos', () => {
    const result = TodosSchema.safeParse([
      {
        id: '1',
        title: 'Bad timestamp',
        completed: false,
        priority: 'normal',
        tags: [],
        createdAt: 'not-iso',
      },
    ]);
    assert.equal(result.success, false);
  });
});
