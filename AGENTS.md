# AGENTS.md

## Project Overview

- **What**: MCP (Model Context Protocol) server for Todokit — a task management tool with JSON storage
- **Package**: `@j0hanz/todokit-mcp` on npm
- **Stack**: TypeScript, Node.js, Zod (validation), MCP SDK (`@modelcontextprotocol/sdk`)
- **Transport**: stdio (no HTTP endpoint)

## Repo Map / Structure

- `src/` — Source code (TypeScript)
  - `index.ts` — MCP server entrypoint (stdio transport, signal handlers)
  - `tools/` — Tool registrations (`add_todo`, `list_todos`, `update_todo`, etc.)
  - `schemas/` — Zod input/output schemas
  - `lib/` — Storage, matching, error classes, shared helpers
- `dist/` — Build output (generated, gitignored)
- `tests/` — Unit tests (`*.test.ts`)
- `benchmark/` — Performance benchmarks (`bench.ts`)
- `docs/` — Assets (logo)
- `.github/workflows/` — CI/CD (publish to npm on release)

## Setup & Environment

- **Install deps**: `npm install`
- **Node version**: `>=20.0.0` (see `engines` in package.json)
- **Env config**: `TODOKIT_TODO_FILE` — absolute or relative path to `todos.json` (default: project root)
- **No additional services required**

## Development Workflow

- **Dev mode** (watch): `npm run dev`
- **Build**: `npm run build`
- **Start** (production): `npm start`
- **Inspector**: `npm run inspector` then select `node dist/index.js`

## Testing

- **All tests**: `npm test`
- **Coverage**: `npm run test:coverage`
- **Watch mode**: Not provided; re-run `npm test` manually
- **Test pattern**: `tests/*.test.ts`
- **Runner**: Node.js built-in test runner (`node --test`) via tsx

## Code Style & Conventions

### Language & Compilation

- TypeScript `^5.9`, target ES2022, module NodeNext
- Strict mode enabled (`strict: true`)
- `noUncheckedIndexedAccess`, `noImplicitOverride`, `useUnknownInCatchVariables`

### Lint: `npm run lint`

- ESLint with `typescript-eslint` strict + stylistic presets
- `no-explicit-any`: error
- `consistent-type-imports` / `consistent-type-exports`: inline type imports
- `explicit-function-return-type`: required
- Complexity constraints: `complexity ≤ 5`, `max-depth ≤ 2`, `max-lines-per-function ≤ 40`
- Unused imports plugin enabled

### Format: `npm run format`

- Prettier with import sorting (`@trivago/prettier-plugin-sort-imports`)
- Single quotes, trailing commas (es5), 2-space indent, LF line endings
- Import order: `node:` → built-ins → `@modelcontextprotocol` → `zod/glob` → external → relative

### Duplicate check: `npm run dup-check`

- jscpd with threshold 3, minTokens 50

### Naming Conventions

- Files: `snake_case.ts` for lib/tools/schemas
- Exports: named exports preferred; `type` keyword for type-only exports

## Build / Release

- **Build output**: `dist/` (compiled JS + source maps)
- **Versioning**: Git tags (`vX.Y.Z`), automated via GitHub release
- **Publish trigger**: Creating a GitHub release runs `.github/workflows/publish.yml`
- **CI checks before publish**: lint → type-check → test → build
- **npm trusted publishing**: OIDC (no `NODE_AUTH_TOKEN` needed)

## Security & Safety

- **No secrets in code**: Use environment variables for configuration
- **Atomic writes**: Storage uses atomic JSON writes (write-then-rename)
- **Safe deletion**: `delete_todo` supports `dryRun` for previews
- **Input validation**: All tool inputs validated via Zod schemas

## Pull Request / Commit Guidelines

- **Required checks before PR**:

  ```bash
  npm run format
  npm run lint
  npm run type-check
  npm run build
  ```

- **Commit format**: Not enforced; keep messages descriptive
- **CI on release**: lint, type-check, test, build must pass

## Troubleshooting

| Issue                            | Fix                                                                        |
| -------------------------------- | -------------------------------------------------------------------------- |
| `Cannot find module` after clone | Run `npm install` then `npm run build`                                     |
| Type errors in IDE               | Ensure TypeScript version matches (`^5.9`); restart TS server              |
| Tests fail with import errors    | Use Node.js ≥20; tests use `--import tsx/esm`                              |
| Inspector doesn't connect        | Build first: `npm run build`, then run inspector with `node dist/index.js` |
| Storage path issues              | Set `TODOKIT_TODO_FILE` env var to absolute path                           |

## Agent Operating Rules

1. **Search before edit**: Use grep/search to understand existing patterns before modifying
2. **Verify imports**: Check `package.json` before adding dependencies
3. **Respect complexity limits**: Keep functions ≤40 lines, complexity ≤5, depth ≤2
4. **Type everything**: No `any`; use explicit return types
5. **Run checks**: Always run `npm run lint && npm run type-check` before committing
6. **Avoid destructive commands**: No `rm -rf` on source directories
