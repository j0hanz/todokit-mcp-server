import { parseArgs } from 'node:util';

import type { LogLevel } from './log.js';

export interface CliOptions {
  todoFile?: string | undefined;
  diagnostics: boolean;
  logLevel: LogLevel;
}

type ParsedValues = Record<string, unknown> & {
  diagnostics?: boolean | undefined;
  'log-level'?: string | undefined;
};

function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === 'error' ||
    value === 'warn' ||
    value === 'info' ||
    value === 'debug'
  );
}

function resolveTodoFile(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveLogLevel(value: unknown, fallback: LogLevel): LogLevel {
  return isLogLevel(value) ? value : fallback;
}

function buildCliOptions(
  values: ParsedValues,
  defaults: CliOptions
): CliOptions {
  return {
    todoFile: resolveTodoFile(values['todo-file']),
    diagnostics: values.diagnostics === true,
    logLevel: resolveLogLevel(values['log-level'], defaults.logLevel),
  };
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  const defaults: CliOptions = {
    todoFile: undefined,
    diagnostics: false,
    logLevel: 'info',
  };

  const args = argv.slice(2);

  try {
    const parsed = parseArgs({
      args,
      strict: false,
      allowPositionals: true,
      options: {
        'todo-file': { type: 'string', short: 'f' },
        diagnostics: { type: 'boolean', short: 'd' },
        'log-level': { type: 'string', short: 'l' },
      },
    });

    const values = parsed.values as ParsedValues;
    return buildCliOptions(values, defaults);
  } catch {
    return defaults;
  }
}
