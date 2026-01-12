# todokit-mcp

<img src="docs/logo.png" alt="Todokit MCP Server Logo" width="150">

An MCP server for Todokit, a task management and productivity tool with JSON storage.

[![npm version](https://img.shields.io/npm/v/@j0hanz/todokit-mcp.svg)](https://www.npmjs.com/package/@j0hanz/todokit-mcp)
[![License](https://img.shields.io/npm/l/@j0hanz/todokit-mcp)](LICENSE)
[![Node.js](https://img.shields.io/node/v/@j0hanz/todokit-mcp)](package.json)

## One-Click Install

[![Install with NPX in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=todokit&inputs=%5B%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ftodokit-mcp%40latest%22%5D%7D)[![Install with NPX in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=todokit&inputs=%5B%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ftodokit-mcp%40latest%22%5D%7D&quality=insiders)

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=todokit&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovdG9kb2tpdC1tY3BAbGF0ZXN0Il19)

## Features

- Task management: add, update, complete, and delete todos.
- Batch operations: add multiple todos at once.
- Simple filtering: status-based filtering for lists.
- JSON persistence with queued writes and atomic file writes.
- Optional diagnostics events (tool calls/results, storage, lifecycle) via Node diagnostics channels.

## Quick Start

```bash
npx -y @j0hanz/todokit-mcp@latest
```

The server runs over stdio (no HTTP endpoint) and registers MCP tools on startup.

## Installation

### NPX (recommended)

```bash
npx -y @j0hanz/todokit-mcp@latest
```

### Global install

```bash
npm install -g @j0hanz/todokit-mcp
```

Then run:

```bash
todokit-mcp
```

### From source

```bash
git clone https://github.com/j0hanz/todokit-mcp-server.git
cd todokit-mcp-server
npm install
npm run build
npm start
```

## Configuration

### Storage path

By default, todos are stored in `todos.json` in the current working directory. To control where data is written, set the `TODOKIT_TODO_FILE` environment variable to an absolute or relative path ending with `.json`. Relative paths resolve from the current working directory. The directory is created as needed; if the file does not exist, the server starts with an empty list.

When all todos are completed, the server removes the storage file so it does not linger on disk.

Examples:

```bash
# macOS/Linux
TODOKIT_TODO_FILE=/path/to/todos.json npx -y @j0hanz/todokit-mcp@latest
```

```powershell
# Windows PowerShell
$env:TODOKIT_TODO_FILE = 'C:\path\to\todos.json'
npx -y @j0hanz/todokit-mcp@latest
```

### JSON formatting

By default, todos are written as pretty-printed JSON (2-space indentation). To write compact JSON instead, set `TODOKIT_JSON_PRETTY` to `0` or `false`.

```bash
TODOKIT_JSON_PRETTY=0 npx -y @j0hanz/todokit-mcp@latest
```

### CLI options

The server accepts a few CLI flags (use `--` to forward args when running via `npx`).

```bash
npx -y @j0hanz/todokit-mcp@latest -- --todo-file ./todos.json --diagnostics --log-level debug
```

| Flag            | Alias | Description                                                                |
| :-------------- | :---- | :------------------------------------------------------------------------- |
| `--todo-file`   | `-f`  | Override the todo storage path (same as `TODOKIT_TODO_FILE`).              |
| `--diagnostics` | `-d`  | Enable diagnostics output (JSON lines) to stderr.                          |
| `--log-level`   | `-l`  | Diagnostics log level: `error`, `warn`, `info`, `debug` (default: `info`). |

The log level is only used when diagnostics output is enabled.

### Diagnostics

Diagnostics events are always published on Node's `diagnostics_channel` and can be subscribed to programmatically. When `--diagnostics` is set, the server attaches default subscribers and prints JSON events to **stderr** (stdout stays reserved for MCP traffic).

Channels:

- `todokit:tool` — tool call + tool result events
- `todokit:storage` — read/write/close events
- `todokit:lifecycle` — shutdown events

## Tools

All tools return a JSON payload in both `content` (stringified) and `structuredContent`.
Inputs are validated with strict Zod schemas, so unknown fields are rejected.

Success payload:

```json
{
  "ok": true,
  "result": {}
}
```

Error payload:

```json
{
  "ok": false,
  "error": { "code": "E_CODE", "message": "Details" }
}
```

The `result` shape is tool-specific.

### add_todo

Add a new todo item.

| Parameter   | Type   | Required | Description                            |
| :---------- | :----- | :------- | :------------------------------------- |
| description | string | Yes      | Description of the todo (1-2000 chars) |

Result fields:

- `item` (todo)
- `summary`
- `nextActions`

### add_todos

Add multiple todo items in one call.

| Parameter | Type  | Required | Description                                            |
| :-------- | :---- | :------- | :----------------------------------------------------- |
| items     | array | Yes      | Array of objects with `description` field (1-50 items) |

Result fields:

- `items` (todos)
- `summary`
- `nextActions`

### list_todos

List all todos with optional status filter.

| Parameter | Type   | Required | Default | Description                               |
| :-------- | :----- | :------- | :------ | :---------------------------------------- |
| status    | string | No       | all     | Filter by status: pending, completed, all |

Result fields:

- `items` (todos)
- `summary`
- `counts` (`total`, `pending`, `completed`)

### update_todo

Update fields on a todo item.

| Parameter   | Type   | Required | Description                    |
| :---------- | :----- | :------- | :----------------------------- |
| id          | string | Yes      | The ID of the todo to update   |
| description | string | No       | New description (1-2000 chars) |

Notes:

- If no updatable fields are provided, the tool returns an error.

Result fields:

- `item` (todo)
- `summary`
- `nextActions`

### complete_todo

Mark a todo as completed.

| Parameter | Type   | Required | Description        |
| :-------- | :----- | :------- | :----------------- |
| id        | string | Yes      | The ID of the todo |

Result fields:

- `item` (todo)
- `summary`
- `nextActions`

### delete_todo

Delete a todo item by ID.

| Parameter | Type   | Required | Description                  |
| :-------- | :----- | :------- | :--------------------------- |
| id        | string | Yes      | The ID of the todo to delete |

Result fields:

- `deletedIds` (array)
- `summary`
- `nextActions`

### clear_todos

Delete all todos from the list.

This also removes the configured todo storage file (defaults to `todos.json`), so the next read starts from an empty list.

| Parameter | Type | Required | Default | Description |
| :-------- | :--- | :------- | :------ | :---------- |
| (none)    | -    | -        | -       | -           |

Result fields:

- `deletedIds` (array)
- `summary`
- `nextActions`

## Data Model

A todo item has the following shape:

```json
{
  "id": "string",
  "description": "string",
  "completed": false,
  "createdAt": "ISO timestamp with offset",
  "updatedAt": "ISO timestamp with offset?",
  "completedAt": "ISO timestamp with offset?"
}
```

Notes:

- `createdAt`, `updatedAt`, and `completedAt` are ISO 8601 timestamps with offset (e.g., `2025-02-28T10:30:00Z`).

## Client Configuration

<details>
<summary><b>VS Code</b></summary>

Add this to your `mcpServers` configuration in `settings.json`:

```json
{
  "todokit": {
    "command": "npx",
    "args": ["-y", "@j0hanz/todokit-mcp@latest"]
  }
}
```

</details>

<details>
<summary><b>Claude Desktop</b></summary>

Add this to your `claude_desktop_config.json`:

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
<summary><b>Cursor</b></summary>

1. Go to **Cursor Settings** > **Features** > **MCP**
2. Click **+ Add New MCP Server**
3. Name: `todokit`
4. Type: `command`
5. Command: `npx -y @j0hanz/todokit-mcp@latest`

</details>

## Development

### Prerequisites

- Node.js >= 20.0.0

### Scripts

| Command               | Description                                           |
| :-------------------- | :---------------------------------------------------- |
| npm run build         | Compile TypeScript to JavaScript                      |
| npm run dev           | Run server in watch mode for development              |
| npm start             | Run the built server                                  |
| npm run test          | Run unit tests (node --test + tsx)                    |
| npm run test:coverage | Run unit tests with coverage                          |
| npm run lint          | Run ESLint                                            |
| npm run format        | Format with Prettier                                  |
| npm run format:check  | Check formatting with Prettier                        |
| npm run type-check    | Run TypeScript type checking                          |
| npm run dup-check     | Run duplicate code checks (jscpd)                     |
| npm run clean         | Remove the dist/ build output                         |
| npm run inspector     | Launch the MCP inspector (pass server cmd after `--`) |

### Manual verification

```bash
npm run build
npm run inspector -- node dist/index.js
```

### Project structure

```text
src/
  index.ts       # MCP server entrypoint (stdio)
  tools.ts       # Tool registrations and handlers
  schema.ts      # Zod input/output schemas
  storage.ts     # JSON persistence and CRUD
  responses.ts   # Tool response builders
  diagnostics.ts # Node diagnostics channels
tests/           # Unit tests
docs/            # Assets (logo)
```

## Contributing

Contributions are welcome. Please run `npm run format`, `npm run lint`, `npm run type-check`, `npm run build`, `npm test`, `npm run test:coverage`, and `npm run dup-check` before opening a PR.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
