# AGENTS.md

## Project Overview

- MCP (Model Context Protocol) server for “Todokit” that manages todos using local JSON storage.
- Tech stack: Node.js (ESM), TypeScript, @modelcontextprotocol/sdk, Zod.
- Runtime entrypoint: dist/index.js (stdio transport; no HTTP endpoint).

## Repo Map / Structure

- src/
  - index.ts: MCP server entrypoint.
  - tools/: tool registration/handlers (e.g., add/update/list/delete).
  - schemas/: Zod input/output schemas and ISO date helpers.
  - lib/: storage (JSON file), filtering/mutations, logging/diagnostics, shared types.
- tests/: Node test runner tests (tests/\*.test.ts).
- dist/: TypeScript build output (also referenced by package.json main/bin).
- docs/: assets (logo).
- scripts/Quality-Gates.ps1: PowerShell quality gates (metrics + safe refactor flow).
- .github/workflows/publish.yml: publish pipeline and required checks.

## Setup & Environment

- Required Node.js version: >= 20.0.0 (from package.json engines).
- Install dependencies (CI-style):
  - npm ci
- Install dependencies (local dev):
  - npm install
- Configuration (runtime):
  - TODOKIT_TODO_FILE: path to the JSON storage file (absolute or relative; relative resolves from current working directory).
  - TODOKIT_JSON_PRETTY: set to 0 or false to write compact JSON instead of pretty JSON.
- CLI flags (see README.md for details):
  - --todo-file (alias -f)
  - --diagnostics (alias -d)
  - --log-level (alias -l)

## Development Workflow

- Dev/watch mode (runs directly from src):
  - npm run dev
- Build:
  - npm run build
- Run built server (stdio):
  - npm start
- MCP Inspector (script provides the inspector executable; pass server command after --):
  - npm run inspector -- node dist/index.js

## Testing

- Run tests:
  - npm run test
- Run tests with coverage:
  - npm run test:coverage
- Test files live in:
  - tests/\*.test.ts

## Code Style & Conventions

- Formatting:
  - npm run format
  - npm run format:check
- Linting:
  - npm run lint
- Type-check:
  - npm run type-check
- ESLint is configured for strict, type-checked rules on src/\*_/_.ts (see eslint.config.mjs).
- Prettier is configured with import sorting via @trivago/prettier-plugin-sort-imports (see .prettierrc).
- TypeScript module system is NodeNext + ESM (package.json type=module):
  - Use .js extensions in local imports.
  - Prefer type-only imports (inline type imports).

## Build / Release

- Build output: dist/ (package.json main/types/bin point to dist).
- Clean build output:
  - npm run clean
- Release/publish:
  - GitHub Actions workflow .github/workflows/publish.yml runs on GitHub Release “published”.
  - Pipeline runs: lint, type-check, test, test:coverage, dup-check, build.
  - Publish uses npm Trusted Publishing (OIDC); no npm token is used in the workflow.
  - Version is extracted from the release tag name (vX.Y.Z) and written into package.json before publish.

## Security & Safety

- Stdio transport: do not write non-MCP output to stdout (use stderr for diagnostics/logging).
- JSON storage path safety:
  - Prefer absolute TODOKIT_TODO_FILE in automated environments.
  - Be cautious when changing storage semantics (data migration/compatibility).
- Input validation:
  - Tool inputs are validated via Zod schemas; keep schemas strict and bounded.

## Pull Request / Commit Guidelines

- Before opening a PR, run the same checks as CI/publish:
  - npm run lint
  - npm run type-check
  - npm run test
  - npm run test:coverage
  - npm run dup-check
  - npm run build
- Optional refactor safety harness (PowerShell):
  - scripts/Quality-Gates.ps1

## Troubleshooting

- Build/test failures on older Node versions:
  - Ensure node --version is >= 20.
- Inspector usage:
  - If npm run inspector launches but the server doesn’t connect, ensure you passed the server command after -- (example above).
- Data file location confusion:
  - TODOKIT_TODO_FILE relative paths resolve from your current working directory.

## Open Questions / TODO

- .github/instructions/typescript-mcp-server.instructions.md mentions Zod v3, but package.json depends on Zod v4.3.5. If that instruction file is intended to be authoritative, it should be updated to match the current dependency.
