# AGENTS.md

## Project Overview

- **What**: MCP (Model Context Protocol) server for task management with JSON persistence
- **Package**: `@j0hanz/todokit-mcp` (npm)
- **Stack**: TypeScript 5.9+, Node.js 20+, `@modelcontextprotocol/sdk` v1.x, Zod v3.24+
- **Transport**: stdio (no HTTP endpoint)
- **License**: MIT

## Repo Map / Structure

```text
src/
├── index.ts          # MCP server entrypoint (stdio transport)
├── tools/            # Tool registrations (add_todo, list_todos, etc.)
├── schemas/          # Zod input/output schemas
└── lib/              # Storage, matching, shared helpers

tests/                # Node.js built-in test runner (*.test.ts)
dist/                 # Build output (gitignored)
docs/                 # Logo and assets
coverage/             # Test coverage output
```

**Key files**:

- `src/index.ts` — Server creation, shutdown handlers, stdio transport
- `src/tools/index.ts` — Tool registration
- `src/schemas/inputs.ts` / `outputs.ts` — Zod schemas for all tools
- `src/lib/storage.ts` — JSON persistence layer

## Setup & Environment

**Prerequisites**: Node.js >= 20.0.0

```bash
git clone https://github.com/j0hanz/todokit-mcp-server.git
cd todokit-mcp-server
npm install
```

**Environment variables**:

- `TODOKIT_TODO_FILE` — Path to JSON storage file (default: `todos.json` in project root)

## Development Workflow

| Task               | Command         |
| ------------------ | --------------- |
| Dev mode (watch)   | `npm run dev`   |
| Build              | `npm run build` |
| Start built server | `npm start`     |
| Clean build        | `npm run clean` |

**Manual verification with MCP Inspector**:

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```

## Testing

| Task      | Command                 |
| --------- | ----------------------- |
| Run tests | `npm test`              |
| Coverage  | `npm run test:coverage` |

- **Runner**: Node.js built-in test runner (`node --test`)
- **Location**: `tests/*.test.ts`
- **Execution**: Uses `tsx` for TypeScript

## Code Style & Conventions

### Language & Compiler

- TypeScript 5.9+ with `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`
- Target: ES2022, Module: NodeNext

### Lint & Format

| Task            | Command                |
| --------------- | ---------------------- |
| Lint            | `npm run lint`         |
| Format          | `npm run format`       |
| Format check    | `npm run format:check` |
| Type check      | `npm run type-check`   |
| Duplicate check | `npm run dup-check`    |

### ESLint Rules (enforced)

- `unused-imports/no-unused-imports` — error
- `@typescript-eslint/no-explicit-any` — error
- `@typescript-eslint/consistent-type-imports` — inline type imports
- `@typescript-eslint/explicit-function-return-type` — required
- `complexity` — max 5
- `max-depth` — max 2
- `max-lines-per-function` — max 40

### Conventions

- Use `.js` extensions in all local imports (NodeNext resolution)
- Use `import type { X }` or `import { type X }` for type-only imports
- Named exports only (no default exports)
- Explicit return types on exported functions
- `prefer-const`, no `var`

### MCP Tool Pattern

All tools must return:

```typescript
{
  content: [{ type: 'text', text: JSON.stringify(structured) }],
  structuredContent: { ok: boolean, result?: unknown, error?: { code, message } }
}
```

## Build / Release

- **Build output**: `dist/`
- **Build command**: `npm run build` (runs `tsc`)
- **Prepublish checks**: `npm run lint && npm run type-check && npm run build`
- **Release**: Tag-based via GitHub Releases → triggers `publish.yml` workflow

**CI checks on publish**:

1. `npm run lint`
2. `npm run type-check`
3. `npm test`
4. `npm run test:coverage`
5. `npm run dup-check`
6. `npm run build`

## Security & Safety

- **stdio only**: Server never writes non-MCP data to stdout; logs go to stderr
- **No secrets in code**: Use environment variables
- **Input validation**: All tool inputs validated via Zod schemas with `.min()`, `.max()` limits
- **No `eval()` or `Function()`**: Dynamic code execution prohibited
- **File operations**: Atomic writes for JSON persistence

## Pull Request / Commit Guidelines

**Before opening a PR, run all checks**:

```bash
npm run format
npm run lint
npm run type-check
npm run build
npm test
```

**Required CI checks**:

- lint
- type-check
- test
- test:coverage
- dup-check
- build

## Troubleshooting

| Issue                               | Solution                                                      |
| ----------------------------------- | ------------------------------------------------------------- |
| Import errors with `.ts` extension  | Use `.js` extension in imports (NodeNext resolution)          |
| Type errors after dependency update | Run `npm run type-check` to identify issues                   |
| Tests fail to run                   | Ensure Node.js >= 20; tsx handles TS execution                |
| Storage file not found              | Set `TODOKIT_TODO_FILE` env var or let it create `todos.json` |
| MCP Inspector connection fails      | Ensure `npm run build` completed successfully                 |

## Agent Operating Rules

1. **Search before edit**: Use grep/search to understand existing patterns before modifying code
2. **Verify imports**: Check that imported functions/types actually exist in source files
3. **Follow existing patterns**: Match the style of surrounding code (especially tool registration)
4. **Run checks**: Always run `npm run lint && npm run type-check` after changes
5. **No destructive commands**: Avoid `rm -rf` on source directories without confirmation
6. **Respect complexity limits**: Functions must have complexity ≤ 5, depth ≤ 2, lines ≤ 40
