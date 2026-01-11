# AGENTS.md

## Project Overview

- This repository is an MCP (Model Context Protocol) server for “Todokit” (task management) with JSON file storage.
- Tech stack: Node.js (ESM), TypeScript, `@modelcontextprotocol/sdk`, `zod`.
- Server transport: stdio (no HTTP endpoint).

## Repo Map / Structure

- `src/`: TypeScript source
  - `src/index.ts`: MCP server entrypoint
  - `src/tools.ts`: tool registration + handlers
  - `src/schema.ts`: Zod input/output schemas
  - `src/storage.ts`: JSON persistence + CRUD
  - `src/responses.ts`: response builders
  - `src/diagnostics.ts`: Node `diagnostics_channel` integration
- `tests/`: Node test runner tests (`tests/*.test.ts`)
- `dist/`: build output (published entrypoint: `dist/index.js`)
- `docs/`: documentation assets (e.g., `docs/logo.png`)
- `scripts/`: repo utilities
  - `scripts/Quality-Gates.ps1`: quality gates / safe-refactor automation
- `.github/workflows/`: CI
  - `.github/workflows/publish.yml`: release publish workflow

## Setup & Environment

- Node.js: `>= 20.0.0` (see `package.json` `engines.node` and CI uses Node 20).
- Package manager: npm (repo includes `package-lock.json`).
- Install deps:
  - `npm install` (dev)
  - `npm ci` (CI / clean install)

### Runtime configuration (storage)

- `TODOKIT_TODO_FILE`: path to the JSON file used for persistence.
  - Can be absolute or relative; relative paths resolve from current working directory.
- `TODOKIT_JSON_PRETTY`: set to `0` or `false` to write compact JSON.

### CLI flags

- `--todo-file` / `-f`: override todo storage path (same as `TODOKIT_TODO_FILE`).
- `--diagnostics` / `-d`: enable JSON diagnostics output to stderr.
- `--log-level` / `-l`: diagnostics log level (`error`, `warn`, `info`, `debug`).

## Development Workflow

- Dev (watch): `npm run dev` (runs `tsx watch src/index.ts`).
- Build: `npm run build` (runs `tsc -p tsconfig.build.json`).
- Start built server: `npm start` (runs `node dist/index.js`).
- Clean build output: `npm run clean` (removes `dist/`).

## Testing

- All tests: `npm run test` (Node’s `--test` runner via `tsx/esm`).
- Coverage: `npm run test:coverage` (uses `--experimental-test-coverage`).
- Test files: `tests/*.test.ts`.

## Code Style & Conventions

- Language/runtime:
  - TypeScript with `tsconfig.json` set to `module`/`moduleResolution`: `NodeNext`.
  - ESM project (`package.json` has `"type": "module"`).
- Lint: `npm run lint` (flat config in `eslint.config.mjs`).
- Format: `npm run format` / `npm run format:check` (Prettier config in `.prettierrc`).
  - Imports are sorted via `@trivago/prettier-plugin-sort-imports`.
- Type-check: `npm run type-check` (runs `tsc --noEmit`).
- Duplication check: `npm run dup-check` (jscpd config in `.jscpd.json`).

### MCP/TypeScript-specific rules (repo policy)

The repo includes additional implementation rules for MCP servers:

- See `.github/instructions/typescript-mcp-server.instructions.md` for patterns like:
  - include `.js` extensions in local imports (NodeNext)
  - prefer type-only imports (`import { type X } ...`)
  - return `structuredContent` and also JSON-stringified `content` for compatibility
  - avoid writing non-MCP output to stdout for stdio servers

## Build / Release

- Build output directory: `dist/`.
- Package entrypoints:
  - `bin`: `todokit-mcp` → `dist/index.js`
  - `main`/`exports`: `dist/index.js`
- Prepublish gates (local): `npm run prepublishOnly` runs `lint`, `type-check`, then `build`.

### CI publishing

- GitHub Actions workflow: `.github/workflows/publish.yml`
  - Trigger: GitHub Release published
  - Runs: `npm ci`, `npm run lint`, `npm run type-check`, `npm run test`, `npm run test:coverage`, `npm run dup-check`, `npm run build`
  - Publishing uses npm Trusted Publishing (OIDC); no `NODE_AUTH_TOKEN` is used in the workflow.

## Security & Safety

- Stdio MCP server rule: do not write non-protocol output to stdout; diagnostics/logging (when enabled) goes to stderr.
- Storage writes:
  - Tools can modify/delete data in the configured JSON file (notably `clear_todos` deletes all items).
  - Be careful when changing defaults around `TODOKIT_TODO_FILE` or write behavior.
- Secrets:
  - Do not commit credentials or tokens.
  - CI publishing uses OIDC (see `.github/workflows/publish.yml`).

## Pull Request / Commit Guidelines

- No commit message convention is defined in repo docs.
- Before opening a PR, run the same gates CI runs:
  - `npm run format:check`
  - `npm run lint`
  - `npm run type-check`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run dup-check`
  - `npm run build`

## Troubleshooting

- Inspector (interactive MCP debugging): `npm run inspector`
  - Manual example from README: `npm run inspector -- node dist/index.js`
- ESM/loader issues:
  - This is an ESM project (`"type": "module"`); ensure you are using Node `>=20`.
- Formatting/lint disagreements:
  - Use `npm run format` then `npm run lint`.
- Refactor safety gates (Windows PowerShell):
  - Script: `scripts/Quality-Gates.ps1`
  - Example (measure baseline): `powershell -ExecutionPolicy Bypass -File scripts/Quality-Gates.ps1 -Mode Measure`
