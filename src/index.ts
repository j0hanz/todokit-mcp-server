#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  McpServer,
  ResourceTemplate,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ErrorCode,
  type InitializeRequest,
  InitializeRequestSchema,
  type InitializeResult,
  McpError,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js';

import packageJson from '../package.json' with { type: 'json' };
import {
  enableDefaultDiagnosticsSubscribers,
  publishLifecycleEvent,
} from './diagnostics.js';
import { closeDb, getTodos } from './storage.js';
import { registerAllTools, setInitializationGuard } from './tools.js';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

interface Logger {
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

function createStderrLogger(level: LogLevel): Logger {
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
    return { ...DEFAULT_CLI_OPTIONS };
  }
}

const SERVER_VERSION =
  typeof packageJson.version === 'string' && packageJson.version.length > 0
    ? packageJson.version
    : '0.0.0';

const DEFAULT_INSTRUCTIONS = 'Todokit to-do list manager';

function resolvePackageRoot(): string {
  try {
    const packageJsonPath = findPackageJSON(import.meta.url);
    if (packageJsonPath) {
      return dirname(packageJsonPath);
    }
  } catch {
    // Fall back to path-based resolution.
  }

  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function resolveInstructionsPathCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolvePackageRoot();

  return [
    resolve(moduleDir, 'instructions.md'),
    resolve(packageRoot, 'dist', 'instructions.md'),
    resolve(packageRoot, 'src', 'instructions.md'),
  ];
}

function loadServerInstructions(): string {
  for (const instructionsPath of resolveInstructionsPathCandidates()) {
    try {
      const raw = readFileSync(instructionsPath, { encoding: 'utf8' });
      const trimmed = raw.trim();
      return trimmed.length > 0 ? trimmed : DEFAULT_INSTRUCTIONS;
    } catch {
      // Continue trying candidates.
    }
  }

  return DEFAULT_INSTRUCTIONS;
}

function resolveIconPathCandidates(): string[] {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolvePackageRoot();

  return [
    resolve(moduleDir, 'assets', 'logo.svg'),
    resolve(packageRoot, 'assets', 'logo.svg'),
    resolve(packageRoot, 'dist', 'assets', 'logo.svg'),
  ];
}

function getLocalIconData(): string | undefined {
  for (const iconPath of resolveIconPathCandidates()) {
    try {
      const buffer = readFileSync(iconPath);
      if (buffer.length > 2 * 1024 * 1024) {
        console.warn(
          `Warning: Server icon size (${(buffer.length / 1024 / 1024).toFixed(
            2
          )}MB) exceeds 2MB limit.`
        );
      }
      return `data:image/svg+xml;base64,${buffer.toString('base64')}`;
    } catch {
      // Continue trying candidates.
    }
  }

  return undefined;
}

function registerInstructionsResource(
  server: McpServer,
  isInitialized: () => boolean,
  serverIcon?: string
): void {
  server.registerResource(
    'internal://instructions',
    new ResourceTemplate('internal://instructions', { list: undefined }),
    {
      title: 'Todokit Instructions',
      mimeType: 'text/markdown',
      ...(serverIcon
        ? {
            icons: [
              { src: serverIcon, mimeType: 'image/svg+xml', sizes: ['any'] },
            ],
          }
        : {}),
    },
    (uri) => {
      if (!isInitialized()) {
        throw new McpError(ErrorCode.InvalidRequest, 'Server not initialized');
      }
      const text = loadServerInstructions();
      return {
        contents: [
          {
            uri: uri.href,
            text,
            mimeType: 'text/markdown',
          },
        ],
      };
    }
  );
}

function registerTodoResource(
  server: McpServer,
  isInitialized: () => boolean,
  serverIcon?: string
): void {
  server.registerResource(
    'todo://list',
    new ResourceTemplate('todo://list', { list: undefined }),
    {
      title: 'Active Todos',
      description: 'A live list of all active (pending) todos.',
      mimeType: 'application/json',
      ...(serverIcon
        ? {
            icons: [
              { src: serverIcon, mimeType: 'image/svg+xml', sizes: ['any'] },
            ],
          }
        : {}),
    },
    async (uri) => {
      if (!isInitialized()) {
        throw new McpError(ErrorCode.InvalidRequest, 'Server not initialized');
      }
      const todos = await getTodos();
      const active = todos.filter((t) => !t.completed);
      return {
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(active, null, 2),
            mimeType: 'application/json',
          },
        ],
      };
    }
  );
}

function installStrictInitializeHandler(server: McpServer): void {
  type InitializeHandler = (
    request: InitializeRequest
  ) => Promise<InitializeResult>;

  const internal = server.server as unknown as {
    _oninitialize?: InitializeHandler;
  };
  const defaultHandler =
    typeof internal._oninitialize === 'function'
      ? internal._oninitialize.bind(server.server)
      : null;

  if (!defaultHandler) return;

  server.server.setRequestHandler(
    InitializeRequestSchema,
    async (request: InitializeRequest) => {
      const requestedVersion = request.params.protocolVersion;
      if (!SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)) {
        setTimeout(() => {
          void server.close().catch(() => undefined);
        }, 0);
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Unsupported protocol version: ${requestedVersion}`
        );
      }
      return await defaultHandler(request);
    }
  );
}

let shuttingDown = false;
let activeServer: McpServer | null = null;
let disableDiagnostics: (() => void) | null = null;

export function createServer(): McpServer {
  let initialized = false;
  const isInitialized = (): boolean => initialized;

  const localIcon = getLocalIconData();

  const server = new McpServer(
    {
      name: 'todokit',
      version: SERVER_VERSION,
      ...(localIcon
        ? {
            icons: [
              { src: localIcon, mimeType: 'image/svg+xml', sizes: ['any'] },
            ],
          }
        : {}),
    },
    {
      instructions: loadServerInstructions(),
      capabilities: {
        logging: {},
        resources: {},
      },
    }
  );

  installStrictInitializeHandler(server);
  registerInstructionsResource(server, isInitialized, localIcon);
  registerTodoResource(server, isInitialized, localIcon);

  const previousInitialized = server.server.oninitialized;
  server.server.oninitialized = () => {
    initialized = true;
    previousInitialized?.();
  };
  const previousClosed = server.server.onclose;
  server.server.onclose = () => {
    previousClosed?.();
    void shutdown('SIGTERM');
  };
  setInitializationGuard(() => initialized);

  registerAllTools(server, localIcon);
  return server;
}

export async function closeDbSafely(): Promise<void> {
  try {
    await closeDb();
  } catch (error: unknown) {
    console.error('Error closing database:', error);
  }
}

export function disableDiagnosticsSafely(disposer: (() => void) | null): null {
  try {
    disposer?.();
  } catch {
    // Ignore.
  }
  return null;
}

export async function closeServerSafely(
  server: McpServer | null,
  signal: NodeJS.Signals
): Promise<void> {
  if (!server) {
    process.exitCode = 0;
    return;
  }

  try {
    await server.close();
    process.exitCode = 0;
  } catch (error: unknown) {
    console.error(`Shutdown error (${signal}):`, error);
    process.exitCode = 1;
  }
}

export async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  const activeResources = process.getActiveResourcesInfo().slice(0, 25);
  publishLifecycleEvent({
    v: 1,
    kind: 'lifecycle',
    event: 'shutdown',
    at: new Date().toISOString(),
    signal,
    pid: process.pid,
    uptimeSec: process.uptime(),
    activeResources,
  });

  await closeDbSafely();
  disableDiagnostics = disableDiagnosticsSafely(disableDiagnostics);
  await closeServerSafely(activeServer, signal);
}

export async function startServer(): Promise<void> {
  activeServer = createServer();
  const transport = new StdioServerTransport();
  await activeServer.connect(transport);
}

process.on('unhandledRejection', (reason: unknown) => {
  console.error('Unhandled rejection:', reason);
  process.exitCode = 1;
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error);
  process.exitCode = 1;
});

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  const cli = parseCliArgs(process.argv);
  if (cli.todoFile) {
    process.env.TODOKIT_TODO_FILE = cli.todoFile;
  }

  if (cli.diagnostics) {
    const logger = createStderrLogger(cli.logLevel);
    disableDiagnostics = enableDefaultDiagnosticsSubscribers({
      logger: (line: string): void => {
        logger.info(line);
        if (activeServer?.isConnected()) {
          void activeServer
            .sendLoggingMessage({ level: 'info', data: { message: line } })
            .catch(() => undefined);
        }
      },
    });
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  startServer().catch((error: unknown) => {
    console.error('Server error:', error);
    process.exitCode = 1;
  });
}
