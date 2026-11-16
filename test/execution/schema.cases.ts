import { randomUUID } from 'crypto';
import type { ExecutionFixture } from './fixture';

export function registerSchemaCases(getContext: ExecutionFixture): void {
  it('creates only canonical execution control columns', async () => {
    const { dataSource } = getContext();

    const columns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'executions'
        AND column_name IN (
          'attempt_id',
          'checkpoint',
          'claimed_by',
          'heartbeat_at',
          'lease_expires_at',
          'lease_granted_at',
          'origin',
          'priority',
          'result_receipt_id',
          'worker_id',
          'workspace_id'
        )
    `);
    expect(columns).toEqual([]);
  });

  it('creates the durable external effect journal in the base schema', async () => {
    const { dataSource } = getContext();

    const columns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'execution_effect_journal'
        AND column_name IN (
          'intent',
          'preparation_observation',
          'last_observation',
          'last_observed_at',
          'observation',
          'applied_at',
          'verified_at'
        )
      ORDER BY column_name
    `);
    const constraints = await dataSource.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'execution_effect_journal'::regclass
        AND conname = 'CHK_execution_effect_journal_status'
    `);

    expect(columns.map((row) => row.column_name)).toEqual([
      'applied_at',
      'intent',
      'last_observation',
      'last_observed_at',
      'observation',
      'preparation_observation',
      'verified_at',
    ]);
    expect(constraints).toEqual([
      expect.objectContaining({
        definition: expect.stringContaining("'inconclusive'"),
      }),
    ]);
  });

  it('creates consolidated base columns and indexes directly', async () => {
    const { dataSource } = getContext();

    const controlColumns = await dataSource.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (
          (table_name = 'executions' AND column_name IN (
            'progress_policy', 'progress_ledger', 'wait_reason',
            'wait_condition', 'resume_phase', 'wait_expires_at',
            'cancellation_requested_at', 'cancellation_reason'
          ))
          OR (table_name = 'execution_steps' AND column_name IN (
            'output_artifact_refs', 'finalize_on_failure',
            'continuation_processed_at', 'continuation_step_id'
          ))
          OR (table_name = 'execution_artifacts'
            AND column_name = 'produced_by_attempt_id')
          OR (table_name = 'workers' AND column_name IN (
            'worker_kind', 'owner_principal', 'protocol_version',
            'step_kinds', 'maximum_concurrency', 'credential_hash', 'revoked_at'
          ))
        )
      ORDER BY table_name, column_name
    `);
    const domainColumns = await dataSource.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND (table_name, column_name) IN (
          ('users', 'avatar_path'),
          ('projects', 'status'),
          ('threads', 'status'),
          ('docs', 'status'),
          ('resources', 'archived_at'),
          ('assistant_messages', 'event'),
          ('user_tasks', 'execution_operation_id')
        )
      ORDER BY table_name, column_name
    `);
    const consolidatedIndexes = await dataSource.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'IDX_projects_status',
          'IDX_threads_status',
          'IDX_docs_status',
          'IDX_resources_archived_at',
          'IDX_assistant_messages_assistant_id_id',
          'IDX_agent_messages_agent_id_id',
          'idx_user_tasks_reminder_at',
          'UQ_user_tasks_execution_operation',
          'IDX_executions_cancellation_pending',
          'IDX_execution_steps_continuation_step',
          'IDX_execution_artifacts_attempt',
          'IDX_workers_browser_owner'
        )
      ORDER BY indexname
    `);

    expect(controlColumns).toHaveLength(20);
    expect(domainColumns).toHaveLength(7);
    expect(consolidatedIndexes).toHaveLength(12);
  });

  it('enforces worker kind isolation in the base schema', async () => {
    const { dataSource } = getContext();

    await expect(
      dataSource.query(
        `INSERT INTO workers
          (id, name, worker_kind, owner_principal, step_kinds)
         VALUES ($1, 'Invalid Models tool', 'models', NULL, ARRAY['tool'])`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/CHK_workers_kind_scope/);
    await expect(
      dataSource.query(
        `INSERT INTO workers
          (id, name, worker_kind, owner_principal, step_kinds)
         VALUES ($1, 'Invalid Browser worker', 'browser', NULL, ARRAY['tool'])`,
        [randomUUID()],
      ),
    ).rejects.toThrow(/CHK_workers_kind_scope/);
  });

  it('creates current message and resource-date schemas directly', async () => {
    const { dataSource } = getContext();

    const retiredDateColumns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'resource_dates'
        AND column_name IN ('resolver', 'is_relative', 'anchor_date_used')
    `);
    const replyIndexes = await dataSource.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND indexname IN (
          'UQ_assistant_messages_execution_reply',
          'UQ_agent_messages_execution_reply'
        )
      ORDER BY indexname
    `);
    const retiredAssistantColumns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'assistants'
        AND column_name IN (
          'is_system',
          'pinned',
          'system_prompt'
        )
    `);
    const assistantFolderColumns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'assistants'
        AND column_name = 'folder_scope'
    `);
    const assistantOwnerColumns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'assistants'
        AND column_name = 'owner_principal'
    `);
    const agentOwnerColumns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'agents'
        AND column_name = 'owner_principal'
    `);
    const indexedFileOwnerColumns = await dataSource.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'indexed_files'
        AND column_name IN ('assistant_id', 'owner_type', 'owner_id')
      ORDER BY column_name
    `);
    const singletonConstraint = await dataSource.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'assistants'::regclass
        AND conname = 'CHK_assistants_singleton'
    `);
    const indexedOwnerConstraint = await dataSource.query(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'indexed_files'::regclass
        AND conname = 'CHK_indexed_files_owner_type'
    `);
    const retiredIndexedFileConstraint = await dataSource.query(`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'indexed_files'::regclass
        AND conname = 'UQ_indexed_files_file_path'
    `);

    expect(retiredDateColumns).toEqual([]);
    expect(retiredAssistantColumns).toEqual([]);
    expect(assistantFolderColumns).toEqual([{ column_name: 'folder_scope' }]);
    expect(assistantOwnerColumns).toEqual([{ column_name: 'owner_principal' }]);
    expect(agentOwnerColumns).toEqual([{ column_name: 'owner_principal' }]);
    expect(indexedFileOwnerColumns).toEqual([
      { column_name: 'owner_id' },
      { column_name: 'owner_type' },
    ]);
    expect(singletonConstraint).toEqual([]);
    expect(indexedOwnerConstraint).toHaveLength(1);
    expect(indexedOwnerConstraint[0].definition).toContain("'assistant'");
    expect(indexedOwnerConstraint[0].definition).toContain("'agent'");
    expect(retiredIndexedFileConstraint).toEqual([]);
    expect(replyIndexes).toEqual([
      { indexname: 'UQ_agent_messages_execution_reply' },
      { indexname: 'UQ_assistant_messages_execution_reply' },
    ]);
  });
}
