import { parseArgs } from 'node:util';

import type { LogLevel } from './log.js';

export interface CliOptions {
  todoFile?: string | undefined;
  diagnostics: boolean;
  logLevel: LogLevel;
}

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

    const todoFile = parsed.values['todo-file'];
    const diagnostics = parsed.values.diagnostics;
    const logLevel = parsed.values['log-level'];

    return {
      todoFile:
        typeof todoFile === 'string' && todoFile.length > 0
          ? todoFile
          : undefined,
      diagnostics: diagnostics === true,
      logLevel: isLogLevel(logLevel) ? logLevel : defaults.logLevel,
    };
  } catch {
    return defaults;
  }
}
