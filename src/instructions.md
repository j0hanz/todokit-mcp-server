# Todokit MCP Server — AI Usage Instructions

Use this server to manage a small, persistent todo list (JSON file storage). Prefer using these tools over “remembering” tasks in chat.

## Operating Rules

- Use tools only when it changes or verifies the todo list (don’t call tools “just to check”).
- Prefer `list_todos` to establish state before updating/completing/deleting.
- Operate by `id` (all mutation tools require an exact `id`). If the user doesn’t provide an id, list first and then ask which item to act on.
- Batch-create with `add_todos` when adding multiple items.
- Treat `delete_todo` as destructive: ask for explicit confirmation unless the user clearly requested deletion.
- Keep entries atomic and actionable. If a request is vague, ask a clarifying question before creating todos.

## Data Model (What a Todo Looks Like)

Each todo has:

- `id` (string)
- `description` (string, 1–2000 chars)
- `completed` (boolean)
- `priority`: `low` | `medium` | `high`
- `category`: `work` | `bug` | `testing` | `docs`
- `dueAt` (optional): ISO 8601 timestamp with an explicit offset (RFC 3339), e.g. `2026-01-13T17:00:00Z` or `2026-01-13T17:00:00+02:00`

## Workflows (Recommended)

### 1) Capture tasks from the user

1. If the user gives multiple tasks, normalize into a short list.
2. Call `add_todos` once.
3. Return a brief summary and (optionally) suggest `list_todos` if they want to review.

### 2) Review what’s pending

1. Call `list_todos` with default status (pending).
2. If the list is truncated, narrow the request (use `status: "pending"`/`"completed"`) and/or ask which `id` to operate on.

### 3) Edit a todo

1. `list_todos` (unless user provided an `id`).
2. Confirm the target `id`.
3. Call `update_todo` with only the fields that change.

### 4) Complete work

1. `list_todos` (pending)
2. Call `complete_todo` with the chosen `id`.
3. Optionally re-list pending to show progress.

### 5) Cleanup

- Prefer completing items over deleting them.
- Only use `delete_todo` for mistaken/invalid entries.
- Note: when all todos are completed, the storage file is automatically deleted.

## Tools (What to Use, When)

### add_todo

Create exactly one todo.

- Use when: user provides a single, clear task.
- Args: `description`, `priority`, `category`, optional `dueAt`.

### add_todos

Create multiple todos in one call.

- Use when: user provides 2+ tasks or a list.
- Args: `items` (1–50), each with `description`, `priority`, `category`, optional `dueAt`.

### list_todos

List todos with an optional status filter.

- Use when: you need current state or need an `id` before acting.
- Args: optional `status` = `pending` (default) | `completed` | `all`.
- Notes: results can be truncated (returns up to 50 items). If truncated, narrow the filter or operate by `id`.

### update_todo

Update fields on a todo.

- Use when: user wants to rename/reprioritize/recategorize/reschedule.
- Args: `id` plus any of `description`, `priority`, `category`, `dueAt`.
- Notes: calling with no updatable fields returns an error.

### complete_todo

Mark a todo as completed.

- Use when: user confirms a task is done.
- Args: `id`.
- Notes: idempotent; completing an already-completed todo returns a “already completed” summary.

### delete_todo

Delete a todo by id.

- Use when: user explicitly wants removal (mistake/duplicate) and confirms.
- Args: `id`.

## Response Shape

All tools return JSON in both `structuredContent` and a JSON-stringified `content` text block.

- Success: `{ "ok": true, "result": { ... } }`
- Error: `{ "ok": false, "error": { "code": "E_CODE", "message": "..." } }`
