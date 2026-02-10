# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** MCP (Model Context Protocol) server for task management — a local, persistent todo list with JSON file storage, cursor pagination, and diagnostics.
- **Tech Stack (Verified):**
  - **Language:** TypeScript 5.9+ (see `package.json` devDependencies, `tsconfig.json`)
  - **Runtime:** Node.js ≥ 24 (see `package.json` `engines`)
  - **Framework:** `@modelcontextprotocol/sdk` ^1.26.0 — MCP server SDK v1.x (see `package.json` dependencies)
  - **Key Libraries:**
    - `zod` ^4.3.6 — schema validation with `z.strictObject()` (see `package.json`, `src/schema.ts`)
    - `tsx` ^4.21.0 — TypeScript execution for tests (see `package.json` devDependencies)
    - `eslint` ^9.39.2 + `typescript-eslint` ^8.54.0 (see `eslint.config.mjs`)
    - `prettier` ^3.8.1 + `@trivago/prettier-plugin-sort-imports` ^6.0.2 (see `.prettierrc`)
- **Architecture:** Single-package MCP server using stdio transport. Storage layer uses atomic JSON file writes with file-based locking and in-memory caching. Diagnostics via `node:diagnostics_channel`. Request context propagated via `AsyncLocalStorage`. (see `src/index.ts`, `src/storage.ts`, `src/diagnostics.ts`, `src/requestContext.ts`)

## 2) Repository Map (High-Level)

- `src/` — Main source code (see `tsconfig.json` `rootDir`)
  - `index.ts` — CLI entrypoint with shebang, server creation, transport wiring, shutdown handling
  - `tools.ts` — Tool registration, handler wrappers with timeout/abort/diagnostics
  - `storage.ts` — JSON file storage with Port/Adapter interfaces (`FileSystemPort`, `LockPort`), atomic writes, file locking, caching, `TodoRepository`
  - `schema.ts` — Zod schemas for all tool inputs/outputs using `z.strictObject()`
  - `responses.ts` — `createToolResponse()` / `createErrorResponse()` helpers
  - `diagnostics.ts` — `node:diagnostics_channel` publishers for tool, storage, and lifecycle events
  - `requestContext.ts` — `AsyncLocalStorage`-based request context
  - `constants.ts` — Error name/code constants
  - `instructions.md` — Server instructions resource (bundled into dist)
- `tests/` — Test files using `node:test` (see `tests/setup.ts`, `tests/*.test.ts`)
- `scripts/` — Build orchestration (`scripts/tasks.mjs`)
- `assets/` — Server icon (`assets/logo.svg`)
- `.github/workflows/` — CI/CD: publish to npm on release (see `publish.yml`)

> Ignore: `dist/`, `node_modules/`, `coverage/`, `.tsbuildinfo`

## 3) Operational Commands (Verified)

- **Environment:** Node.js ≥ 24, npm (see `package.json` `engines`, `package-lock.json`)
- **Install:** `npm ci` (see `.github/workflows/publish.yml`)
- **Dev (watch):** `npm run dev` → `tsc --watch --preserveWatchOutput` (see `package.json` scripts)
- **Dev (run):** `npm run dev:run` → `node --env-file=.env --watch dist/index.js` (see `package.json` scripts)
- **Build:** `npm run build` → clean, compile (`tsc -p tsconfig.build.json`), validate instructions, copy assets, chmod executable (see `scripts/tasks.mjs`)
- **Type-check:** `npm run type-check` → `tsc -p tsconfig.json --noEmit` (see `scripts/tasks.mjs`)
- **Test:** `npm run test` → builds first, then `node --test --import tsx/esm tests/**/*.test.ts` (see `scripts/tasks.mjs`)
- **Test with coverage:** `npm run test:coverage` → adds `--experimental-test-coverage` (see `scripts/tasks.mjs`)
- **Lint:** `npm run lint` → `eslint .` (see `package.json` scripts)
- **Lint fix:** `npm run lint:fix` → `eslint . --fix` (see `package.json` scripts)
- **Format:** `npm run format` → `prettier --write .` (see `package.json` scripts)
- **Duplication check:** `npm run dup-check` → `jscpd --config .jscpd.json` (see `package.json` scripts)
- **Dead code check:** `npm run knip` (see `package.json` scripts)
- **Inspector:** `npm run inspector` → `npx @modelcontextprotocol/inspector` (see `package.json` scripts)
- **Full validation sequence:** `npm run format; npm run lint; npm run type-check; npm run build; npm run test`

## 4) Coding Standards (Style & Patterns)

- **Naming:** camelCase for variables/functions, PascalCase for types/classes/enums, UPPER_CASE for constants. Enforced via `@typescript-eslint/naming-convention` (see `eslint.config.mjs`).
- **Imports:**
  - **Named exports only** — no default exports (see `.github/instructions/typescript-mcp-server.instructions.md`).
  - **Type-only imports** enforced: `import type { X }` or `import { type X }` (see `eslint.config.mjs` `consistent-type-imports` rule).
  - **`.js` extensions** required in local imports (NodeNext module resolution; see `tsconfig.json`).
  - **Import order** enforced by `@trivago/prettier-plugin-sort-imports`: node builtins → MCP SDK → zod → third-party → local (see `.prettierrc`).
- **TypeScript Strictness:** `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noFallthroughCasesInSwitch` — all enabled (see `tsconfig.json`).
- **Explicit return types** required on exported functions (see `eslint.config.mjs` `explicit-function-return-type` rule).
- **Formatting:** Prettier — single quotes, trailing commas (es5), 2-space indent, 80 char width, LF line endings (see `.prettierrc`).
- **Schemas:** All Zod schemas use `z.strictObject()` with `.describe()` on every parameter and bounds (`.min()`, `.max()`) on strings/arrays/numbers (see `src/schema.ts`, `.github/instructions/typescript-mcp-server.instructions.md`).
- **Tool output shape:** Always return both `content` (JSON text) and `structuredContent` in tool results. On failure set `isError: true` with `{ ok: false, error: { code, message } }` (see `src/responses.ts`, `.github/instructions/typescript-mcp-server.instructions.md`).
- **Patterns Observed:**
  - Port/Adapter pattern for I/O boundaries: `FileSystemPort`, `LockPort` interfaces decoupled from `NodeFileSystem`, `LockFileManager` implementations (observed in `src/storage.ts`).
  - Coded error domain: `StorageError` with `code` field; `createErrorResponse()` maps to structured output (observed in `src/storage.ts`, `src/responses.ts`).
  - Diagnostics-first instrumentation: every tool call and storage operation publishes events via `node:diagnostics_channel` channels `todokit:tool`, `todokit:storage`, `todokit:lifecycle` (observed in `src/diagnostics.ts`, `src/tools.ts`).
  - Request context via `AsyncLocalStorage` for correlating tool calls with storage events (observed in `src/requestContext.ts`, `src/diagnostics.ts`).
  - Atomic file writes: write to temp file, then rename with retry on transient OS errors (observed in `src/storage.ts` `NodeFileSystem.writeTextAtomic()`).
  - File-based locking with exponential backoff and ownership verification via `timingSafeEqual` (observed in `src/storage.ts` `LockFileManager`).
  - In-memory cache with mtime-based invalidation (observed in `src/storage.ts` `JsonFileStore`).
  - Cursor-based pagination using base64url-encoded JSON payloads (observed in `src/tools.ts`).
  - Tool wrapper with timeout, abort, and diagnostics tracing (observed in `src/tools.ts` `createWrappedHandler()`).
  - Shebang required: `src/index.ts` must start with `#!/usr/bin/env node` as the first line (see `.github/instructions/typescript-mcp-server.instructions.md`).
  - Logging to stderr only — never write non-MCP output to stdout (see `.github/instructions/typescript-mcp-server.instructions.md`).

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating `package.json` and running `npm install` to regenerate `package-lock.json`. (see `package.json`, `package-lock.json`)
- Do not edit `package-lock.json` manually. (see `package-lock.json`)
- Do not commit secrets; never print `.env` values; use `process.env` for config. (see `.gitignore` excludes `.env*`)
- Do not use default exports; use named exports only. (see `.github/instructions/typescript-mcp-server.instructions.md`)
- Do not write non-MCP output to stdout — use `console.error()` for logging. (see `.github/instructions/typescript-mcp-server.instructions.md`)
- Do not use `any` — `@typescript-eslint/no-explicit-any` is set to error. (see `eslint.config.mjs`)
- Do not omit `.js` extensions on local imports. (see `tsconfig.json` `moduleResolution: "NodeNext"`)
- Do not use `z.object()` — always use `z.strictObject()` for schema definitions. (see `.github/instructions/typescript-mcp-server.instructions.md`, `src/schema.ts`)
- Do not return tool results without both `content` and `structuredContent`. (see `src/responses.ts`, `.github/instructions/typescript-mcp-server.instructions.md`)
- Do not disable or bypass existing lint/type rules without explicit approval. (see `eslint.config.mjs`, `tsconfig.json`)
- Do not throw uncaught exceptions from tool handlers; return `isError: true` responses. (see `.github/instructions/typescript-mcp-server.instructions.md`)
- Do not remove the shebang line (`#!/usr/bin/env node`) from `src/index.ts`. (see `.github/instructions/typescript-mcp-server.instructions.md`)

## 6) Testing Strategy (Verified)

- **Framework:** `node:test` (Node.js built-in test runner) with `tsx` loader for TypeScript (see `scripts/tasks.mjs`, `package.json` devDependencies)
- **Where tests live:** `tests/*.test.ts` (see `scripts/tasks.mjs` `CONFIG.test.patterns`)
- **Setup:** `tests/setup.ts` — `beforeEach` creates a temp directory and sets `TODOKIT_TODO_FILE` env var; `afterEach` closes DB and cleans up. Each test runs in isolation. (see `tests/setup.ts`)
- **Approach:**
  - Unit tests with a mock `McpServer` harness that captures registered tools and calls handlers directly (observed in `tests/tools.test.ts`).
  - Storage tests use real filesystem via temp directories — no mocks for I/O. (see `tests/setup.ts`, `tests/storage.test.ts`)
  - Assertions via `node:assert/strict`. (observed in `tests/tools.test.ts`)
  - Tests import directly from `src/` (not `dist/`), run via `tsx`. (observed in test imports)
- **Coverage:** `npm run test:coverage` adds `--experimental-test-coverage`. (see `scripts/tasks.mjs`)
- **Timeout:** Test-level timeouts set per test (e.g., `TEST_TIMEOUT_MS = 5000`). (observed in `tests/tools.test.ts`)
- **No external services required.** Tests are fully self-contained with temp file storage.

## 7) Common Pitfalls (Verified)

- **Forgetting `.js` in imports** → TypeScript compiles but runtime fails with `ERR_MODULE_NOT_FOUND`. Always use `.js` extensions for local imports. (see `tsconfig.json` `moduleResolution: "NodeNext"`)
- **Using `z.object()` instead of `z.strictObject()`** → unknown fields silently pass validation. The codebase exclusively uses `z.strictObject()`. (see `src/schema.ts`)
- **Writing to stdout** → corrupts JSON-RPC stdio transport. Use `console.error()`. (see `.github/instructions/typescript-mcp-server.instructions.md`)
- **Forgetting `structuredContent`** → tool responses must include both `content` (text) and `structuredContent`. Use `createToolResponse()` / `createErrorResponse()` helpers. (see `src/responses.ts`)
- **Build required before test** → `npm run test` triggers a full build automatically via `scripts/tasks.mjs`. Running tests directly without `tsx` loader will fail.
- **Storage file auto-deletion** → when all todos are completed, the JSON file is automatically deleted. Tests must account for this behavior. (see `src/storage.ts` `deleteFile` flag in transactions)

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
- If a new critical path or pattern is discovered, add it to the relevant section with evidence.
