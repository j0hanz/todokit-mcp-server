# Todokit-MCP

<img src="assets/logo.svg" alt="Todokit MCP Server Logo" width="200">

![npm version](https://img.shields.io/npm/v/@j0hanz/todokit-mcp) ![License](https://img.shields.io/npm/l/@j0hanz/todokit-mcp) ![Node](https://img.shields.io/node/v/@j0hanz/todokit-mcp)

[![Install with NPX in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=todokit&inputs=%5B%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ftodokit-mcp%40latest%22%5D%7D) [![Install with NPX in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=todokit&inputs=%5B%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ftodokit-mcp%40latest%22%5D%7D&quality=insiders)

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=todokit&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovdG9kb2tpdC1tY3BAbGF0ZXN0Il19)

An MCP server for Todokit, a task management and productivity tool with JSON storage.

## Overview

Todokit MCP provides a lightweight, local task management system that integrates directly with your AI coding assistant. It uses a simple JSON file for persistence, allowing you to create, track, and complete tasks without leaving your editor. The server automatically handles file safety, locking, and atomic writes.

## Key Features

- **Local Persistence**: Stores tasks in a human-readable `todos.json` file in your working directory.
- **Task Management**: Create, update, complete, and delete tasks with priorities and categories.
- **Batch Operations**: Add multiple tasks efficiently in a single operation.
- **Filtering**: List tasks by status (pending/completed) to keep context manageable.
- **Safety Controls**: Validates file paths to prevent traversal outside the working directory (unless configured).
- **Diagnostics**: emitting events for tool calls, storage operations, and lifecycle events.

## Tech Stack

- **Runtime**: Node.js >=22.19.8
- **Language**: TypeScript 5.9
- **SDK**: Model Context Protocol SDK (`@modelcontextprotocol/sdk`)
- **Libraries**: Zod (validation)

## Repository Structure

```text
c:\todokit-mcp
├── dist/            # Compiled output
├── scripts/         # Build and task scripts
├── src/
│   ├── index.ts     # Server entrypoint & startup
│   ├── schema.ts    # Zod schemas for tools & types
│   ├── storage.ts   # JSON file persistence layer
│   └── tools.ts     # Tool registration & handlers
├── package.json
└── README.md
```

## Requirements

- Node.js >=22.19.8

## Quickstart

### NPX (Recommended)

```bash
npx -y @j0hanz/todokit-mcp@latest
```

## Configuration

The server can be configured via CLI arguments or environment variables.

### CLI Arguments

| Flag            | Short | Description                                                        |
| --------------- | ----- | ------------------------------------------------------------------ |
| `--todo-file`   | `-f`  | Path to the todo JSON file.                                        |
| `--diagnostics` | `-d`  | Enable diagnostic logging to stderr.                               |
| `--log-level`   | `-l`  | Set log level (`error`, `warn`, `info`, `debug`). Default: `info`. |

### Environment Variables

| Variable                      | Description                                                     | Default               |
| ----------------------------- | --------------------------------------------------------------- | --------------------- |
| `TODOKIT_TODO_FILE`           | Absolute or relative path to the todo storage file.             | `todos.json` (in CWD) |
| `TODOKIT_JSON_PRETTY`         | Set to `true` or `1` to indent JSON files with 2 spaces.        | `false` (compact)     |
| `TODOKIT_TOOL_TIMEOUT_MS`     | Timeout for tool execution in milliseconds.                     | `60000`               |
| `TODOKIT_LOCK_TIMEOUT_MS`     | Timeout for acquiring file lock.                                | `5000`                |
| `TODOKIT_MAX_TODO_FILE_BYTES` | Maximum allowed size of the todo file.                          | `5242880` (5MB)       |
| `TODOKIT_ALLOW_OUTSIDE_CWD`   | Allow storage file to be outside the current working directory. | `false`               |

## MCP Surface

### Tools

| Tool            | Description                         | Parameters                                                                                       | Results                                            |
| --------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `add_todo`      | Create a new task.                  | `description` (str, req), `priority` (enum, req), `category` (str, req), `dueAt` (iso-date, opt) | Returns the created item and summary.              |
| `add_todos`     | Create multiple tasks in batch.     | `items` (array of todos, req, max 50)                                                            | Returns count and IDs of created items.            |
| `list_todos`    | List tasks with optional filtering. | `status` (pending/completed/all, opt, def: pending)                                              | Returns list of items, counts, and status summary. |
| `search_todos`  | Search for tasks.                   | `query` (str, req)                                                                               | Returns matching items.                            |
| `update_todo`   | Update an existing task.            | `id` (str, req), `description`, `priority`, `category`, `dueAt` (all opt)                        | Returns updated item.                              |
| `complete_todo` | Mark a task as completed.           | `id` (str, req)                                                                                  | Returns updated item.                              |
| `delete_todo`   | Permanently remove a task.          | `id` (str, req)                                                                                  | Returns summary of deletion.                       |

### Resources

| URI Template              | Type               | Description                                                       |
| ------------------------- | ------------------ | ----------------------------------------------------------------- |
| `internal://instructions` | `text/markdown`    | Returns usage instructions and context about the Todokit manager. |
| `todo://list`             | `application/json` | Returns a live JSON list of all active (pending) todos.           |

## Client Configuration Examples

<details>
<summary><b>VS Code</b></summary>

Add to your `settings.json` (Code) or `mcpServers` configuration:

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

Add to `claude_desktop_config.json`:

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

1. Open **Cursor Settings** > **Features** > **MCP**
2. Click **+ Add New MCP Server**
3. Name: `todokit`
4. Type: `command`
5. Command: `npx -y @j0hanz/todokit-mcp@latest`

</details>

## Security

- **Path Traversal**: By default, the server enforces that the `todos.json` file must reside within the current working directory. You must explicitly opt-in via `TODOKIT_ALLOW_OUTSIDE_CWD` to store files elsewhere.
- **File Limits**: The server enforces a maximum file size (default 5MB) to prevent disk exhaustion.

## Development Workflow

1. **Install Dependencies**

   ```bash
   npm install
   ```

2. **Common Scripts**

   | Script              | Description                               |
   | ------------------- | ----------------------------------------- |
   | `npm run build`     | Builds the project to `dist/`.            |
   | `npm run dev`       | Watches for changes and recompiles.       |
   | `npm run test`      | Runs the test suite via Node test runner. |
   | `npm run lint`      | Lints code with ESLint.                   |
   | `npm run format`    | Formats code with Prettier.               |
   | `npm run inspector` | Launches the MCP inspector for debugging. |

## Troubleshooting

- **Server Error: Server not initialized**: This typically happens if tools are called before the server has fully started. Ensure the client waits for initialization.
- **Storage Error: path outside CWD**: You are trying to use a file outside the workspace. Move the file or set `TODOKIT_ALLOW_OUTSIDE_CWD=1`.

## License

MIT
