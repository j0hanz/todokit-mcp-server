# AGENTS.md

> Purpose: High-signal context and strict guidelines for AI agents working in this repository.

## 1) Project Context

- **Domain:** MCP Server for Todokit (Task management).
- **Tech Stack (Verified):**
  - **Languages:** TypeScript 5.x (`package.json`, `tsconfig.json`).
  - **Frameworks:** Node.js >=22.19.8 (`package.json`), MCP SDK (`@modelcontextprotocol/sdk`).
  - **Key Libraries:** `zod` (validation), `tsx` (runtime/testing), `eslint` (linting).
- **Architecture:** MCP Server (Service). Modular structure (`tools.ts`, `storage.ts`, `schema.ts`). Entry point `src/index.ts`.

## 2) Repository Map (High-Level)

- `src/`: Source code (TypeScript).
- `tests/`: Integration and Unit tests.
- `scripts/`: Custom build and test automation scripts (`tasks.mjs`).
- `assets/`: Static assets (instructions, etc.).
- `.github/workflows/`: CI/CD configurations.
  > Ignore generated/vendor dirs like `dist/`, `node_modules/`.

## 3) Operational Commands (Verified)

- **Environment:** Node.js >= 22.19.8 (`engines` in `package.json`).
- **Install:** `npm install`
- **Dev:** `npm run dev` (TypeScript watch) or `npm run dev:run` (Node watch).
- **Test:** `npm test` (Runs `node --test` via `scripts/tasks.mjs`).
- **Build:** `npm run build` (Full pipeline: clean, compile, validate, copy assets).
- **Lint/Format:** `npm run lint`, `npm run format` (Prettier).
- **Type-Check:** `npm run type-check`.

## 4) Coding Standards (Style & Patterns)

- **Naming:**
  - Source: CamelCase (`requestContext.ts`) or lowercase single words (`storage.ts`).
  - Tests: Kebab-case (`cli.test.ts`) or snake_case (`runtime_helpers.test.ts`).
- **Structure:**
  - `src/` contains core business logic and MCP definitions.
  - `scripts/tasks.mjs` acts as the single source of truth for build/test tasks.
- **Typing/Strictness:** Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true` in `tsconfig.json`).
- **Patterns Observed:**
  - Custom task runner pattern in `scripts/tasks.mjs`.
  - Node.js native test runner (`node --test`) used with `tsx` loader.
  - Zod used for schema validation (inferred from deps).

## 5) Agent Behavioral Rules (Do Nots)

- Do not introduce new dependencies without updating `package.json` and `package-lock.json`.
- Do not edit `dist/` directly; it is a build artifact.
- Do not bypass `scripts/tasks.mjs` when adding new build/test steps; update the script instead.
- Do not commit secrets or `.env` files.
- Do not disable `eslint` rules without explicit reason.

## 6) Testing Strategy (Verified)

- **Framework:** Node.js native test runner (`node --test`) with `tsx`.
- **Where tests live:** `tests/` and `src/__tests__/`.
- **Approach:**
  - Unit and Integration tests.
  - Tests run via `scripts/tasks.mjs` which handles loaders (`tsx`).

## 7) Common Pitfalls (Optional; Verified Only)

- **Build Failures:** Ensure `scripts/tasks.mjs` is used for build operations (`npm run build`) as it handles asset copying and validation which `tsc` alone does not.

## 8) Evolution Rules

- If conventions change, include an `AGENTS.md` update in the same PR.
- If a command is corrected after failures, record the final verified command here.
