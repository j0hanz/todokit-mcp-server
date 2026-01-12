import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AddTodoSchema,
  DefaultOutputSchema,
  DeleteTodoSchema,
  TodosSchema,
  UpdateTodoSchema,
} from '../src/schema.js';
import './setup.js';

const TEST_TIMEOUT_MS = 5000;

describe('schemas', { timeout: TEST_TIMEOUT_MS }, () => {
  it('rejects unknown fields on add', () => {
    const result = AddTodoSchema.safeParse({
      description: 'Test desc',
      extra: 'nope',
    });
    assert.equal(result.success, false);
  });

  it('rejects unknown fields on update', () => {
    const result = UpdateTodoSchema.safeParse({
      id: '1',
      extra: 'nope',
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
        description: 'Bad timestamp',
        completed: false,
        createdAt: 'not-iso',
      },
    ]);
    assert.equal(result.success, false);
  });

  it('rejects unknown fields in persisted todos', () => {
    const result = TodosSchema.safeParse([
      {
        id: '1',
        description: 'Extra field',
        completed: false,
        createdAt: '2025-02-28T10:30:00Z',
        extra: 'nope',
      },
    ]);
    assert.equal(result.success, false);
  });

  it('rejects unknown fields in output error shape', () => {
    const result = DefaultOutputSchema.safeParse({
      ok: false,
      error: { code: 'E_TEST', message: 'Test', extra: 'nope' },
    });
    assert.equal(result.success, false);
  });

  it('validates ISO datetime strings with offset', () => {
    assert.equal(
      AddTodoSchema.safeParse({
        description: 'Has due date',
        dueAt: '2025-02-28T10:30:00Z',
      }).success,
      true
    );
    assert.equal(
      AddTodoSchema.safeParse({
        description: 'Bad due date',
        dueAt: '2025-02-28 10:30:00Z',
      }).success,
      false
    );
  });
});
