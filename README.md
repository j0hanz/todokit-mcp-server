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

- Task management: add, update, complete/reopen, and delete todos.
- Batch operations: add multiple todos in one call.
- Rich filtering: status, priority, tags, due dates, and free-text search.
- Tagging: tags are normalized (trimmed, lowercase, unique) and can be added or removed.
- Safe deletion: dry-run delete returns previews for ambiguous matches.
- JSON persistence with queued writes and atomic file writes.
- List summaries with counts (pending, completed, overdue).

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

By default, todos are stored in `todos.json` next to the server package (the project root when running from source). To control where data is written, set the `TODOKIT_TODO_FILE` environment variable to an absolute or relative path ending with `.json`. The directory is created as needed; if the file does not exist, the server starts with an empty list.

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

## Tools

All tools return a JSON payload in both `content` (stringified) and `structuredContent`.

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

The `result` shape is tool-specific. If a `query` matches multiple todos, tools return `E_AMBIGUOUS` with preview matches and a hint to use an exact `id`.

### add_todo

Add a new todo item.

| Parameter   | Type   | Required | Default | Description                           |
| :---------- | :----- | :------- | :------ | :------------------------------------ |
| title       | string | Yes      | -       | The title of the todo (1-200 chars)   |
| description | string | No       | -       | Optional description (max 2000 chars) |
| priority    | string | No       | normal  | Priority level: low, normal, high     |
| dueDate     | string | No       | -       | Due date in ISO format (YYYY-MM-DD)   |
| tags        | array  | No       | -       | Array of tags (max 50, 1-50 chars)    |

Result fields:

- `item` (todo)
- `summary`
- `nextActions`

### add_todos

Add multiple todo items in one call.

| Parameter | Type  | Required | Default | Description                                                 |
| :-------- | :---- | :------- | :------ | :---------------------------------------------------------- |
| items     | array | Yes      | -       | Array of todo objects (same fields as add_todo, 1-50 items) |

Result fields:

- `items` (todos)
- `summary`
- `nextActions`

### list_todos

List todos with filtering, search, sorting, and pagination.

| Parameter | Type    | Required | Default   | Description                                       |
| :-------- | :------ | :------- | :-------- | :------------------------------------------------ |
| status    | string  | No       | all       | Filter by status: pending, completed, all         |
| completed | boolean | No       | -         | Deprecated; status takes precedence when provided |
| priority  | string  | No       | -         | Filter by priority: low, normal, high             |
| tag       | string  | No       | -         | Filter by tag (must contain)                      |
| query     | string  | No       | -         | Search text in title, description, or tags        |
| dueBefore | string  | No       | -         | Filter todos due before this date (YYYY-MM-DD)    |
| dueAfter  | string  | No       | -         | Filter todos due after this date (YYYY-MM-DD)     |
| sortBy    | string  | No       | createdAt | Sort by: dueDate, priority, createdAt, title      |
| order     | string  | No       | asc       | Sort order: asc, desc                             |
| limit     | number  | No       | 50        | Max number of results (1-200)                     |
| offset    | number  | No       | 0         | Number of results to skip (0-10000)               |

Result fields:

- `items` (todos)
- `summary`
- `counts` (`total`, `pending`, `completed`, `overdue`)
- `limit`
- `offset`

### update_todo

Update fields on a todo item. Provide either `id` or `query` to identify the todo.

| Parameter   | Type    | Required | Default | Description                                    |
| :---------- | :------ | :------- | :------ | :--------------------------------------------- |
| id          | string  | No       | -       | The ID of the todo to update                   |
| query       | string  | No       | -       | Search text to find a single todo to update    |
| title       | string  | No       | -       | New title                                      |
| description | string  | No       | -       | New description                                |
| completed   | boolean | No       | -       | Completion status                              |
| priority    | string  | No       | -       | New priority level                             |
| dueDate     | string  | No       | -       | New due date (YYYY-MM-DD)                      |
| tags        | array   | No       | -       | Replace all tags (max 50)                      |
| tagOps      | object  | No       | -       | Tag modifications to apply (add/remove arrays) |
| clearFields | array   | No       | -       | Fields to clear: description, dueDate, tags    |

Notes:

- If both `tags` and `tagOps` are provided, `tags` wins and replaces the list.
- If no updatable fields are provided, the tool returns an error.

Result fields:

- `item` (todo)
- `summary`
- `nextActions`

### complete_todo

Set completion status for a todo item. Provide either `id` or `query`.

| Parameter | Type    | Required | Default | Description                       |
| :-------- | :------ | :------- | :------ | :-------------------------------- |
| id        | string  | No       | -       | The ID of the todo to complete    |
| query     | string  | No       | -       | Search text to find a single todo |
| completed | boolean | No       | true    | Set completion status             |

Result fields:

- `item` (todo)
- `summary` (includes already-complete or reopen messages)
- `nextActions`

### delete_todo

Delete a todo item. Provide either `id` or `query`.

| Parameter | Type    | Required | Default | Description                             |
| :-------- | :------ | :------- | :------ | :-------------------------------------- |
| id        | string  | No       | -       | The ID of the todo to delete            |
| query     | string  | No       | -       | Search text to find a single todo       |
| dryRun    | boolean | No       | false   | Simulate deletion without changing data |

Result fields:

- `deletedIds` (array)
- `summary`
- `nextActions` (only when not dryRun)
- `dryRun` (when dryRun is true)
- `matches`, `totalMatches` (dry-run + multiple matches)

## Data Model

A todo item has the following shape:

```json
{
  "id": "string",
  "title": "string",
  "description": "string?",
  "completed": false,
  "priority": "low|normal|high",
  "dueDate": "YYYY-MM-DD?",
  "tags": ["string"],
  "createdAt": "ISO timestamp",
  "updatedAt": "ISO timestamp?",
  "completedAt": "ISO timestamp?"
}
```

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

```
src/
  index.ts   # MCP server entrypoint (stdio)
  tools/     # Tool registrations
  schemas/   # Zod input/output schemas
  lib/       # Storage, matching, shared helpers
tests/       # Unit tests
docs/        # Assets (logo)
```

## Contributing

Contributions are welcome. Please run `npm run format`, `npm run lint`, `npm run type-check`, and `npm run build` before opening a PR.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
