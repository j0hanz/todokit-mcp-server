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

function getMessageFromErrorInstance(error: unknown): string | undefined {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return undefined;
}

function getMessageFromString(error: unknown): string | undefined {
  if (typeof error === 'string' && error.length > 0) {
    return error;
  }
  return undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isObjectWithMessage(value: unknown): value is { message?: unknown } {
  return typeof value === 'object' && value !== null && 'message' in value;
}

function getMessageFromObject(error: unknown): string | undefined {
  if (!isObjectWithMessage(error)) {
    return undefined;
  }
  const message = error.message;
  return isNonEmptyString(message) ? message : undefined;
}

export function getErrorMessage(error: unknown): string {
  return (
    getMessageFromErrorInstance(error) ??
    getMessageFromString(error) ??
    getMessageFromObject(error) ??
    'Unknown error'
  );
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
    content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
    isError: true as const,
  };
}
