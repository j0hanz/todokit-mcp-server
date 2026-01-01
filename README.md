# Todokit MCP Server

A minimal, efficient Model Context Protocol (MCP) server for managing a to-do list.

## Features

- Add todos
- List todos
- Complete todos
- Delete todos
- Persists data to `todos.json`

## Usage

### Build

```bash
npm install
npm run build
```

### Development

```bash
npm run lint
npm run type-check
npm run test
npm run test:coverage
npm run dup-check
npm run bench
```

### Storage Location

By default, todos are stored in `todos.json` at the repo root. To override the
path (useful for tests or sandboxing), set `TODOKIT_TODO_FILE`:

```bash
TODOKIT_TODO_FILE=/tmp/todokit.json npm start
```

### Run

```bash
npm start
```

### Configure in Claude Desktop / Cursor

Add to your MCP config:

```json
{
  "mcpServers": {
    "todokit": {
      "command": "node",
      "args": ["C:\\todokit\\dist\\index.js"]
    }
  }
}
```
