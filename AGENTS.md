# AGENTS.md

## Project Overview

- Minimal Model Context Protocol (MCP) server for managing a to-do list (add/list/complete/delete).
- Tech stack: TypeScript (ESM, `module: NodeNext`) + Node.js `>=20` + `@modelcontextprotocol/sdk` + Zod.
- Persistence: stores todos in `todos.json` at the repository root (created on first write).

## Repo Map / Structure

- `src/`: TypeScript source
  - `src/index.ts`: MCP server entrypoint (stdio transport)
  - `src/tools/`: MCP tool registrations
    - `add_todo`, `list_todos`, `complete_todo`, `delete_todo`
  - `src/lib/`: shared logic
    - `storage.ts`: JSON file persistence + caching/serialization
    - `types.ts`: `Todo` type
    - `errors.ts`: standard MCP tool error responses
  - `src/schemas/`: Zod input/output schemas used by tools
- `dist/`: build output from `tsc` (`npm run build`)
- `.github/instructions/`: repo-specific rules for MCP server implementation

## Setup & Environment

- Node.js: `>=20.0.0` (see `package.json#engines`)
- Install deps: `npm install`
- Package manager: `npm` (lockfile: `package-lock.json`)

## Development Workflow

- Format: `npm run format`
- Lint: `npm run lint`
- Type-check (no emit): `npm run type-check`
- Dev (watch): `npm run dev`
- Build (emit to `dist/`): `npm run build`
- Run built server: `npm start`

## Testing

- No `test` script is defined in `package.json`.
- Manual verification (stdio MCP inspector) is documented in `.github/instructions/typescript-mcp-server.instructions.md`:
  - `npx @modelcontextprotocol/inspector node dist/index.js`

## Code Style & Conventions

- Language/runtime:
  - TypeScript `strict: true` with `noUncheckedIndexedAccess: true`
  - ESM with NodeNext resolution (`"type": "module"`)
- Imports:
  - Use `.js` extensions for local imports (example: `./tools/index.js`).
  - Prefer type-only imports (example: `import type { McpServer } ...`).
- ESLint: `npm run lint` (configured in `eslint.config.mjs`)
  - Notable rules: no `any`, explicit return types for exported functions, no floating promises, prefer `const`.
- Prettier: `npm run format` (configured in `.prettierrc`)
  - Import sorting via `@trivago/prettier-plugin-sort-imports`.

## Build / Release

- Build: `npm run build` (runs `tsc`)
- Output: `dist/` (see `tsconfig.json#compilerOptions.outDir`)
- Start/prod: `npm start` (runs `node dist/index.js`)
- CI/release automation: no GitHub Actions workflows found in `.github/workflows/`.

## Security & Safety

- Secrets:
  - Keep credentials out of source control; use environment variables.
  - `.env*` files are ignored by `.gitignore`.
  - `.vscode/*` is ignored by `.gitignore` except `extensions.json` and `tasks.json`.
- stdio transport:
  - Avoid writing non-MCP data to stdout; use `console.error()` for logs.
- Persistence:
  - Todos are written to `todos.json` (plain JSON). Don’t store sensitive data in todo fields.

## Pull Request / Commit Guidelines

- Before opening a PR, run:
  - `npm run format`
  - `npm run lint`
  - `npm run type-check`
  - `npm run build`
- Keep changes consistent with existing patterns:
  - Tools return both `content` (stringified JSON) and `structuredContent`.
  - Use shared schemas from `src/schemas/` and shared error helper from `src/lib/errors.ts`.

## Troubleshooting

- `npm start` fails with missing `dist/index.js`:
  - Run `npm run build` first.
- Todos aren’t persisting:
  - Check write permissions for `todos.json` at repo root.
- VS Code task “test” fails:
  - `npm run test` is referenced in `.vscode/tasks.json`, but there is no `test` script in `package.json`.

## Open Questions / TODO

- Add or remove the VS Code `test` task: either define a `test` script in `package.json` or delete the task from `.vscode/tasks.json`.
- If CI is desired, add workflows under `.github/workflows/` (the repo’s `.gitignore` is set up to allow that folder).
