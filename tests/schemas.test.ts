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
      priority: 'medium',
      category: 'work',
      extra: 'nope',
    });
    assert.equal(result.success, false);
  });

  it('rejects missing required fields on add', () => {
    assert.equal(
      AddTodoSchema.safeParse({
        description: 'Missing priority',
        category: 'work',
      }).success,
      false
    );
    assert.equal(
      AddTodoSchema.safeParse({
        description: 'Missing category',
        priority: 'medium',
      }).success,
      false
    );
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
        priority: 'medium',
        category: 'work',
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
        priority: 'medium',
        category: 'work',
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

  it('rejects ok=false without error', () => {
    const result = DefaultOutputSchema.safeParse({
      ok: false,
    });
    assert.equal(result.success, false);
  });

  it('rejects ok=true with error payload', () => {
    const result = DefaultOutputSchema.safeParse({
      ok: true,
      error: { code: 'E_TEST', message: 'Test' },
    });
    assert.equal(result.success, false);
  });

  it('validates ISO datetime strings with offset', () => {
    assert.equal(
      AddTodoSchema.safeParse({
        description: 'Has due date',
        priority: 'medium',
        category: 'work',
        dueAt: '2025-02-28T10:30:00Z',
      }).success,
      true
    );
    assert.equal(
      AddTodoSchema.safeParse({
        description: 'Bad due date',
        priority: 'medium',
        category: 'work',
        dueAt: '2025-02-28 10:30:00Z',
      }).success,
      false
    );
  });
});
