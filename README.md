# todokit-mcp

A MCP server for Todokit, a task management and productivity tool with JSON storage.

[![npm version](https://img.shields.io/npm/v/@j0hanz/todokit-mcp.svg)](https://www.npmjs.com/package/@j0hanz/todokit-mcp)
[![License](https://img.shields.io/npm/l/@j0hanz/todokit-mcp)](LICENSE)
[![Node.js](https://img.shields.io/node/v/@j0hanz/todokit-mcp)](package.json)

## One-Click Install

[![Install with NPX in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=todokit&inputs=%5B%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ftodokit-mcp%40latest%22%5D%7D)[![Install with NPX in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=todokit&inputs=%5B%5D&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40j0hanz%2Ftodokit-mcp%40latest%22%5D%7D&quality=insiders)

[![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=todokit&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBqMGhhbnovdG9kb2tpdC1tY3BAbGF0ZXN0Il19)

## ✨ Features

| Feature                 | Description                                                          |
| :---------------------- | :------------------------------------------------------------------- |
| 📝 **Task Management**  | Add, update, complete, and delete todos with ease.                   |
| 🔍 **Rich Filtering**   | Filter by status, priority, tags, due date, and search text.         |
| 🏷️ **Tagging System**   | Organize tasks with tags; support for adding/removing specific tags. |
| 📦 **Batch Operations** | Add multiple todos in a single request.                              |
| 💾 **JSON Persistence** | Stores data in a simple `todos.json` file in the working directory.  |
| 🛡️ **Safe Deletion**    | Supports dry-run for deletions to preview changes.                   |

## 🚀 Quick Start

The easiest way to use Todokit is with `npx`:

```bash
npx -y @j0hanz/todokit-mcp@latest
```

### VS Code

Add this to your `mcpServers` configuration in VS Code settings:

```json
{
  "todokit": {
    "command": "npx",
    "args": ["-y", "@j0hanz/todokit-mcp@latest"]
  }
}
```

## 📦 Installation

### NPX (Recommended)

```bash
npx -y @j0hanz/todokit-mcp@latest
```

### Global Installation

```bash
npm install -g @j0hanz/todokit-mcp
```

### From Source

```bash
git clone https://github.com/j0hanz/todokit-mcp-server.git
cd todokit-mcp-server
npm install
npm run build
npm start
```

## ⚙️ Configuration

The server does not require complex configuration. It automatically creates a `todos.json` file in the directory where the server is started to store your tasks.

## 🔧 Tools

### `add_todo`

Add a new todo item.

| Parameter     | Type   | Required | Default  | Description                             |
| :------------ | :----- | :------- | :------- | :-------------------------------------- |
| `title`       | string | ✅       | -        | The title of the todo (1-200 chars)     |
| `description` | string | ❌       | -        | Optional description (max 2000 chars)   |
| `priority`    | string | ❌       | `normal` | Priority level: `low`, `normal`, `high` |
| `dueDate`     | string | ❌       | -        | Due date in ISO format (YYYY-MM-DD)     |
| `tags`        | array  | ❌       | -        | Array of tags for categorization        |

**Returns:** The created todo item.

### `add_todos`

Add multiple todo items in one call.

| Parameter | Type  | Required | Default | Description                                          |
| :-------- | :---- | :------- | :------ | :--------------------------------------------------- |
| `items`   | array | ✅       | -       | Array of todo objects (same structure as `add_todo`) |

**Returns:** Summary of added items.

### `list_todos`

List todos with filtering, search, sorting, and pagination.

| Parameter  | Type   | Required | Default     | Description                                          |
| :--------- | :----- | :------- | :---------- | :--------------------------------------------------- |
| `status`   | string | ❌       | -           | Filter by status: `pending`, `completed`, `all`      |
| `priority` | string | ❌       | -           | Filter by priority: `low`, `normal`, `high`          |
| `tag`      | string | ❌       | -           | Filter by tag (must contain)                         |
| `query`    | string | ❌       | -           | Search text in title, description, or tags           |
| `sortBy`   | string | ❌       | `createdAt` | Sort by: `dueDate`, `priority`, `createdAt`, `title` |
| `order`    | string | ❌       | `asc`       | Sort order: `asc`, `desc`                            |
| `limit`    | number | ❌       | 50          | Max number of results                                |
| `offset`   | number | ❌       | 0           | Number of results to skip                            |

**Returns:** List of todos, summary, and counts.

### `update_todo`

Update fields on a todo item. Requires either `id` or `query` to identify the todo.

| Parameter     | Type    | Required | Default | Description                                       |
| :------------ | :------ | :------- | :------ | :------------------------------------------------ |
| `id`          | string  | ❌       | -       | The ID of the todo to update                      |
| `query`       | string  | ❌       | -       | Search text to find a single todo to update       |
| `title`       | string  | ❌       | -       | New title                                         |
| `description` | string  | ❌       | -       | New description                                   |
| `completed`   | boolean | ❌       | -       | Completion status                                 |
| `priority`    | string  | ❌       | -       | New priority level                                |
| `dueDate`     | string  | ❌       | -       | New due date (ISO format)                         |
| `tags`        | array   | ❌       | -       | New tags (replaces existing)                      |
| `tagOps`      | object  | ❌       | -       | Object with `add` and `remove` arrays for tags    |
| `clearFields` | array   | ❌       | -       | Fields to clear: `description`, `dueDate`, `tags` |

**Returns:** The updated todo item.

### `complete_todo`

Set completion status for a todo item. Requires either `id` or `query`.

| Parameter   | Type    | Required | Default | Description                       |
| :---------- | :------ | :------- | :------ | :-------------------------------- |
| `id`        | string  | ❌       | -       | The ID of the todo to complete    |
| `query`     | string  | ❌       | -       | Search text to find a single todo |
| `completed` | boolean | ❌       | `true`  | Set completion status             |

**Returns:** The updated todo item.

### `delete_todo`

Delete a todo item. Requires either `id` or `query`.

| Parameter | Type    | Required | Default | Description                             |
| :-------- | :------ | :------- | :------ | :-------------------------------------- |
| `id`      | string  | ❌       | -       | The ID of the todo to delete            |
| `query`   | string  | ❌       | -       | Search text to find a single todo       |
| `dryRun`  | boolean | ❌       | `false` | Simulate deletion without changing data |

**Returns:** Summary of deleted item(s).

## 🔌 Client Configuration

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

## 🛠️ Development

### Prerequisites

- Node.js >= 20.0.0

### Scripts

| Command              | Description                              |
| :------------------- | :--------------------------------------- |
| `npm run build`      | Compile TypeScript to JavaScript         |
| `npm run dev`        | Run server in watch mode for development |
| `npm run test`       | Run tests                                |
| `npm run lint`       | Run ESLint                               |
| `npm run type-check` | Run TypeScript type checking             |

### Project Structure

```text
src/
├── index.ts        # Entry point
├── tools/          # Tool implementations
├── schemas/        # Zod input/output schemas
└── lib/            # Shared logic (storage, types, errors)
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
