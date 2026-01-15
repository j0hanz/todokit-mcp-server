# Todokit Instructions

> **Guidance for the Agent:** These instructions are available as a resource (`internal://instructions`) or prompt (`get-help`). Load them when you are confused about tool usage.

## 1. Core Capability

- **Domain:** Manage a persistent local todo list stored in JSON.
- **Primary Resources:** `Todo` items, list `counts`, `summary`, and `hint` metadata.

## 2. The "Golden Path" Workflows (Critical)

### Workflow A: Daily Triage

1. Call `list_todos` (default `status='pending'`).
2. Call `add_todo` (single) or `add_todos` (batch) to capture new tasks.
3. Call `update_todo` or `complete_todo` to keep the list current.

> **Constraint:** Never guess IDs. Always list first.

### Workflow B: Cleanup & Verification

1. Call `list_todos` with `status='completed'` to review finished items.
2. Call `delete_todo` only when the user explicitly wants removal.
3. Call `list_todos` again to confirm remaining items.

## 3. Tool Nuances & "Gotchas"

- **`list_todos`**: Defaults to `status='pending'` and returns max 50 items; use `status='all'` to include completed items.
- **`add_todos`**: Prefer for 2+ items to reduce calls.
- **`update_todo`**: Requires at least one field; otherwise returns `E_BAD_REQUEST`.
- **`delete_todo`**: Destructive and non-idempotent—confirm intent first.
- **Storage behavior**: The JSON file is auto-deleted when all todos are completed.

## 4. Error Handling Strategy

- **`E_NOT_FOUND`**: Call `list_todos` with the right `status` to locate the ID.
- **`E_INVALID_PARAMS`**: Fix enum values or ISO-8601 date formats.
- **`E_STORAGE_CONFLICT`**: Re-list then retry the mutation once.
- **`E_STORAGE_TOO_LARGE`**: Complete/delete old items to reduce size.
