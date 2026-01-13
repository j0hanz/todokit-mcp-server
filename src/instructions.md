# Todokit MCP Server — AI Usage Instructions

Use this server to manage a small, persistent todo list (JSON file storage). Prefer using these tools over "remembering" state in chat.

## Operating Rules

- Use tools only when it changes or verifies the todo list (don't call tools "just to check").
- Prefer `list_todos` to establish state before updating/completing/deleting.
- Operate by `id` (all mutation tools require an exact `id`). If the user doesn't provide an id, list first and then ask which item to act on.
- Batch-create with `add_todos` when adding multiple items.
- Treat `delete_todo` as destructive: ask for explicit confirmation unless the user clearly requested deletion.
- If request is vague, ask clarifying questions.

### Strategies

- **Discovery:** Call `list_todos` (default: pending) to see current tasks. Use `status='all'` only if looking for completed items.
- **Action:** Chain tools efficiently: `list` → confirm ID → `update`/`complete`. Use `add_todos` for multiple items.

## Data Model

- **Todo:** `id` (string), `description` (1-2000 chars), `priority` (low|medium|high), `category` (work|bug|testing|docs), `completed` (boolean), `dueAt` (optional ISO 8601 offset).

## Workflows

### 1) Daily Triage

```text
list_todos(status='pending') → See what is open
add_todos(...) → Add new items in bulk
complete_todo(id=...) → Mark finished items
```

## Tools

### add_todo

Create a new task.

- **Use when:** User provides a single, clear task.
- **Args:** `description` (req), `priority` (req), `category` (req), `dueAt` (opt).
- **Returns:** `{ item, summary, nextActions }`

### add_todos

Create multiple tasks in one call.

- **Use when:** User provides 2+ tasks or a list.
- **Args:** `items` (array, 1-50 items).
- **Returns:** `{ items, summary, nextActions }`

### list_todos

List todos with an optional status filter.

- **Use when:** Checking potential duplicates, finding IDs, or reviewing workload.
- **Args:** `status` (pending|completed|all, default: pending).
- **Returns:** `{ items, summary, counts, truncated, hint }`

### update_todo

Update fields on a todo item.

- **Use when:** Renaming, rescheduling, or changing priority/category.
- **Args:** `id` (req), `description`, `priority`, `category`, `dueAt`.
- **Returns:** `{ item, summary, nextActions }`

### complete_todo

Mark a todo as completed.

- **Use when:** Task is done.
- **Args:** `id` (req).
- **Returns:** `{ item, summary, nextActions }`

### delete_todo

Delete a todo item by ID.

- **Use when:** Removing mistakes or duplicates (prefer completion for finished work).
- **Args:** `id` (req).
- **Returns:** `{ deletedIds, summary, nextActions }`

## Response Shape

Success: `{ "ok": true, "result": { ... } }`
Error: `{ "ok": false, "error": { "code": "...", "message": "..." } }`

### Common Errors

| Code                  | Meaning                   | Resolution                                |
| --------------------- | ------------------------- | ----------------------------------------- |
| `E_NOT_FOUND`         | Todo ID does not exist    | List todos to find correct ID             |
| `E_INVALID_PARAMS`    | Schema validation failed  | Check enums (priority/category) and types |
| `E_STORAGE_CONFLICT`  | File changed during write | Retry the operation                       |
| `E_STORAGE_TOO_LARGE` | File exceeds 5MB          | Clean up old todos                        |

## Limits

- **Pagination:** `list_todos` returns max 50 items.
- **Batch Size:** `add_todos` accepts max 50 items.
- **Storage:** File is automatically deleted when all tasks are completed.

## Security

- This server writes to a local JSON file (`todos.json` by default). Do not store sensitive credentials or PII in todo descriptions.
