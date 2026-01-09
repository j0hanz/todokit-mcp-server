import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createErrorResponse, getErrorMessage } from '../src/responses.js';

describe('errors', () => {
  it('extracts error messages from common shapes', () => {
    assert.equal(getErrorMessage(new Error('boom')), 'boom');
    assert.equal(getErrorMessage('string error'), 'string error');
    assert.equal(getErrorMessage({ message: 'object error' }), 'object error');
    assert.equal(getErrorMessage({}), 'Unknown error');
  });

  it('creates structured error responses', () => {
    const result = createErrorResponse('E_TEST', 'Test error', { hint: 'Fix' });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.ok, false);
    assert.equal(result.structuredContent.error.code, 'E_TEST');
    assert.equal(result.structuredContent.result?.hint, 'Fix');
  });
});
