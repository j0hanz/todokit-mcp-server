# AGENTS.md

## Project Overview

- MCP (Model Context Protocol) server that manages a JSON-backed todo list.
- Tech stack: Node.js (ESM), TypeScript, `@modelcontextprotocol/sdk` (stdio transport), Zod v4.
- Primary entrypoint/binary: `dist/index.js` (package bin: `todokit-mcp`).

## Repo Map / Structure

- `src/`: server implementation
  - `src/index.ts`: stdio server entrypoint + CLI parsing + shutdown handling
  - `src/tools.ts`: MCP tool registrations + diagnostics wrapper
  - `src/schema.ts`: Zod schemas and shared types
  - `src/storage.ts`: JSON persistence (queued writes + atomic writes)
  - `src/diagnostics.ts`: diagnostics channels + optional stderr subscribers
  - `src/responses.ts`: tool response helpers (`content` + `structuredContent`)
- `tests/`: `node:test` test suite (`tests/*.test.ts`)
- `docs/`: assets (e.g., `docs/logo.png`)
- `.github/workflows/`: CI automation (publish workflow)
- `scripts/`: repo tooling (e.g., `scripts/Quality-Gates.ps1`)
- Build/test artifacts (generated): `dist/`, `coverage/`, `report/`, `logs/`, `metrics/`

## Setup & Environment

- Node.js: `>=20.0.0` (see `package.json` engines; CI uses Node 20).
- Install dependencies:
  - `npm install`
  - CI uses `npm ci`

## Development Workflow

- Dev (watch): `npm run dev` (runs `tsx watch src/index.ts`).
- Build: `npm run build` (TypeScript build to `dist/`).
- Run built server: `npm start`.
- MCP Inspector (stdio): `npm run inspector -- node dist/index.js`.

Configuration (verified in `src/index.ts` + `src/storage.ts`):

- Storage path:
  - Env: `TODOKIT_TODO_FILE` (absolute or relative; resolved against current working directory).
  - CLI: `--todo-file` / `-f` (sets `TODOKIT_TODO_FILE` at startup).
- JSON formatting:
  - Env: `TODOKIT_JSON_PRETTY`
  - If set to `0` or `false`, writes compact JSON; otherwise pretty-prints with 2 spaces.
- Diagnostics:
  - CLI: `--diagnostics` / `-d` enables default subscribers.
  - CLI: `--log-level` / `-l` one of `error|warn|info|debug` (only used when diagnostics enabled).

## Testing

- Run all tests: `npm run test` (executes `node --import tsx/esm --test tests/*.test.ts`).
- Coverage: `npm run test:coverage`.
- Test locations/patterns: `tests/*.test.ts`.

## Code Style & Conventions

- TypeScript:
  - ESM + NodeNext resolution (`"type": "module"`, `moduleResolution: "NodeNext"`).
  - Strict settings enabled: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `isolatedModules`.
  - Local imports use `.js` extensions (NodeNext ESM convention).
- Lint:
  - `npm run lint` (ESLint flat config in `eslint.config.mjs`).
- Format:
  - `npm run format` (writes)
  - `npm run format:check` (CI-friendly check)
- Zod:
  - Prefer `z.strictObject(...)` for object schemas (unknown fields rejected).
- MCP responses:
  - Tools return both `content` (stringified JSON) and `structuredContent`.

## Build / Release

- Build output: `dist/`.
- Local release gate (prepublish): `npm run prepublishOnly` (runs `lint`, `type-check`, `build`).
- GitHub release publishing:
  - Workflow: `.github/workflows/publish.yml` runs on GitHub Release “published”.
  - Checks executed before publish: `lint`, `type-check`, `test`, `test:coverage`, `dup-check`, `build`.
  - Versioning: workflow derives version from the git tag name (expects `vX.Y.Z`, strips leading `v`).
  - Publishing: `npm publish --access public` via npm Trusted Publishing (OIDC).

## Security & Safety

- Stdio transport: do not write non-MCP output to stdout (use stderr for diagnostics/logging).
- File I/O is local JSON storage; changing storage semantics should preserve:
  - queued writes (single-writer behavior)
  - atomic writes (`writeFile` to temp + rename)
  - timeouts for read/stat/write operations
- Avoid introducing network access or new dependencies unless required.

## Pull Request / Commit Guidelines

- No explicit commit message convention found in repo files.
- Before opening a PR, run the same checks as CI publish workflow:
  - `npm run lint`
  - `npm run type-check`
  - `npm run test`
  - `npm run test:coverage`
  - `npm run dup-check`
  - `npm run build`
- If formatting changes are included:
  - `npm run format:check` (or `npm run format` to fix).

## Troubleshooting

- Inspector fails:
  - Ensure build exists first: `npm run build`, then `npm run inspector -- node dist/index.js`.
  - If using `npx` and passing flags, forward args after `--` (e.g., `npx -y @j0hanz/todokit-mcp@latest -- --todo-file ./todos.json`).
- “Invalid todo storage format”:
  - The JSON file didn’t validate against the todo schema; fix the JSON or point `TODOKIT_TODO_FILE` to a new path.
- “Corrupted MCP protocol” symptoms:
  - Check for accidental stdout logging; only MCP traffic should go to stdout.
