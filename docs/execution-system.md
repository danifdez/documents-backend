## Execution System

The backend uses one durable `Execution` domain for asynchronous work. Queueing
is a capability of an execution; there is no parallel jobs table or API.

### Lifecycle

```text
queued → running → waiting → running → completed
             ↘ failed      ↘ cancelled
```

Backend creates root executions transactionally with their first
`execution.created` event and step graph. Models workers request compatible
ready steps over HTTP; Backend locks the step, creates a lease-bound attempt
and fences every result with that identity. Reentrant work is represented by
successor steps or child executions that preserve `rootExecutionId` and
reference `parentExecutionId`.

### Storage

| Table | Purpose |
|---|---|
| `executions` | UUID identity, tree links, payload, lifecycle and semantic final result |
| `execution_steps` | Durable work graph, dependencies, availability, deadlines and step results |
| `execution_step_attempts` | Worker claims, leases and fencing identities |
| `execution_result_receipts` | Idempotent result delivery and terminal ACK evidence |
| `execution_operations` | Durable operation intent, recovery class, outcome and effect state |
| `execution_events` | Append-only evidence ordered by root execution and sequence |
| `execution_artifacts` | Evidence manifest and optional prompt, response, tool, or snapshot bytes |

Backend owns coordination and terminal finalization. A worker only returns a
`StepResult`; receipt processing closes the attempt and the coordinator applies
authorized effects, schedules successors or completes the execution.

### Scheduling and recovery

| Interval | Action |
|---|---|
| Periodic coordinator tick | Resume executions whose dependencies or waits are now satisfied |
| Attempt recovery tick | Expire stale leases and return eligible steps to `ready` |
| Worker health tick | Mark workers without a recent heartbeat offline |
| Outbox publisher tick | Publish pending notifications idempotently |

Execution priorities are `high`, `normal`, and `background`; step selection
also considers numeric step priority, `availableAt`, deadlines, step kind and
declared task capabilities.

### API and evidence

- Product-specific asynchronous endpoints return `{ "executionId": "<uuid>" }`.
- `GET /executions/:rootExecutionId/events` pages the evidence log.
- `GET /executions/:rootExecutionId/bundle` exports an `ExecutionBundle` only
  when the request includes `x-evaluation-consent: granted`. The bundle's
  `policySummary` records that consent together with its evaluation purpose,
  `ai-train` destination, retention class, and caller access scope.
- Models registers, heartbeats, claims steps, downloads artifacts and submits
  results through `/models-work`; IA Browser never writes directly to PostgreSQL.

The permanent v1 contract is pinned under `contracts/execution/v1/`, and its
fixtures live under `test/contracts/execution/v1/fixtures/`.
