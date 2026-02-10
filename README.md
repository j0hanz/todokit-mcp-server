# Todokit MCP Server

[![npm version](https://img.shields.io/npm/v/@j0hanz/todokit-mcp)](https://www.npmjs.com/package/@j0hanz/todokit-mcp) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT) [![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org/) [![TypeScript](https://img.shields.io/badge/TypeScript-5.9+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/) [![MCP SDK](https://img.shields.io/badge/MCP_SDK-1.x-8B5CF6)](https://modelcontextprotocol.io/)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0078d4?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522todokit%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540j0hanz%252Ftodokit-mcp%2540latest%2522%255D%257D) [![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install_Server-24bfa5?logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522todokit%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540j0hanz%252Ftodokit-mcp%2540latest%2522%255D%257D) [![Install in Claude Desktop](https://img.shields.io/badge/Claude_Desktop-Install_Server-c97539?logo=claude&logoColor=white)](#client-configuration-examples) [![Install in Cursor](https://img.shields.io/badge/Cursor-Install_Server-F14C28?logo=cursor&logoColor=white)](cursor://anysphere.cursor-deeplink/mcp/install?name=todokit&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovdG9kb2tpdC1tY3BAbGF0ZXN0Il19)

A local, persistent task management [MCP](https://modelcontextprotocol.io/) server with JSON file storage, cursor pagination, and diagnostics.

## Overview

Todokit is a Model Context Protocol (MCP) server that gives AI assistants the ability to manage a structured todo list. Tasks are persisted as a JSON file on disk with atomic writes and file-based locking, so data integrity is maintained even under concurrent access. The server communicates over **stdio** transport and exposes 7 tools, 2 resources, and 1 prompt for complete task lifecycle management.

## Key Features

- **Full task lifecycle** — create, list, search, update, complete, and delete todos
- **Batch operations** — add up to 50 tasks in a single call
- **Cursor-based pagination** — efficiently navigate large task lists (up to 100 items per page)
- **Fuzzy search** — find tasks by description or category text
- **Atomic file writes** — data integrity with temp-file-then-rename strategy and file-based locking
- **Resource subscriptions** — live `todo://list` resource with change notifications

## Tech Stack

| Component       | Technology                          |
| --------------- | ----------------------------------- |
| Runtime         | Node.js ≥ 24                        |
| Language        | TypeScript 5.9+                     |
| MCP SDK         | `@modelcontextprotocol/sdk` ^1.26.0 |
| Schema          | Zod ^4.3.6 (`z.strictObject()`)     |
| Transport       | stdio (JSON-RPC over stdin/stdout)  |
| Package Manager | npm                                 |

## Architecture

1. **CLI Entrypoint** (`src/index.ts`) — Parses CLI args, wires the `McpServer` to a `StdioServerTransport`, registers signal handlers for graceful shutdown.
2. **Tool Layer** (`src/tools.ts`) — Registers 7 tools with timeout/abort/diagnostics wrappers and cursor-based pagination.
3. **Storage Layer** (`src/storage.ts`) — Port/Adapter pattern (`FileSystemPort`, `LockPort`) for atomic JSON file reads/writes with in-memory caching and mtime-based invalidation.
4. **Schema Layer** (`src/schema.ts`) — Zod strict schemas for all tool inputs and outputs.
5. **Diagnostics** (`src/diagnostics.ts`) — Publishes events on `todokit:tool`, `todokit:storage`, and `todokit:lifecycle` channels.
6. **Request Context** (`src/requestContext.ts`) — `AsyncLocalStorage`-based correlation of tool calls with storage events.

## Repository Structure

```text
├── src/
│   ├── index.ts            # CLI entrypoint, server creation, transport wiring
│   ├── tools.ts            # Tool registration and handler logic
│   ├── storage.ts          # JSON file storage with locking and caching
│   ├── schema.ts           # Zod input/output schemas
│   ├── responses.ts        # createToolResponse / createErrorResponse helpers
│   ├── diagnostics.ts      # node:diagnostics_channel publishers
│   ├── requestContext.ts   # AsyncLocalStorage request context
│   ├── constants.ts        # Error name/code constants
│   └── instructions.md     # Server instructions resource
├── tests/                  # node:test test files
├── scripts/
│   └── tasks.mjs           # Build orchestration
├── assets/
│   └── logo.svg            # Server icon
├── .github/
│   └── workflows/
│       └── publish.yml     # CI/CD: npm publish on release
├── package.json
├── tsconfig.json
└── eslint.config.mjs
```

## Requirements

- **Node.js** ≥ 24
- **npm** (included with Node.js)

## Quickstart

Run with `npx` — no installation needed:

```bash
npx -y @j0hanz/todokit-mcp@latest
```

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "todokit": {
      "command": "npx",
      "args": ["-y", "@j0hanz/todokit-mcp@latest"]
    }
  }
}
```

## Installation

### NPX (recommended)

```bash
npx -y @j0hanz/todokit-mcp@latest
```

### Global Install

```bash
npm install -g @j0hanz/todokit-mcp
todokit-mcp
```

### From Source

```bash
git clone https://github.com/j0hanz/todokit-mcp-server.git
cd todokit-mcp-server
npm ci
npm run build
node dist/index.js
```

## Configuration

### CLI Arguments

| Flag            | Short | Type    | Default | Description                                    |
| --------------- | ----- | ------- | ------- | ---------------------------------------------- |
| `--todo-file`   | `-f`  | string  | —       | Path to the todo JSON file                     |
| `--diagnostics` | `-d`  | boolean | `false` | Enable diagnostics logging to stderr           |
| `--log-level`   | `-l`  | string  | `info`  | Log level: `error`, `warn`, `info`, or `debug` |

### Environment Variables

| Variable                          | Default          | Description                                           |
| --------------------------------- | ---------------- | ----------------------------------------------------- |
| `TODOKIT_TODO_FILE`               | `./todos.json`   | Path to the JSON storage file                         |
| `TODOKIT_TOOL_TIMEOUT_MS`         | `60000`          | Tool execution timeout in ms (`0` to disable)         |
| `TODOKIT_LOCK_TIMEOUT_MS`         | `5000`           | File lock acquisition timeout in ms                   |
| `TODOKIT_MAX_TODO_FILE_BYTES`     | `5242880` (5 MB) | Maximum allowed size of the todo file                 |
| `TODOKIT_JSON_PRETTY`             | `false`          | Pretty-print the JSON storage file (`true`/`1`/`yes`) |
| `TODOKIT_ALLOW_OUTSIDE_CWD`       | —                | Allow todo file outside the current working directory |
| `TODOKIT_STRICT_PROTOCOL_VERSION` | —                | Reject unsupported MCP protocol versions              |

## Usage

Todokit uses **stdio** transport. Start the server and communicate via JSON-RPC over stdin/stdout:

```bash
# With npx
npx -y @j0hanz/todokit-mcp@latest

# With custom todo file
npx -y @j0hanz/todokit-mcp@latest --todo-file ./my-tasks.json

# With diagnostics enabled
npx -y @j0hanz/todokit-mcp@latest --diagnostics --log-level debug
```

## MCP Surface

### Tools

#### `add_todo`

Create a single task. For multiple items, prefer `add_todos`.

| Parameter     | Type   | Required | Default | Description                                               |
| ------------- | ------ | -------- | ------- | --------------------------------------------------------- |
| `description` | string | Yes      | —       | Description of the todo (1–2000 chars)                    |
| `priority`    | string | Yes      | —       | Task priority: `low`, `medium`, or `high`                 |
| `category`    | string | Yes      | —       | Task category (1–50 chars, e.g. work, bug, testing, docs) |
| `dueAt`       | string | No       | —       | Due date/time as ISO 8601 with offset                     |

**Returns:** The created todo item with `id`, timestamps, and suggested next actions.

```json
{
  "ok": true,
  "result": {
    "item": {
      "id": "a1b2c3",
      "description": "Review PR #42",
      "completed": false,
      "priority": "high",
      "category": "work",
      "createdAt": "2026-02-10T12:00:00.000Z"
    },
    "summary": "Added todo",
    "nextActions": ["list_todos", "update_todo", "complete_todo"]
  }
}
```

---

#### `add_todos`

Create multiple tasks in one batch call (1–50 items).

| Parameter | Type  | Required | Default | Description                                                 |
| --------- | ----- | -------- | ------- | ----------------------------------------------------------- |
| `items`   | array | Yes      | —       | Array of todo objects (same shape as `add_todo` parameters) |

**Returns:** Count of created items, their IDs, and suggested next actions.

```json
{
  "ok": true,
  "result": {
    "count": 3,
    "ids": ["id1", "id2", "id3"],
    "summary": "Added 3 todos",
    "nextActions": ["list_todos", "update_todo"]
  }
}
```

---

#### `list_todos`

List todos with optional status filtering and cursor-based pagination.

| Parameter | Type   | Required | Default   | Description                                       |
| --------- | ------ | -------- | --------- | ------------------------------------------------- |
| `status`  | string | No       | `pending` | Filter: `pending`, `completed`, or `all`          |
| `limit`   | number | No       | `50`      | Max items to return (1–100)                       |
| `cursor`  | string | No       | —         | Opaque pagination cursor from a previous response |

**Returns:** Filtered todo items with counts, pagination info, and hints.

```json
{
  "ok": true,
  "result": {
    "items": [],
    "summary": "Showing 5 pending todos (Found 10 todos (5 pending, 5 completed))",
    "counts": { "total": 10, "pending": 5, "completed": 5 },
    "filteredCounts": { "total": 5, "pending": 5, "completed": 0 },
    "status": "pending",
    "returned": 5,
    "truncated": false,
    "remaining": 0,
    "hint": "Tip: when all todos are completed, the storage file is automatically deleted.",
    "limit": 50,
    "hasMore": false
  }
}
```

---

#### `search_todos`

Search todos by description or category text with status filtering and pagination.

| Parameter | Type   | Required | Default   | Description                                       |
| --------- | ------ | -------- | --------- | ------------------------------------------------- |
| `query`   | string | Yes      | —         | Search query (1–100 chars)                        |
| `status`  | string | No       | `pending` | Filter: `pending`, `completed`, or `all`          |
| `limit`   | number | No       | `50`      | Max items to return (1–100)                       |
| `cursor`  | string | No       | —         | Opaque pagination cursor from a previous response |

**Returns:** Matching items with match count, pagination info, and suggested next actions.

```json
{
  "ok": true,
  "result": {
    "items": [],
    "query": "review",
    "status": "pending",
    "summary": "Found 2 matches for \"review\" (pending)",
    "returned": 2,
    "totalMatches": 2,
    "remaining": 0,
    "limit": 50,
    "hasMore": false,
    "nextActions": ["update_todo", "complete_todo"]
  }
}
```

---

#### `update_todo`

Update one or more fields on an existing todo.

| Parameter     | Type   | Required | Default | Description                               |
| ------------- | ------ | -------- | ------- | ----------------------------------------- |
| `id`          | string | Yes      | —       | ID of the todo to update (1–100 chars)    |
| `description` | string | No       | —       | New description (1–2000 chars)            |
| `priority`    | string | No       | —       | New priority: `low`, `medium`, or `high`  |
| `category`    | string | No       | —       | New category (1–50 chars)                 |
| `dueAt`       | string | No       | —       | New due date/time as ISO 8601 with offset |

> At least one field besides `id` must be provided.

**Returns:** The updated todo item and suggested next actions.

```json
{
  "ok": true,
  "result": {
    "item": {
      "id": "a1b2c3",
      "description": "Updated task",
      "completed": false,
      "priority": "medium",
      "category": "work",
      "createdAt": "...",
      "updatedAt": "..."
    },
    "summary": "Updated todo",
    "nextActions": ["list_todos", "complete_todo"]
  }
}
```

---

#### `complete_todo`

Mark a todo as completed. Idempotent — completing an already-completed todo returns success with an informational summary.

| Parameter | Type   | Required | Default | Description                  |
| --------- | ------ | -------- | ------- | ---------------------------- |
| `id`      | string | Yes      | —       | ID of the todo (1–100 chars) |

**Returns:** The completed todo item with `completedAt` timestamp.

```json
{
  "ok": true,
  "result": {
    "item": {
      "id": "a1b2c3",
      "completed": true,
      "completedAt": "2026-02-10T14:00:00.000Z"
    },
    "summary": "Completed todo",
    "nextActions": ["list_todos"]
  }
}
```

---

#### `delete_todo`

Permanently delete a todo by ID. **Destructive** — cannot be undone.

| Parameter | Type   | Required | Default | Description                  |
| --------- | ------ | -------- | ------- | ---------------------------- |
| `id`      | string | Yes      | —       | ID of the todo (1–100 chars) |

**Returns:** The deleted todo's ID and suggested next actions.

```json
{
  "ok": true,
  "result": {
    "deletedIds": ["a1b2c3"],
    "summary": "Deleted todo",
    "nextActions": ["list_todos"]
  }
}
```

### Resources

| URI                       | MIME Type          | Description                                                                           |
| ------------------------- | ------------------ | ------------------------------------------------------------------------------------- |
| `internal://instructions` | `text/markdown`    | Server usage instructions                                                             |
| `todo://list`             | `application/json` | Live list of active (pending) todos. Supports subscriptions for change notifications. |

### Prompts

| Name       | Description                                                                       |
| ---------- | --------------------------------------------------------------------------------- |
| `get-help` | Returns concise usage instructions and best-practice workflows for Todokit tools. |

## Client Configuration Examples

<details>
<summary><strong>VS Code / VS Code Insiders</strong></summary>

Add to your VS Code settings (`settings.json`) or use the one-click install buttons above:

```json
{
  "mcp": {
    "servers": {
      "todokit": {
        "command": "npx",
        "args": ["-y", "@j0hanz/todokit-mcp@latest"]
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

Add to your Claude Desktop config file (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "todokit": {
      "command": "npx",
      "args": ["-y", "@j0hanz/todokit-mcp@latest"]
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to your Cursor MCP config (`.cursor/mcp.json`), or use the one-click install button above:

```json
{
  "mcpServers": {
    "todokit": {
      "command": "npx",
      "args": ["-y", "@j0hanz/todokit-mcp@latest"]
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to your Windsurf MCP config (`~/.windsurf/mcp.json`):

```json
{
  "mcpServers": {
    "todokit": {
      "command": "npx",
      "args": ["-y", "@j0hanz/todokit-mcp@latest"]
    }
  }
}
```

</details>

## Security

- **stdout safety** — The server never writes non-MCP output to stdout. All logging goes to stderr via `console.error()`, preserving JSON-RPC transport integrity.
- **Path traversal protection** — The todo file must reside within the current working directory by default. Set `TODOKIT_ALLOW_OUTSIDE_CWD` to override. Symlink resolution is performed to prevent escaping via symlinks.
- **File locking** — Concurrent access is protected by file-based locks with exponential backoff and `timingSafeEqual` ownership verification.
- **Atomic writes** — Data is written to a temporary file first, then atomically renamed to prevent corruption on partial writes.
- **Size limits** — The todo file is capped at 5 MB by default (`TODOKIT_MAX_TODO_FILE_BYTES`) to prevent unbounded growth.

## Development Workflow

### Install Dependencies

```bash
npm ci
```

### Scripts

| Script                  | Command                                          | Purpose                     |
| ----------------------- | ------------------------------------------------ | --------------------------- |
| `npm run dev`           | `tsc --watch --preserveWatchOutput`              | Watch mode compilation      |
| `npm run dev:run`       | `node --env-file=.env --watch dist/index.js`     | Run server with auto-reload |
| `npm run build`         | Clean + compile + validate + copy assets         | Production build            |
| `npm start`             | `node dist/index.js`                             | Run compiled server         |
| `npm run format`        | `prettier --write .`                             | Format code                 |
| `npm run lint`          | `eslint .`                                       | Lint code                   |
| `npm run lint:fix`      | `eslint . --fix`                                 | Auto-fix lint issues        |
| `npm run type-check`    | `tsc --noEmit`                                   | Type-check without emitting |
| `npm test`              | Build + `node --test` with tsx                   | Run tests                   |
| `npm run test:coverage` | Build + test with `--experimental-test-coverage` | Run tests with coverage     |
| `npm run dup-check`     | `jscpd --config .jscpd.json`                     | Check for code duplication  |
| `npm run knip`          | `knip`                                           | Detect dead/unused code     |
| `npm run inspector`     | `npx @modelcontextprotocol/inspector`            | Launch MCP Inspector        |

### Full Validation

```bash
npm run format && npm run lint && npm run type-check && npm run build && npm test
```

## Build and Release

The project uses **GitHub Actions** for CI/CD. On a GitHub Release event:

1. Checks out the repository
2. Sets up Node.js 24 with the npm registry
3. Installs dependencies (`npm ci`)
4. Runs lint, type-check, tests, coverage, and duplication checks
5. Builds the package
6. Publishes to npm using **Trusted Publishing** (OIDC — no `NODE_AUTH_TOKEN` needed)

Published package: [`@j0hanz/todokit-mcp`](https://www.npmjs.com/package/@j0hanz/todokit-mcp)

## Troubleshooting

### Inspect the Server

Use the MCP Inspector to interactively test tools:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Or if installed from npm:

```bash
npx @modelcontextprotocol/inspector npx -y @j0hanz/todokit-mcp@latest
```

### Common Issues

| Issue                         | Solution                                                            |
| ----------------------------- | ------------------------------------------------------------------- |
| **Server not responding**     | Ensure nothing else is reading/writing to stdout in the process     |
| **`E_NOT_FOUND`**             | Call `list_todos` first to verify the todo ID exists                |
| **`E_STORAGE_CONFLICT`**      | Retry the operation — another process may be holding the file lock  |
| **`E_STORAGE_TOO_LARGE`**     | Delete completed items or increase `TODOKIT_MAX_TODO_FILE_BYTES`    |
| **`E_BAD_REQUEST`**           | Ensure at least one field is provided when calling `update_todo`    |
| **`E_INVALID_PARAMS`**        | Check enum values (`priority`, `status`) and ISO 8601 date formats  |
| **File outside CWD error**    | Set `TODOKIT_ALLOW_OUTSIDE_CWD=true` or use a path within CWD       |
| **Storage file auto-deleted** | This is expected — the file is removed when all todos are completed |

### Diagnostics

Enable detailed logging to stderr:

```bash
npx -y @j0hanz/todokit-mcp@latest --diagnostics --log-level debug
```

This publishes events on `node:diagnostics_channel` channels: `todokit:tool`, `todokit:storage`, `todokit:lifecycle`.

## Contributing

Contributions are welcome! Please ensure all changes pass the full validation sequence:

```bash
npm run format && npm run lint && npm run type-check && npm run build && npm test
```

## License

[MIT](https://opensource.org/licenses/MIT)
