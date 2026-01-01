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

function extractFromError(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

function extractFromString(error: unknown): string | undefined {
  return typeof error === 'string' && error.length > 0 ? error : undefined;
}

function hasMessageProp(error: unknown): error is { message?: unknown } {
  return Boolean(error && typeof error === 'object' && 'message' in error);
}

function extractFromMessageProp(error: unknown): string | undefined {
  if (!hasMessageProp(error)) return undefined;
  const msg = error.message;
  return typeof msg === 'string' && msg.length > 0 ? msg : undefined;
}

export function getErrorMessage(error: unknown): string {
  return (
    extractFromError(error) ??
    extractFromString(error) ??
    extractFromMessageProp(error) ??
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
