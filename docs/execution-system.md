## Execution System

The backend uses one durable `Execution` domain for asynchronous work. Queueing
is a capability of an execution; there is no parallel jobs table or API.

### Lifecycle

```text
queued → running/worker_execution → running/backend_finalization → completed
                          ↘ waiting → queued                 ↘ failed
```

Backend creates root executions transactionally with their first
`execution.created` event. Models workers claim compatible rows with
`FOR UPDATE SKIP LOCKED`, assign a fresh `attemptId`, and fence checkpoint and
result writes with that attempt. Reentrant work can create child executions
that preserve `rootExecutionId` and reference `parentExecutionId`.

### Storage

| Table | Purpose |
|---|---|
| `executions` | UUID identity, tree links, payload, queue state, checkpoint, result, and retry fencing |
| `execution_events` | Append-only evidence ordered by root execution and sequence |
| `execution_artifacts` | Evidence manifest and optional prompt, response, tool, or snapshot bytes |

The backend owns terminal finalization. Workers leave successful results in
`running/backend_finalization`; `TaskScheduleService` applies domain effects
through `ExecutionProcessorFactory` and then marks the same execution
`completed` or `failed`.

### Scheduling and recovery

| Interval | Action |
|---|---|
| Every 5 seconds | Finalize the oldest execution waiting in `backend_finalization` |
| Every 30 seconds | Requeue stale worker attempts or fail them after `maxAttempts`; mark stale workers offline |

Priorities are `high`, `normal`, and `background`. Worker claims also filter by
`taskType`, declared capabilities, and `availableAt`.

### API and evidence

- `POST /executions` creates generic work and returns an execution with a UUID.
- Product-specific asynchronous endpoints return `{ "executionId": "<uuid>" }`.
- `GET /executions/:rootExecutionId/events` pages the evidence log.
- `GET /executions/:rootExecutionId/bundle` exports an `ExecutionBundle`.
- Models submits events and artifacts through the token-protected internal
  endpoints; IA Browser never writes directly to PostgreSQL.

The permanent v1 contract is pinned under `contracts/execution/v1/`, and its
fixtures live under `test/contracts/execution/v1/fixtures/`.
