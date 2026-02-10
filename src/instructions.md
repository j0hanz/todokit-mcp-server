# Todokit Instructions

> Guidance for the Agent: These instructions are available as a resource (`internal://instructions`) or prompt (`get-help`). Load them when you are unsure about tool usage.

## 1. Core Capability

- **Domain:** Local persistent todo list manager storing tasks in a JSON file.
- **Primary Resources:** `Todo` items, list `counts`, metadata (`summary`, `hint`).

## 2. The "Golden Path" Workflows (Critical)

_Describe the standard order of operations using ONLY tools that exist._

### Workflow A: Daily Triage

1. Call `list_todos` (default `status='pending'`) to see active tasks.
2. Call `add_todo` (single) or `add_todos` (batch) to capture new work.
3. Call `update_todo` or `complete_todo` to manage progress.
   > Constraint: Never guess IDs. Always list first.

### Workflow B: Cleanup & Verification

1. Call `list_todos` with `status='completed'` to review finished items.
2. Call `delete_todo` to remove items permanently.
3. Call `list_todos` again to confirm remaining items.

## 3. Tool Nuances & Gotchas

_Do NOT repeat JSON schema. Focus on behavior and pitfalls._

- **`list_todos`**
  - **Purpose:** List todos with optional status filtering.
  - **Inputs:** `status` ('pending'|'completed'|'all', default 'pending'), `limit` (1-100), `cursor` (opaque).
  - **Pagination:** Use the returned `nextCursor` to fetch the next page.

- **`search_todos`**
  - **Purpose:** Search by description/category with optional status filtering.
  - **Inputs:** `query`, optional `status`, optional `limit`, optional `cursor`.
  - **Pagination:** Use the returned `nextCursor` to continue a search.

- **`add_todos`**
  - **Purpose:** Create multiple tasks in one batch (preferred over `add_todo`).
  - **Inputs:** Array of items; `priority` (low/medium/high), `category` (work/bug/testing/docs).

- **`update_todo`**
  - **Purpose:** Modify fields of an existing todo.
  - **Inputs:** `id` required; at least one field (`description`, `priority`, etc.) must be provided.
  - **Common failure modes:** `E_BAD_REQUEST` if no update fields provided.

- **`complete_todo`**
  - **Purpose:** Mark a task as completed.
  - **Side effects:** Idempotent; records `completedAt` timestamp.

- **`delete_todo`**
  - **Purpose:** Permanently remove a task.
  - **Side effects:** Destructive; **confirm intent** before calling.

## 4. Error Handling Strategy

- **`E_NOT_FOUND`**: Call `list_todos` to verify IDs.
- **`E_INVALID_PARAMS`**: Check enum values and date formats.
- **`E_STORAGE_CONFLICT`**: Retry the operation (concurrency handled internally but may bubble up).
- **`E_STORAGE_TOO_LARGE`**: Delete completed items to free space.
