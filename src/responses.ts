import { stripVTControlCharacters } from 'node:util';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface ErrorResponse {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent: {
    ok: false;
    error: { code: string; message: string };
    result?: unknown;
  };
  isError: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getErrorCode(error: unknown): string | undefined {
  if (!isRecord(error)) return undefined;
  const { code } = error;
  return typeof code === 'string' && code.length > 0 ? code : undefined;
}

function normalizeMessage(message: unknown): string | undefined {
  if (typeof message !== 'string' || message.length === 0) return undefined;
  const sanitized = stripVTControlCharacters(message).trim();
  return sanitized.length > 0 ? sanitized : undefined;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = normalizeMessage(error.message);
    if (message) return message;
  }
  const directMessage = normalizeMessage(error);
  if (directMessage) return directMessage;
  if (isRecord(error)) {
    const recordMessage = normalizeMessage(error.message);
    if (recordMessage) return recordMessage;
  }
  const code = getErrorCode(error);
  if (code) return `Error (${code})`;
  return 'Unknown error';
}

export function createErrorResponse(
  code: string,
  message: string,
  result?: unknown
): ErrorResponse {
  const structured: ErrorResponse['structuredContent'] = {
    ok: false,
    error: { code, message },
    ...(result === undefined ? {} : { result }),
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(structured) }],
    structuredContent: structured,
    isError: true,
  };
}

interface ToolResponse<
  T extends Record<string, unknown>,
> extends CallToolResult {
  structuredContent: T;
}

export function createToolResponse<T extends Record<string, unknown>>(
  structuredContent: T
): ToolResponse<T> {
  return {
    content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}
