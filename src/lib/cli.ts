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
    const todoFile =
      typeof values['todo-file'] === 'string' && values['todo-file'].length > 0
        ? values['todo-file']
        : undefined;
    const logLevel = isLogLevel(values['log-level'])
      ? values['log-level']
      : defaults.logLevel;

    return {
      todoFile,
      diagnostics: values.diagnostics === true,
      logLevel,
    };
  } catch {
    return defaults;
  }
}
