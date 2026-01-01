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

type MessageGetter = (error: unknown) => unknown;

const MESSAGE_GETTERS: MessageGetter[] = [
  (error) => (error instanceof Error ? error.message : undefined),
  (error) => (typeof error === 'string' ? error : undefined),
  (error) =>
    error && typeof error === 'object' && 'message' in error
      ? (error as { message?: unknown }).message
      : undefined,
];

export function getErrorMessage(error: unknown): string {
  for (const getter of MESSAGE_GETTERS) {
    const message = getter(error);
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
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
    content: [{ type: 'text' as const, text: JSON.stringify(structured) }],
    structuredContent: structured,
    isError: true as const,
  };
}
