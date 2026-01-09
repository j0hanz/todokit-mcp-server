# AGENTS.md

## Project Overview

- This repo is an MCP (Model Context Protocol) **stdio** server that provides a todo/task-management toolset backed by **JSON file storage**.
- Tech stack: **TypeScript** (ESM, `moduleResolution: NodeNext`), **Node.js** `>=20`, \*\*@modelcontextprotocol/sdk`, Zod v4,`node:test`+`tsx` for tests.
- Entrypoint: `src/index.ts` (build outputs to `dist/index.js`, published as the `todokit-mcp` binary).

## Repo Map / Structure

- `src/`
  - `index.ts`: MCP server bootstrap (stdio), CLI arg parsing, shutdown hooks.
  - `tools.ts`: tool registrations + tool logic wrappers.
  - `storage.ts`: JSON persistence, filtering/matching, and CRUD operations.
  - `schema.ts`: Zod schemas and shared types.
  - `responses.ts`: tool response helpers (structuredContent + JSON string).
  - `diagnostics.ts`: diagnostics_channel publishing + default stderr subscribers.
- `tests/`: `node --test` test suite (files `tests/*.test.ts`).
- `dist/`: build output (generated).
- `.github/workflows/publish.yml`: release-time publish workflow (runs lint/type-check/tests/coverage/dup-check/build).
- `scripts/Quality-Gates.ps1`: optional quality/metrics and safe-refactor helper.
- `coverage/`, `report/`, `metrics/`, `logs/`: generated artifacts / reports.

## Setup & Environment

- Required Node.js: `>=20.0.0` (see `package.json#engines`).
- Package manager: `npm` (repo includes `package-lock.json`).
- Install deps:
  - `npm install`
  - CI-style install: `npm ci`

## Development Workflow

- Dev/watch (runs from source): `npm run dev` (uses `tsx watch src/index.ts`).
- Build: `npm run build` (outputs to `dist/`).
- Run built server: `npm start` (executes `node dist/index.js`).

Runtime configuration (supported by the code + README):

- Storage file path:
  - Env: `TODOKIT_TODO_FILE=/path/to/todos.json`
  - CLI: `--todo-file ./todos.json` (alias `-f`)
- JSON formatting:
  - `TODOKIT_JSON_PRETTY=0` or `false` to write compact JSON.
- Diagnostics:
  - CLI: `--diagnostics` (alias `-d`) to emit JSON diagnostics lines to **stderr**.
  - CLI: `--log-level error|warn|info|debug` (alias `-l`) controls diagnostic verbosity when enabled.

## Testing

- Run tests: `npm run test`
  - Script: `node --import tsx/esm --test tests/*.test.ts`
- Coverage: `npm run test:coverage`
  - Script: `node --import tsx/esm --test --experimental-test-coverage tests/*.test.ts`
- Test location/pattern: `tests/*.test.ts`.

## Code Style & Conventions

- Language/Module system:
  - TypeScript `strict` with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
  - ESM + NodeNext resolution; use **`.js` extensions** in local imports.
- Formatting:
  - `npm run format` (Prettier).
  - Import sorting is enforced via `@trivago/prettier-plugin-sort-imports` (see `.prettierrc`).
- Linting:
  - `npm run lint` (ESLint).
  - `eslint.config.mjs` enables `typescript-eslint` strict/stylistic configs and enforces unused-import removal rules.
- Types:
  - `npm run type-check` (`tsc --noEmit`).
- MCP response contract (repo convention):
  - Tool results include **both** `structuredContent` and a JSON string in `content`.
  - Avoid stdout logging in server runtime (stdio transport).

## Build / Release

- Build output directory: `dist/`.
- Primary build command: `npm run build`.
- Release publishing (GitHub Actions on `release: published`): `.github/workflows/publish.yml` runs:
  - `npm ci`
  - `npm run lint`
  - `npm run type-check`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run dup-check`
  - `npm run build`
  - `npm publish --access public` (Trusted Publishing / OIDC)

## Security & Safety

- **stdio rule**: do not write non-MCP output to stdout. Use stderr for logs/diagnostics.
- Avoid adding networked behavior without explicitly marking it (and updating tool annotations) — this server is primarily local file I/O.
- Prefer strict input validation (Zod) and bounded sizes (min/max) for tool inputs.
- Do not commit secrets. Use environment variables for runtime config.

## Pull Request / Commit Guidelines

- Before opening a PR, run the same checks CI runs:
  - `npm run format`
  - `npm run lint`
  - `npm run type-check`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run dup-check`
  - `npm run build`
- Optional: use `scripts/Quality-Gates.ps1` for measuring/comparing quality metrics and safe refactors.

## Troubleshooting

- “Client can’t parse MCP output” / protocol errors:
  - Ensure nothing writes to stdout (use stderr only).
- CLI flags not taking effect when using `npx`:
  - Forward args with `--`, e.g. `npx -y @j0hanz/todokit-mcp@latest -- --diagnostics`.
- Tests fail due to ESM loader issues:
  - Use the provided script (`npm run test`) which runs `node --import tsx/esm --test ...`.

## Open Questions / TODO

- None identified from repository files scanned (no missing/ambiguous workflow details found).
