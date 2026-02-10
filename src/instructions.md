# Todokit Instructions

> Available as resource (`internal://instructions`) or prompt (`get-help`). Load when unsure about tool usage.

---

## CORE CAPABILITY

- Domain: Local persistent todo list manager storing tasks in a JSON file.
- Primary Resources: `Todo` items, list `counts`, metadata (`summary`, `hint`).
- Tools: `list_todos` `search_todos` (READ); `add_todo` `add_todos` `update_todo` `complete_todo` `delete_todo` (WRITE).

---

## THE "GOLDEN PATH" WORKFLOWS (CRITICAL)

### WORKFLOW A: Daily Triage

1. Call `list_todos` (default `status='pending'`) to see active tasks.
2. Call `add_todo` (single) or `add_todos` (batch) to capture new work.
3. Call `update_todo` or `complete_todo` to manage progress.
   > Constraint: Never guess IDs. Always list first.

### WORKFLOW B: Cleanup & Verification

1. Call `list_todos` with `status='completed'` to review finished items.
2. Call `delete_todo` to remove items permanently.
3. Call `list_todos` again to confirm remaining items.

---

## TOOL NUANCES & GOTCHAS

`list_todos`

- Purpose: List todos with optional status filtering.
- Input: `status` ('pending'|'completed'|'all', default 'pending').
- Limits: Use `nextCursor` for pagination. Max 100 items per page.

`search_todos`

- Purpose: Search by description or category text.
- Input: `query` (1–100 chars), optional `status`, `limit`, `cursor`.

`add_todos`

- Purpose: Create multiple tasks in one batch (preferred over `add_todo`).
- Input: Array of items; `priority` (low/medium/high), `category` (work/bug/testing/docs).

`update_todo`

- Purpose: Modify fields of an existing todo.
- Input: `id` required; at least one field (`description`, `priority`, etc.) must be provided.
- Common failure modes: `E_BAD_REQUEST` if no update fields provided.

`complete_todo`

- Purpose: Mark a task as completed.
- Side effects: Idempotent; records `completedAt` timestamp.

`delete_todo`

- Purpose: Permanently remove a task.
- Side effects: Destructive; **confirm intent** before calling.

---

## ERROR HANDLING STRATEGY

- `E_NOT_FOUND`: Call `list_todos` to verify IDs.
- `E_INVALID_PARAMS`: Check enum values and date formats.
- `E_STORAGE_CONFLICT`: Retry the operation.
- `E_STORAGE_TOO_LARGE`: Delete completed items to free space.

---

## RESOURCES

- `internal://instructions`: This document.
- `todo://list`: Live JSON list of active (pending) todos.
