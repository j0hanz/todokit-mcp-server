# AGENTS.md

> **Purpose:** Context and strict guidelines for AI agents working in this repository.

## 1. Project Context

- **Domain:** MCP (Model Context Protocol) stdio server that manages a todo list with JSON-file persistence.
- **Tech Stack:**
  - **Language:** TypeScript (repo uses `typescript@5.9.3`)
  - **Runtime:** Node.js `>=20.0.0` (also used in CI)
  - **Framework/Protocol:** `@modelcontextprotocol/sdk` (stdio transport)
  - **Key Libraries:** `@modelcontextprotocol/sdk`, `zod`, `tsx` (dev/test runner support)
- **Architecture:** Single-package, layered modules: entrypoint (`src/index.ts`) → tool registration (`src/tools.ts`) → persistence (`src/storage.ts`) + shared schemas/responses/diagnostics.

## 2. Repository Map (High-Level Only)

- `src/`: MCP server implementation (tool registration, schemas, storage, diagnostics)
- `tests/`: Node.js built-in test runner (`node:test`) tests
- `.github/workflows/`: CI/release automation (publish workflow)
- `docs/`: documentation assets (e.g., logo)

> Note: Ignore `dist/` and `node_modules/`.

## 3. Operational Commands

- **Environment:** Node.js 20+ (ESM / NodeNext module resolution)
- **Install (CI-style):** `npm ci`
- **Dev (watch):** `npm run dev`
- **Test:** `npm run test`
- **Build:** `npm run build`

CI/release also runs: `npm run lint`, `npm run type-check`, `npm run test:coverage`, `npm run dup-check`.

## 4. Coding Standards (Style & Patterns)

- **Module System:** ESM + TypeScript `module: NodeNext`.
  - Local imports use `.js` extensions (even in `.ts` source).
- **Typing:** Strict TypeScript (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.).
- **Validation:** Zod schemas are `z.strictObject(...)` and reject unknown fields.
- **Tool Responses:** Tools return both `structuredContent` and a JSON string in `content` (compatibility requirement).
- **Preferred Patterns:**
  - Centralized helpers for results/errors (`src/responses.ts`).
  - Tool handlers map execution errors to coded error responses (no throwing for expected failures).
  - Storage uses queued writes + atomic writes + lock file (`.lock`) to reduce corruption and races.

## 5. Agent Behavioral Rules (The “Do Nots”)

- **Prohibited:** Do not write non-MCP output to **stdout** from the server; log to **stderr**.
- **Prohibited:** Do not remove `.js` extensions from local imports (NodeNext/ESM).
- **Prohibited:** Do not add `default` exports; keep named exports.
- **Prohibited:** Do not use `any` (lint forbids it).
- **Prohibited:** Do not edit `package-lock.json` manually.
- **Handling Secrets:** Never hardcode tokens/credentials; prefer environment variables.
- **Storage Safety:** Treat `delete_todo` as destructive; avoid deleting unless explicitly requested.

## 6. Testing Strategy

- **Framework:** Node.js built-in test runner (`node:test`) with `tsx` ESM loader.
- **Approach:** Tests isolate storage via temp dirs and `TODOKIT_TODO_FILE` (see `tests/setup.ts`). Tool tests use an in-memory MCP server harness (no real stdio).

## 7. Evolution & Maintenance

- **Update Rule:** If conventions change (scripts, tool names, response shapes), propose an update to this file in the same PR.
- **Feedback Loop:** If a build/test command fails twice, record the fix in a short “Common Pitfalls” note here.

### Common Pitfalls (Add as discovered)

- NodeNext ESM requires `.js` extensions in local imports.
- MCP transport uses stdio: keep stdout clean; emit logs/diagnostics to stderr.
- Storage auto-deletes the todo JSON file when all todos are completed.
