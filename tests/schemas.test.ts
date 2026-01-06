import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TodosSchema } from '../src/lib/types.js';
import {
  AddTodoSchema,
  DeleteTodoSchema,
  UpdateTodoSchema,
} from '../src/schemas/inputs.js';
import { IsoDateSchema, IsoDateTimeSchema } from '../src/schemas/iso_date.js';
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

  it('rejects unknown fields in persisted todos', () => {
    const result = TodosSchema.safeParse([
      {
        id: '1',
        title: 'Extra field',
        completed: false,
        priority: 'normal',
        tags: [],
        createdAt: '2025-02-28T10:30:00Z',
        extra: 'nope',
      },
    ]);
    assert.equal(result.success, false);
  });

  it('validates ISO date-only strings', () => {
    assert.equal(IsoDateSchema.safeParse('2025-02-28').success, true);
    assert.equal(IsoDateSchema.safeParse('2025-02-30').success, false);
    assert.equal(IsoDateSchema.safeParse('2025-2-3').success, false);
  });

  it('validates ISO datetime strings with offset', () => {
    assert.equal(
      IsoDateTimeSchema.safeParse('2025-02-28T10:30:00Z').success,
      true
    );
    assert.equal(
      IsoDateTimeSchema.safeParse('2025-02-28 10:30:00Z').success,
      false
    );
  });
});
