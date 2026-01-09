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

const DEFAULT_CLI_OPTIONS: CliOptions = {
  todoFile: undefined,
  diagnostics: false,
  logLevel: 'info',
};

function isLogLevel(value: unknown): value is LogLevel {
  return (
    value === 'error' ||
    value === 'warn' ||
    value === 'info' ||
    value === 'debug'
  );
}

function createDefaults(): CliOptions {
  return { ...DEFAULT_CLI_OPTIONS };
}

function resolveTodoFile(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function resolveLogLevel(value: unknown): LogLevel {
  return isLogLevel(value) ? value : DEFAULT_CLI_OPTIONS.logLevel;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  try {
    const args = argv.slice(2);
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
    const todoFile = resolveTodoFile(values['todo-file']);
    const logLevel = resolveLogLevel(values['log-level']);

    return {
      todoFile,
      diagnostics: values.diagnostics === true,
      logLevel,
    };
  } catch {
    return createDefaults();
  }
}
