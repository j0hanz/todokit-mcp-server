# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** Model Context Protocol (MCP) server for Todokit task management.
- **Tech Stack (Verified):**
  - **Languages:** TypeScript 5.9.x, Node.js >= 20.0.0 (`package.json`).
  - **Frameworks:** `@modelcontextprotocol/sdk` (`package.json`).
  - **Key Libraries:** `zod` (validation), `tsx` (execution), `eslint`/`prettier` (style).
- **Architecture:** Modularized MCP server (Handlers in `tools.ts`, Logic in `storage.ts`, Types in `schema.ts`).

## 2) Repository Map (High-Level)

- `src/`: Source code (Typescript).
- `tests/`: Test files (`*.test.ts`).
- `.github/`: CI/CD workflows and prompt context.
  > Ignore `dist/`, `node_modules/`, `coverage/`.

## 3) Operational Commands (Verified)

- **Environment:** Node.js >= 20.
- **Install:** `npm ci`
- **Dev:** `npm run dev` (Runs `tsx watch src/index.ts`)
- **Test:** `npm run test` (Runs `node --test tests/*.test.ts`)
- **Build:** `npm run build` (Clean + tsc + copy assets)
- **Lint/Format:** `npm run lint` / `npm run format`

## 4) Coding Standards (Style & Patterns)

- **Naming:**
  - **Types/Schemas:** PascalCase (e.g., `AddTodoSchema`, `Todo`).
  - **Functions/Vars:** camelCase (e.g., `handleAddTodo`).
  - **Constants:** SCREAMING_SNAKE_CASE (e.g., `DEFAULT_TOOL_TIMEOUT_MS`).
- **Structure:**
  - Tool definitions and handlers live in `src/tools.ts`.
  - Data models and Zod schemas live in `src/schema.ts`.
  - Persistence logic lives in `src/storage.ts`.
- **Typing/Strictness:** strict mode enabled (`"strict": true`, `"noUncheckedIndexedAccess": true`).
- **Patterns Observed:**
  - **Tool Registration:** Use `registerToolWithDiagnostics` wrapper for error handling/tracing.
  - **Response Helpers:** Use `createToolResponse` / `createErrorResponse` (from `src/responses.ts`).
  - **Validation:** Extensive use of `zod` for input/output validation.

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without explicit instruction (use `npm install`).
- Do not modify `package-lock.json` manually.
- Do not bypass Zod schema definitions; ensure all inputs/outputs match strict schemas.
- Do not remove `npm run type-check` or `npm run lint` steps from the workflow.
- Do not use `console.log` for production logging; use the diagnostics/logging utilities.

## 6) Testing Strategy (Verified)

- **Framework:** Node.js native test runner (`node:test`) with `tsx`.
- **Where tests live:** `tests/*.test.ts`.
- **Approach:**
  - Tests run directly against TypeScript source using `tsx` loader.
  - Coverage available via `npm run test:coverage`.

## 7) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
