# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** MCP (Model Context Protocol) server for task/todo management with local JSON file storage, published as `@j0hanz/todokit-mcp` on npm.
- **Tech Stack (Verified):**
  - **Languages:** TypeScript 5.9+ (see `package.json` devDependencies: `"typescript": "^5.9.3"`), Node.js >=24 (see `package.json` engines)
  - **Frameworks:** `@modelcontextprotocol/sdk` ^1.26.0 (see `package.json` dependencies)
  - **Key Libraries:** Zod ^4.3.6 (see `package.json` dependencies), ESLint 9.x with typescript-eslint (see `eslint.config.mjs`), Prettier 3.x with import-sort plugin (see `.prettierrc`)
- **Architecture:** Single-package MCP server using stdio transport. Tools registered via `registerAllTools()` function. Storage layer uses atomic JSON file writes with file-based locking and in-memory caching. Diagnostics emitted via `node:diagnostics_channel`. Request context propagated via `AsyncLocalStorage`. (see `src/index.ts`, `src/tools.ts`, `src/storage.ts`, `src/diagnostics.ts`, `src/requestContext.ts`)

## 2) Repository Map (High-Level)

- `src/`: Server source code — entrypoint, tool handlers, storage engine, schemas, response helpers, diagnostics (see `src/index.ts` for entrypoint)
- `tests/`: Unit tests using `node:test` with `tsx` loader (see `tests/setup.ts`, `tests/*.test.ts`)
- `scripts/`: Build orchestration script (`tasks.mjs`) — clean, compile, validate, copy assets, make executable (see `scripts/tasks.mjs`)
- `assets/`: Server icon (`logo.svg`) embedded as base64 data URI at startup (see `src/index.ts`)
- `.github/workflows/`: CI — `publish.yml` triggers on release to build, lint, test, and publish to npm via OIDC trusted publishing (see `.github/workflows/publish.yml`)

> Ignored: `dist/`, `node_modules/`, `coverage/`, `.tsbuildinfo`

## 3) Operational Commands (Verified)

- **Environment:** Node.js >=24 required (see `package.json` engines). No containerization. Uses `tsx` for test TypeScript loading (see `scripts/tasks.mjs`).
- **Install:** `npm ci` (see `.github/workflows/publish.yml` step "Install dependencies")
- **Dev:** `npm run dev` — `tsc --watch --preserveWatchOutput` (see `package.json` scripts). `npm run dev:run` — `node --env-file=.env --watch dist/index.js` (see `package.json` scripts)
- **Test:** `npm run test` — builds first, then runs `node --test --import tsx/esm` on `tests/**/*.test.ts` (see `scripts/tasks.mjs` TestTasks.test). `npm run test:coverage` for coverage (see `package.json` scripts, `.github/workflows/publish.yml`)
- **Build:** `npm run build` — clean → TypeScript compile (`tsconfig.build.json`) → validate instructions → copy assets → chmod 755 (see `scripts/tasks.mjs` Pipeline.fullBuild)
- **Type-check:** `npm run type-check` — `tsc -p tsconfig.json --noEmit` (see `scripts/tasks.mjs`, `package.json` scripts)
- **Lint:** `npm run lint` — `eslint .` (see `package.json` scripts, `.github/workflows/publish.yml`)
- **Format:** `npm run format` — `prettier --write .` (see `package.json` scripts)
- **Duplication check:** `npm run dup-check` — **UNVERIFIED** (referenced in CI `publish.yml` step "Run duplication check" but no matching script in `package.json`; likely uses `jscpd` per devDependencies and `.jscpd.json`)
- **Inspector:** `npm run inspector` — `npx @modelcontextprotocol/inspector` for debugging (see `package.json` scripts)
- **Dead code:** `npm run knip` — unused exports/dependencies detection (see `package.json` scripts)

## 4) Coding Standards (Style & Patterns)

- **Naming:** camelCase for variables/functions, PascalCase for types/classes/enums, UPPER_CASE for constants. Properties are unformatted. Enforced by `@typescript-eslint/naming-convention` (see `eslint.config.mjs`).
- **Structure:** All source in `src/`. One concern per file: `schema.ts` (Zod schemas), `storage.ts` (persistence), `tools.ts` (MCP tool registration + handlers), `responses.ts` (response helpers), `diagnostics.ts` (observability), `requestContext.ts` (AsyncLocalStorage), `constants.ts` (shared constants), `index.ts` (entrypoint + CLI + server wiring). (see `src/`)
- **Typing/Strictness:** TypeScript `strict` mode with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noImplicitOverride` (see `tsconfig.json`).
- **Patterns Observed:**
  - **Type-only imports required:** `import type { X }` enforced via `@typescript-eslint/consistent-type-imports` (see `eslint.config.mjs`)
  - **Named exports only:** No default exports; explicit return types on exported functions enforced via `@typescript-eslint/explicit-function-return-type` (see `eslint.config.mjs`)
  - **`.js` extensions in local imports:** Required by `moduleResolution: "NodeNext"` (see `tsconfig.json`, observed in all `src/*.ts` files)
  - **Strict Zod schemas:** `z.strictObject()` for all input/output schemas with `.describe()` on every parameter and `.min()`/`.max()` bounds (see `src/schema.ts`)
  - **Dual response pattern:** Every tool response sets both `content` (JSON text) and `structuredContent` via `createToolResponse()` / `createErrorResponse()` helpers (see `src/responses.ts`, `src/tools.ts`)
  - **Tool errors over protocol errors:** Tool failures return `isError: true` in the result rather than throwing exceptions (see `src/tools.ts`)
  - **Diagnostic channels:** Observability via `node:diagnostics_channel` with channels `todokit:tool`, `todokit:storage`, `todokit:lifecycle` (see `src/diagnostics.ts`)
  - **Atomic file writes:** Storage uses write-to-temp-then-rename with file-based locking and optimistic concurrency control (see `src/storage.ts`)
  - **Import ordering:** Enforced by Prettier with `@trivago/prettier-plugin-sort-imports`: node builtins → MCP SDK → zod → third-party → local (see `.prettierrc`)
  - **Shebang required:** `src/index.ts` must start with `#!/usr/bin/env node` as the first line (see `src/index.ts`)
  - **Graceful shutdown:** `SIGINT`/`SIGTERM` handlers close DB and server cleanly (see `src/index.ts`)
  - **`console.error()` for logging:** Never write non-MCP output to stdout (stdio transport hygiene) (see `src/index.ts`)

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating `package.json` and running `npm install` to regenerate `package-lock.json`. (see `package-lock.json`, `package.json`)
- Do not edit `package-lock.json` manually. (see `package-lock.json`)
- Do not commit secrets; never print `.env` values; use `process.env` for configuration with the `TODOKIT_*` prefix convention. (see `src/storage.ts`, `src/index.ts`, `.gitignore` listing `.env*`)
- Do not write anything to `stdout` except MCP JSON-RPC messages — use `console.error()` for logging. (see `src/index.ts`, stdio transport requirement)
- Do not use default exports — use named exports only. (see `eslint.config.mjs` rules, project convention)
- Do not use `zod/v3` — standardize on Zod v4 (`import { z } from 'zod'`). (see `package.json` dependencies: `"zod": "^4.3.6"`)
- Do not disable or bypass existing lint/type rules without explicit approval. (see `eslint.config.mjs`, `tsconfig.json`)
- Do not omit `.js` extensions in local imports — required by NodeNext module resolution. (see `tsconfig.json`)
- Do not omit `.describe()` on Zod schema parameters — required for LLM guidance. (see `src/schema.ts`)
- Do not throw uncaught exceptions from tool handlers — return `isError: true` via `createErrorResponse()`. (see `src/tools.ts`, `src/responses.ts`)
- Do not change public tool names/schemas without updating tests. (see `tests/tools.test.ts`, `tests/schemas.test.ts`)

## 6) Testing Strategy (Verified)

- **Framework:** `node:test` (Node.js built-in test runner) with `tsx` as the TypeScript loader (see `scripts/tasks.mjs`, `package.json` devDependencies: `"tsx": "^4.21.0"`)
- **Where tests live:** `tests/*.test.ts` (see `tests/` directory; `scripts/tasks.mjs` CONFIG.test.patterns: `['src/__tests__/**/*.test.ts', 'tests/**/*.test.ts']`)
- **Test files:** `cli.test.ts`, `diagnostics.test.ts`, `errors.test.ts`, `index.test.ts`, `match.test.ts`, `runtime_helpers.test.ts`, `schemas.test.ts`, `storage.test.ts`, `tools.test.ts` (see `tests/`)
- **Approach:** Pure unit tests. Each test creates a temporary directory for isolated JSON storage, cleaned up in `afterEach`. No external services, databases, or containers required. Tool tests use a mock `McpServer` harness that captures registered tools and invokes handlers directly. Assertions use `node:assert/strict`. (see `tests/setup.ts`, `tests/tools.test.ts`)
- **Setup:** `tests/setup.ts` — `beforeEach` creates `mkdtemp`, sets `TODOKIT_TODO_FILE` and `TODOKIT_ALLOW_OUTSIDE_CWD` env vars; `afterEach` calls `closeDb()`, cleans up env and temp dir. (see `tests/setup.ts`)
- **Coverage:** `npm run test:coverage` uses `--experimental-test-coverage` (see `scripts/tasks.mjs` getCoverageArgs)

## 7) Common Pitfalls (Verified)

- Build must succeed before tests — `npm run test` automatically triggers a full build first. Running `node --test` directly without building will fail. (see `scripts/tasks.mjs` TestTasks.test calling `Pipeline.fullBuild()`)
- `src/instructions.md` must exist — build validation checks for it and fails if missing. (see `scripts/tasks.mjs` BuildTasks.validate)
- Storage file is auto-deleted when all todos are completed — this is by design, not a bug. (see `src/storage.ts` TodoRepository.complete, tool descriptions in `src/tools.ts`)
- `TODOKIT_TODO_FILE` path must be within CWD unless `TODOKIT_ALLOW_OUTSIDE_CWD` is set — symlink traversal is blocked for security. (see `src/storage.ts` EnvStorageConfig.validatePathSafety)

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
- If a new critical path or pattern is discovered, add it to the relevant section with evidence.
