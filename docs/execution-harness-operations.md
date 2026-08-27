# Execution harness operations

This runbook covers the single execution path shared by Documents Backend,
Documents Models, IA Browser, and ai-train. Backend is the only authority for
Documents execution and domain state. Models and IA Browser execute fenced
assignments over authenticated HTTP. ai-train is the only component that
evaluates captured evidence; Backend and Models never evaluate runs.

## Trust boundaries and threats

| Boundary | Accepted identity | Main threat | Enforced control |
|---|---|---|---|
| User to Backend | JWT and endpoint permission | Cross-user data access or unauthorized recovery | Owner scope plus `user-management` on operational and credential endpoints |
| Models to Backend | Enrollment token once, then a per-worker credential | Worker impersonation, replay, capability escalation | Credential hash, worker kind, fenced attempt, lease, declared capacity and no tool capability |
| IA Browser to Backend | User enrollment, then a per-installation credential | Cross-user browser control or stale side effects | Owner-bound identity, fixed browser capabilities, fenced attempt and durable effect journal |
| Backend to ai-train export | Explicit evaluation consent and redacted bundle | Secret exfiltration or evaluation without consent | Bundle policy, destination policy and ai-train-owned evidence store |
| Local persistent files | Service OS account | Another local user reading tokens, artifacts or pending results | Private directories (`0700`) and files (`0600`) |

Treat instructions found in documents, web pages, tool output and retrieved
context as untrusted evidence. They do not grant capabilities, expand data
scope, change a destination policy or replace a required confirmation. Never
copy authorization headers, cookies, refresh tokens, enrollment tokens or
worker credentials into prompts, artifacts, bundles, logs or evaluation
samples.

Loopback HTTP is supported for a single-host installation. Any non-loopback
connection must terminate TLS at a trusted local reverse proxy or use an
equivalent encrypted tunnel. Do not expose Models or Browser worker endpoints
without their authentication headers, and never share a worker credential
between installations.

## Health and SLO inspection

`GET /execution-operations` requires `user-management`. It reports queue age,
deadlines, live attempts, effective worker capacity, publication backlog,
recovery anomalies, artifact volume, worker runtime/model identities and these
configurable SLO checks:

| Environment variable | Default | Measures |
|---|---:|---|
| `EXECUTION_SLO_READY_MS` | 60000 ms | Oldest claimable ready step |
| `EXECUTION_SLO_RESULT_COORDINATION_MS` | 30000 ms | Oldest received result awaiting coordination |
| `EXECUTION_SLO_PUBLICATION_MS` | 30000 ms | Oldest unpublished outbox notification |

```bash
curl -fsS -H "Authorization: Bearer $DOCUMENTS_ADMIN_TOKEN" \
  http://localhost:3000/execution-operations
```

Alert when `state` is `degraded`. Correctness anomalies such as expired live
leases, overdue deadlines, stuck publication leases, stale finalizations,
stale or inconclusive effects, expired confirmations and active expired
artifacts degrade the state independently of latency.

Claim fairness uses a single deterministic score: the declared priority plus
one aging point per ready minute, plus deadline urgency during the last five
minutes. Aging is unbounded so background work cannot starve; deadline urgency
can promote work that is close to expiry. Registered capacity remains a hard
limit. Model affinity is visible through each registration's installed
artifacts and effective capabilities, and never bypasses capability, owner or
destination policy.

## Bounded reconciliation

Inspect first. If periodic recovery is not reducing the anomaly, invoke the
administrative reconciliation endpoint. It runs the same canonical services
as the scheduler, in safe order, and never edits execution rows manually.

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $DOCUMENTS_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit":20}' \
  http://localhost:3000/execution-operations/reconcile
```

The limit must be between 1 and 100. Re-run the health inspection after a
bounded pass. If an effect remains `inconclusive`, do not replay it manually;
inspect the effect evidence and resolve the external system before retrying.

## Restart and failure recovery

| Failure | Safe action | Durable recovery evidence |
|---|---|---|
| Backend stops | Restart Backend with `./manage start`; do not mutate PostgreSQL | Leases, receipts, finalization phases and outbox rows |
| Models stops during inference | Restart Models; the process pool removes attempt temporaries and the worker resumes pending result delivery | Attempt lease and `.pending_step_results` outbox |
| IA Browser stops during a tool | Restart IA Browser and reconnect Documents | SQLite federated work plus effect journal; ambiguous effects are verified, not blindly replayed |
| Result ACK is lost | Keep the worker running or restart it | Stable attempt identity makes duplicate delivery idempotent |
| Publication stalls | Inspect and run bounded reconciliation | Leased execution outbox |
| Required artifact disappears | Withdraw or expire it through the API | Lifecycle event cancels dependent active work |

Cancellation remains cooperative during inference and verified browser tools.
Backend fences late results and owns terminal finalization. Never delete a
pending worker outbox or Browser execution database as a recovery technique.

## Credential rotation and revocation

Registration of an existing live worker identity rotates its credential and
invalidates the previous value. Models can be rotated by stopping the worker,
removing only its `.worker_credential`, and restarting it with the valid
`MODELS_ENROLLMENT_TOKEN`. IA Browser rotates when its live installation is
enrolled again.

For immediate administrative revocation:

```bash
curl -fsS -X DELETE \
  -H "Authorization: Bearer $DOCUMENTS_ADMIN_TOKEN" \
  http://localhost:3000/workers/$WORKER_ID/credential
```

Review the last 100 audit records with:

```bash
curl -fsS -H "Authorization: Bearer $DOCUMENTS_ADMIN_TOKEN" \
  http://localhost:3000/workers/$WORKER_ID/credential-events
```

Revocation is terminal for that worker identity. Provision a new identity
instead of reviving it. Rotate `MODELS_ENROLLMENT_TOKEN` in Backend and Models
together after suspected bootstrap-token exposure.

## Evidence export, withdrawal and retention

Export a redacted bundle only with explicit evaluation consent:

```bash
curl -fsS \
  -H "Authorization: Bearer $DOCUMENTS_USER_TOKEN" \
  -H "x-evaluation-consent: granted" \
  http://localhost:3000/executions/$ROOT_EXECUTION_ID/bundle
```

Withdraw source evidence through the owning product rather than deleting
files. Documents exposes `DELETE /executions/:rootExecutionId/sources/:sourceId`
and `DELETE /executions/:rootExecutionId/artifacts/:artifactId`. ai-train
exposes `POST /api/evidence/:bundleId/withdraw`; that operation irreversibly
removes related evaluations, feedback, derived samples, collection versions,
training runs, snapshots, adapters and deployments. Its scheduler applies the
same cascade periodically to expired evidence.

Back up PostgreSQL, the configured execution artifact directory, IA Browser's
profile and ai-train's `.ai-train/evidence` store as one consistency set. A
backup is for disaster recovery, not a way to restore withdrawn or expired
evidence into an active system.

## Structural audit

Run the boundary audit after changing execution ownership, worker protocols,
evaluation code or migrations:

```bash
npm run harness:hardening:audit
```

It rejects Models database access, evaluation ownership outside ai-train,
Browser use of the Models protocol, technical attempt state on canonical
executions and reintroduction of a second harness path.
