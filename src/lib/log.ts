export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

function levelRank(level: LogLevel): number {
  switch (level) {
    case 'debug':
      return 10;
    case 'info':
      return 20;
    case 'warn':
      return 30;
    case 'error':
      return 40;
  }
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
