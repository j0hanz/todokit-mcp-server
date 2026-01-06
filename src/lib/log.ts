export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

const LEVEL_RANKS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

function levelRank(level: LogLevel): number {
  return LEVEL_RANKS[level];
}

function shouldLog(current: LogLevel, target: LogLevel): boolean {
  return levelRank(target) >= levelRank(current);
}

export function createStderrLogger(level: LogLevel): Logger {
  return {
    debug(message: string): void {
      if (!shouldLog(level, 'debug')) return;
      console.error(message);
    },
    info(message: string): void {
      if (!shouldLog(level, 'info')) return;
      console.error(message);
    },
    warn(message: string): void {
      if (!shouldLog(level, 'warn')) return;
      console.error(message);
    },
    error(message: string): void {
      if (!shouldLog(level, 'error')) return;
      console.error(message);
    },
  };
}
