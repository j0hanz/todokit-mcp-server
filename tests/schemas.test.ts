import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AddTodoSchema,
  DeleteTodoSchema,
  UpdateTodoSchema,
} from '../src/schemas/inputs.js';
import './setup.js';

describe('schemas', () => {
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
});
