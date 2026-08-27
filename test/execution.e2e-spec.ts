import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource, In } from 'typeorm';
import { CreateProjects1757668140000 } from '../migrations/1757668140000-CreateProjects';
import { CreateExecutions1757668140001 } from '../migrations/1757668140001-CreateExecutions';
import { CreateWorkers1757668140002 } from '../migrations/1757668140002-CreateWorkers';
import { CreatePermissionGroups1757668140003 } from '../migrations/1757668140003-CreatePermissionGroups';
import { CreateUsers1757668140005 } from '../migrations/1757668140005-CreateUsers';
import { CreateThreads1757668140010 } from '../migrations/1757668140010-CreateThreads';
import { CreateResources1757668140011 } from '../migrations/1757668140011-CreateResources';
import { CreateDocs1757668140012 } from '../migrations/1757668140012-CreateDocs';
import { CreateResourceDates1757668140030 } from '../migrations/1757668140030-CreateResourceDates';
import { CreateAssistantTables1757668140070 } from '../migrations/1757668140070-CreateAssistantTables';
import { CreateAssistantMemoryEntries1757668140080 } from '../migrations/1757668140080-CreateAssistantMemoryEntries';
import { CreateIndexedFiles1757668140100 } from '../migrations/1757668140100-CreateIndexedFiles';
import { CreateAgents1757668140110 } from '../migrations/1757668140110-CreateAgents';
import { CreateAgentMessages1757668140111 } from '../migrations/1757668140111-CreateAgentMessages';
import { CreateUserTasks1757668140200 } from '../migrations/1757668140200-CreateUserTasks';
import { CreateVectorTables1757668140320 } from '../migrations/1757668140320-CreateVectorTables';
import { CreateExecutionControlPlane1757668140370 } from '../migrations/1757668140370-CreateExecutionControlPlane';
import { CreateExecutionOutbox1757668140400 } from '../migrations/1757668140400-CreateExecutionOutbox';
import { CreateExecutionOperations1757668140410 } from '../migrations/1757668140410-CreateExecutionOperations';
import { CreateExecutionToolPlans1757668140420 } from '../migrations/1757668140420-CreateExecutionToolPlans';
import { CreateExecutionConfirmations1757668140720 } from '../migrations/1757668140720-CreateExecutionConfirmations';
import { CreateConversationSessions1757668140730 } from '../migrations/1757668140730-CreateConversationSessions';
import { ReplaceAssistantMemory1757668140740 } from '../migrations/1757668140740-ReplaceAssistantMemory';
import { CreateSkillActivations1757668140750 } from '../migrations/1757668140750-CreateSkillActivations';
import { CreateExecutionEffectJournal1757668140760 } from '../migrations/1757668140760-CreateExecutionEffectJournal';
import { ExecutionArtifactEntity } from '../src/execution/execution-artifact.entity';
import { ExecutionContractValidator } from '../src/execution/execution-contract-validator';
import { ExecutionEventEntity } from '../src/execution/execution-event.entity';
import { ExecutionEntity } from '../src/execution/execution.entity';
import { ExecutionResultReceiptEntity } from '../src/execution/execution-result-receipt.entity';
import { ExecutionAttemptService } from '../src/execution/execution-attempt.service';
import { ExecutionStepAttemptEntity } from '../src/execution/execution-step-attempt.entity';
import { ExecutionStepAttemptStatus } from '../src/execution/execution-step-attempt-status.enum';
import { ExecutionStepDependencyEntity } from '../src/execution/execution-step-dependency.entity';
import { ExecutionStepEntity } from '../src/execution/execution-step.entity';
import { ExecutionStepStatus } from '../src/execution/execution-step-status.enum';
import { ExecutionStepKind } from '../src/execution/execution-step-kind.enum';
import { StepAssignment } from '../src/execution/execution-control-plane.types';
import { ExecutionPriority } from '../src/execution/execution-priority.enum';
import { ExecutionStatus } from '../src/execution/execution-status.enum';
import {
  canonicalHash,
  contentHash,
  ExecutionService,
} from '../src/execution/execution.service';
import { WorkerEntity } from '../src/worker/worker.entity';
import { WorkerService } from '../src/worker/worker.service';
import { WorkerKind } from '../src/worker/worker-kind.enum';
import { ExecutionOutboxEntity } from '../src/execution-outbox/execution-outbox.entity';
import { ExecutionOperationEntity } from '../src/execution/execution-operation.entity';
import { ExecutionOperationStatus } from '../src/execution/execution-operation-status.enum';
import { ExecutionToolInvocationEntity } from '../src/execution/execution-tool-invocation.entity';
import { ExecutionToolPlanEntity } from '../src/execution/execution-tool-plan.entity';
import { ExecutionToolPlanService } from '../src/execution/execution-tool-plan.service';
import { ExecutionConfirmationEntity } from '../src/execution/execution-confirmation.entity';
import { ExecutionConfirmationService } from '../src/execution/execution-confirmation.service';
import { ExecutionToolRuntimeService } from '../src/execution-coordinator/execution-tool-runtime.service';
import { ExecutionEffectJournalEntity } from '../src/execution/execution-effect-journal.entity';
import { ExecutionEffectJournalService } from '../src/execution/execution-effect-journal.service';
import { ExecutionAgentLoopService } from '../src/execution-coordinator/execution-agent-loop.service';
import { ExecutionTerminalCandidateService } from '../src/execution-coordinator/execution-terminal-candidate.service';
import { ExecutionArtifactStorageService } from '../src/execution/execution-artifact-storage.service';
import { ChatExecutionPayload } from '../src/execution/execution-task-payload.types';
import {
  assertOperationBudgetProjection,
  governedBudgetStart,
} from '../src/execution/inference-budget-policy';

const TEST_RUNTIME_FINGERPRINT = `sha256:${'a'.repeat(64)}`;
const TEST_CODE_FINGERPRINT = `sha256:${'b'.repeat(64)}`;
import {
  exactToolRepeatGuardSnapshot,
  ProgressEvent,
  projectExecutionProgress,
} from '../src/execution/execution-progress';
import { ExecutionProgressService } from '../src/execution/execution-progress.service';
import { ConversationSessionEntity } from '../src/conversation/conversation-session.entity';
import {
  ConversationTurnEntity,
  ConversationTurnStatus,
} from '../src/conversation/conversation-turn.entity';
import { ConversationArtifactRevisionEntity } from '../src/conversation/conversation-artifact-revision.entity';
import { AssistantMessageEntity } from '../src/assistant/assistant-message.entity';
import { AgentMessageEntity } from '../src/agent/agent-message.entity';
import { AssistantEntity } from '../src/assistant/assistant.entity';
import { AgentEntity } from '../src/agent/agent.entity';
import { MemoryEntryEntity } from '../src/memory/memory-entry.entity';
import { SkillActivationEntity } from '../src/conversation/skill-activation.entity';
import { advanceSkillActivation } from '../src/conversation/skill-activation';
import { ActiveCapabilitySet } from '../src/conversation/active-capabilities';

loadEnv({ path: '.env' });

describe('execution PostgreSQL integration', () => {
  const schema = `execution_test_${randomUUID().replaceAll('-', '_')}`;
  let dataSource: DataSource;
  let service: ExecutionService;
  let budgets: ExecutionProgressService;
  let attemptService: ExecutionAttemptService;
  let workerService: WorkerService;
  let toolPlanService: ExecutionToolPlanService;
  let confirmationService: ExecutionConfirmationService;
  let agentLoopService: ExecutionAgentLoopService;
  let terminalCandidateService: ExecutionTerminalCandidateService;
  let effectJournalService: ExecutionEffectJournalService;
  let artifactDirectory: string;

  beforeAll(async () => {
    artifactDirectory = await mkdtemp(
      join(tmpdir(), 'documents-e2e-artifacts-'),
    );
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.POSTGRES_HOST,
      port: Number(process.env.POSTGRES_PORT),
      username: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD,
      database: process.env.POSTGRES_DB,
      schema,
      extra: { options: `-c search_path=${schema},public` },
      synchronize: false,
      entities: [
        ExecutionEntity,
        ExecutionEventEntity,
        ExecutionArtifactEntity,
        ExecutionStepEntity,
        ExecutionStepDependencyEntity,
        ExecutionStepAttemptEntity,
        ExecutionResultReceiptEntity,
        ExecutionOutboxEntity,
        ExecutionOperationEntity,
        ExecutionToolInvocationEntity,
        ExecutionToolPlanEntity,
        ExecutionConfirmationEntity,
        WorkerEntity,
        ConversationSessionEntity,
        ConversationTurnEntity,
        ConversationArtifactRevisionEntity,
        AssistantMessageEntity,
        AgentMessageEntity,
        AssistantEntity,
        AgentEntity,
        MemoryEntryEntity,
        SkillActivationEntity,
        ExecutionEffectJournalEntity,
      ],
    });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET search_path TO "${schema}", public`);
    await new CreateExecutions1757668140001().up(runner);
    await new CreateProjects1757668140000().up(runner);
    await new CreatePermissionGroups1757668140003().up(runner);
    await new CreateUsers1757668140005().up(runner);
    await new CreateThreads1757668140010().up(runner);
    await new CreateResources1757668140011().up(runner);
    await new CreateDocs1757668140012().up(runner);
    await new CreateResourceDates1757668140030().up(runner);
    await new CreateAssistantTables1757668140070().up(runner);
    await new CreateAssistantMemoryEntries1757668140080().up(runner);
    await new CreateIndexedFiles1757668140100().up(runner);
    await new CreateAgents1757668140110().up(runner);
    await new CreateAgentMessages1757668140111().up(runner);
    await new CreateUserTasks1757668140200().up(runner);
    await new CreateVectorTables1757668140320().up(runner);
    await new CreateWorkers1757668140002().up(runner);
    await new CreateExecutionControlPlane1757668140370().up(runner);
    await new CreateExecutionOutbox1757668140400().up(runner);
    await new CreateExecutionOperations1757668140410().up(runner);
    await new CreateExecutionToolPlans1757668140420().up(runner);
    await new CreateExecutionConfirmations1757668140720().up(runner);
    await new CreateConversationSessions1757668140730().up(runner);
    await new ReplaceAssistantMemory1757668140740().up(runner);
    await new CreateSkillActivations1757668140750().up(runner);
    await new CreateExecutionEffectJournal1757668140760().up(runner);
    await runner.query(`
      INSERT INTO "assistants" ("id", "name", "icon", "sub")
      VALUES (1, 'Assistant', '◇', 'Personal assistant')
    `);
    await runner.query(`
      INSERT INTO "agents" ("id", "name", "pinned")
      VALUES (1, 'Test agent', true)
    `);
    await runner.release();

    const config = {
      get: (key: string, fallback?: unknown) =>
        key === 'FEATURE_BROWSER_FEDERATION'
          ? 'true'
          : key === 'EXECUTION_ARTIFACT_STORAGE_DIR'
            ? artifactDirectory
            : key === 'EXECUTION_ARTIFACT_INLINE_MAX_BYTES'
              ? String(8 * 1024 * 1024)
              : fallback,
    } as any;
    const artifactStorage = new ExecutionArtifactStorageService(config);
    budgets = new ExecutionProgressService(dataSource, config);
    service = new ExecutionService(
      dataSource,
      dataSource.getRepository(ExecutionEntity),
      dataSource.getRepository(ExecutionEventEntity),
      dataSource.getRepository(ExecutionArtifactEntity),
      config,
      new ExecutionContractValidator(),
      budgets,
      artifactStorage,
    );
    attemptService = new ExecutionAttemptService(
      dataSource,
      new ExecutionContractValidator(),
      artifactStorage,
    );
    workerService = new WorkerService(
      dataSource.getRepository(WorkerEntity),
      dataSource.getRepository(ExecutionStepAttemptEntity),
    );
    confirmationService = new ExecutionConfirmationService(
      dataSource,
      new ExecutionContractValidator(),
    );
    toolPlanService = new ExecutionToolPlanService(
      dataSource,
      new ExecutionContractValidator(),
      confirmationService,
      service,
    );
    agentLoopService = new ExecutionAgentLoopService(
      dataSource,
      budgets,
      toolPlanService,
      artifactStorage,
    );
    terminalCandidateService = new ExecutionTerminalCandidateService(
      dataSource,
    );
    effectJournalService = new ExecutionEffectJournalService(dataSource);
  });

  afterAll(async () => {
    try {
      if (dataSource?.isInitialized) {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await dataSource.destroy();
      }
    } finally {
      if (artifactDirectory) {
        await rm(artifactDirectory, { recursive: true, force: true });
      }
    }
  });

  beforeEach(async () => {
    await dataSource.query(`
      TRUNCATE TABLE
        "conversation_sessions",
        "executions",
        "assistant_messages",
        "agent_messages"
      RESTART IDENTITY CASCADE
    `);
    await dataSource.query(
      `UPDATE "assistants" SET "folder_scope" = NULL WHERE "id" = 1`,
    );
    await dataSource.query(
      `UPDATE "agents" SET "folder_scope" = NULL WHERE "id" = 1`,
    );
  });

  const progress = (context: any, instanceId: string) => ({
    eventId: randomUUID(),
    rootExecutionId: context.rootExecutionId,
    executionId: context.executionId,
    turnId: context.turnId,
    producerSequence: 1,
    eventType: 'progress.reported',
    producer: { component: 'documents-models', instanceId, version: 'test' },
    actor: { type: 'worker' },
    causedByEventId: context.lastEventId,
    occurredAt: '2026-08-19T10:00:01Z',
    payloadSchema: 'progress.reported/1',
    payload: { message: `progress from ${instanceId}` },
    artifactRefs: [],
    security: {
      dataClassification: 'workspace',
      purpose: 'evaluation',
      allowedDestinations: ['documents', 'ai-train'],
      redactionApplied: false,
    },
  });

  const activateStepAttempt = async (
    executionId: string,
    attemptId: string,
  ): Promise<void> => {
    await dataSource.transaction(async (manager) => {
      const executionRepo = manager.getRepository(ExecutionEntity);
      const execution = await executionRepo.findOneByOrFail({ executionId });
      const stepRepo = manager.getRepository(ExecutionStepEntity);
      const step = await stepRepo.findOneByOrFail({ executionId });
      if (step.currentAttemptId) {
        const previous = await manager
          .getRepository(ExecutionStepAttemptEntity)
          .findOneByOrFail({ attemptId: step.currentAttemptId });
        step.currentAttemptId = null;
        step.status = ExecutionStepStatus.READY;
        await stepRepo.save(step);
        previous.status = ExecutionStepAttemptStatus.EXPIRED;
        previous.finishedAt = new Date();
        previous.finishReason = 'superseded_by_test_attempt';
        await manager.save(previous);
      }
      const now = new Date();
      await manager.save(
        manager.getRepository(ExecutionStepAttemptEntity).create({
          attemptId,
          executionId,
          stepId: step.stepId,
          operationId: step.operationId,
          schemaVersion: 'step-attempt/1',
          claimedBy: randomUUID(),
          status: ExecutionStepAttemptStatus.RUNNING,
          leaseGrantedAt: now,
          leaseExpiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
          heartbeatAt: now,
          startedAt: now,
          finishedAt: null,
          finishReason: null,
          resultReceiptId: null,
        }),
      );
      step.currentAttemptId = attemptId;
      step.status = ExecutionStepStatus.RUNNING;
      await stepRepo.save(step);
      execution.status = ExecutionStatus.RUNNING;
      execution.phase = 'worker_execution';
      await executionRepo.save(execution);
    });
  };

  const createChat = async (
    kind: 'assistant_chat' | 'agent_chat',
    message: string,
    scope: { ownerPrincipal: string },
    payload: Record<string, unknown> = {},
  ): Promise<ExecutionEntity> =>
    (
      await service.createForChat(kind, message, scope, {
        ...payload,
        ownerId: 1,
        folderScope: null,
        systemPrompt: null,
      })
    ).execution;

  const activeCapabilities = (...names: string[]): ActiveCapabilitySet => ({
    schemaVersion: 'active-capability-set/1',
    owner: { type: 'assistant', id: 1 },
    selectionPolicy: 'backend-signals/1',
    skillSignals: [],
    tools: names.map((name) => ({
      name,
      descriptorVersion: `${name}/1`,
      availabilityBasis: 'core_read',
    })),
    skills: [],
  });

  it('creates only canonical execution control columns', async () => {
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
    expect(indexedFileOwnerColumns).toEqual([
      { column_name: 'owner_id' },
      { column_name: 'owner_type' },
    ]);
    expect(singletonConstraint).toEqual([
      { conname: 'CHK_assistants_singleton' },
    ]);
    expect(indexedOwnerConstraint).toHaveLength(1);
    expect(indexedOwnerConstraint[0].definition).toContain("'assistant'");
    expect(indexedOwnerConstraint[0].definition).toContain("'agent'");
    expect(retiredIndexedFileConstraint).toEqual([]);
    expect(replyIndexes).toEqual([
      { indexname: 'UQ_agent_messages_execution_reply' },
      { indexname: 'UQ_assistant_messages_execution_reply' },
    ]);
  });

  it('commits an execution and its initial step atomically', async () => {
    const inputBody = Buffer.alloc(8 * 1024 * 1024 + 1, 'a');
    const payload = { resourceId: 7, samples: ['Hello'] };
    const created = await service.create(
      'detect-language',
      ExecutionPriority.NORMAL,
      payload,
      {
        inputArtifacts: [
          {
            role: 'source',
            kind: 'language_sample',
            mediaType: 'text/plain',
            body: inputBody,
          },
        ],
        initialStep: {
          stepKind: ExecutionStepKind.CODE,
          work: { taskType: 'detect-language', payload },
          requiredCapabilities: ['detect-language'],
          resourceKeys: ['resource:language-detection'],
        },
      },
    );

    expect(created.schemaVersion).toBe('execution/1');
    const initialStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({
        executionId: created.executionId,
      });
    expect(initialStep).toMatchObject({
      executionId: created.executionId,
      schemaVersion: 'step/1',
      stepKind: ExecutionStepKind.CODE,
      status: 'ready',
      work: { taskType: 'detect-language', payload },
    });
    const storedInput = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifact_id = :artifactId', {
        artifactId: initialStep.inputArtifactRefs[0].artifactId,
      })
      .getOneOrFail();
    expect(storedInput.body).toBeNull();
    expect(storedInput.storageRef).toMatch(/^file:v1\//);
    await expect(
      dataSource.getRepository(ExecutionOperationEntity).findOneByOrFail({
        operationId: initialStep.operationId,
      }),
    ).resolves.toMatchObject({
      executionId: created.executionId,
      stepId: initialStep.stepId,
      operationId: initialStep.operationId,
      schemaVersion: 'operation/1',
      status: ExecutionOperationStatus.PREPARED,
      causedByEventId: created.lastEventId,
    });

    const countBeforeRollback = await dataSource
      .getRepository(ExecutionEntity)
      .count();
    await expect(
      service.create('detect-language', ExecutionPriority.NORMAL, payload, {
        initialStep: {
          stepKind: ExecutionStepKind.CODE,
          work: { taskType: 'detect-language', payload },
          availableAt: new Date('2026-08-19T10:00:00Z'),
          deadline: new Date('2026-08-19T09:00:00Z'),
        },
      }),
    ).rejects.toThrow('invalid_step_deadline');
    await expect(
      dataSource.getRepository(ExecutionEntity).count(),
    ).resolves.toBe(countBeforeRollback);

    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.CODE],
      capabilities: ['detect-language'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).toMatchObject({
      schemaVersion: 'step-assignment/1',
      executionId: created.executionId,
      stepKind: ExecutionStepKind.CODE,
      work: { taskType: 'detect-language', payload },
    });
    expect(assignment!.inputArtifactRefs).toHaveLength(1);
    const hydratedInput = await attemptService.getInputArtifact(
      assignment!.attemptId,
      workerId,
      assignment!.inputArtifactRefs[0].artifactId,
    );
    expect(hydratedInput.mediaType).toBe('text/plain');
    expect(hydratedInput.body?.equals(inputBody)).toBe(true);
    await expect(
      attemptService.renewAttemptLease(assignment!.attemptId, workerId, 60_000),
    ).resolves.toMatchObject({ cancelled: false });
    await expect(
      attemptService.readAttemptControl(assignment!.attemptId, workerId),
    ).resolves.toMatchObject({ cancelled: false });
  });

  it('persists one-shot model work as an inference step', async () => {
    const payload = {
      question: 'What is this document about?',
      graphContext: [],
    };
    const created = await service.createInference(
      'ask',
      ExecutionPriority.NORMAL,
      payload,
    );

    await expect(
      dataSource.getRepository(ExecutionStepEntity).findOneByOrFail({
        executionId: created.executionId,
      }),
    ).resolves.toMatchObject({
      stepKind: ExecutionStepKind.INFERENCE,
      work: { taskType: 'ask', payload },
      requiredCapabilities: ['ask'],
    });
  });

  it('persists domain reconciliation policy for failed steps', async () => {
    const payload = {
      datasetId: 3,
      recordId: 5,
      resourceId: 7,
      projectId: null,
      schema: [],
      columnsToExtract: [],
      documentText: 'Dataset row source',
      sourceTitle: 'Source',
      isAudio: false,
      model: 'e2e-model',
    };
    const created = await service.createInference(
      'dataset.extract-row',
      ExecutionPriority.NORMAL,
      payload,
      { finalizeOnFailure: true },
    );

    await expect(
      dataSource.getRepository(ExecutionStepEntity).findOneByOrFail({
        executionId: created.executionId,
      }),
    ).resolves.toMatchObject({
      stepKind: ExecutionStepKind.INFERENCE,
      finalizeOnFailure: true,
    });
  });

  it('preserves tree identity and artifacts for child inference work', async () => {
    const parent = await service.create(
      'document-extraction',
      ExecutionPriority.NORMAL,
      { resourceId: 7, hash: 'source-hash', extension: '.wav' },
    );
    const media = Buffer.from('media-body');
    const child = await service.createInference(
      'transcribe',
      ExecutionPriority.BACKGROUND,
      { resourceId: 7, hash: 'source-hash', extension: '.wav' },
      {
        rootExecutionId: parent.rootExecutionId,
        parentExecutionId: parent.executionId,
        ownerPrincipal: parent.ownerPrincipal,
        inputArtifacts: [
          {
            role: 'media',
            kind: 'source_media',
            mediaType: 'audio/wav',
            body: media,
          },
        ],
      },
    );

    expect(child).toMatchObject({
      rootExecutionId: parent.rootExecutionId,
      parentExecutionId: parent.executionId,
      ownerPrincipal: parent.ownerPrincipal,
    });
    const step = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: child.executionId });
    expect(step).toMatchObject({
      stepKind: ExecutionStepKind.INFERENCE,
      inputArtifactRefs: [{ role: 'media' }],
    });
    const artifact = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifact_id = :artifactId', {
        artifactId: step.inputArtifactRefs[0].artifactId,
      })
      .getOneOrFail();
    expect(artifact).toMatchObject({
      rootExecutionId: parent.rootExecutionId,
      kind: 'source_media',
      mediaType: 'audio/wav',
      body: media,
    });

    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['transcribe'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).toMatchObject({
      executionId: child.executionId,
      stepId: step.stepId,
      inputArtifactRefs: [{ role: 'media' }],
    });
    await attemptService.startAttempt(assignment!.attemptId, workerId);
    await attemptService.receiveResult({
      executionId: assignment!.executionId,
      stepId: assignment!.stepId,
      operationId: assignment!.operationId,
      attemptId: assignment!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'structured_result',
            schemaId: 'transcribe-output/1',
            value: { transcript: 'Hello' },
          },
        },
        codeFingerprint: TEST_CODE_FINGERPRINT,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        usage: {
          promptTokens: null,
          completionTokens: null,
          totalTokens: null,
        },
        inference: {
          effectiveModel: 'e2e-whisper',
          effectiveAdapter: null,
          effectivePromptPackages: ['transcribe/1'],
          finishReason: 'completed',
          inferenceMs: 1,
          cacheOutcome: 'unknown',
          warnings: [],
        },
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);

    const treeEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: parent.rootExecutionId },
        order: { sequence: 'ASC' },
      });
    expect(treeEvents.map((event) => event.sequence)).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
    expect(treeEvents.map((event) => event.eventType)).toEqual([
      'execution.created',
      'execution.created',
      'operation.started',
      'operation.finished',
    ]);
    const persistedRoot = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: parent.executionId });
    const persistedChild = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: child.executionId });
    expect(persistedRoot.lastSequence).toBe('4');
    expect(persistedRoot.lastEventId).toBe(treeEvents[3].eventId);
    expect(persistedChild).toMatchObject({
      phase: 'coordination_pending',
      result: { transcript: 'Hello' },
      lastSequence: '4',
      lastEventId: treeEvents[3].eventId,
    });
    await expect(terminalCandidateService.promoteReady()).resolves.toBe(1);
    await expect(
      dataSource
        .getRepository(ExecutionEntity)
        .findOneByOrFail({ executionId: child.executionId }),
    ).resolves.toMatchObject({ phase: 'backend_finalization' });
  });

  it('propagates durable cancellation through active child attempts', async () => {
    const ownerPrincipal = 'cancellation-tree-e2e';
    const parent = await service.create(
      'document-extraction',
      ExecutionPriority.NORMAL,
      { resourceId: 9, hash: 'source-hash', extension: '.wav' },
      { ownerPrincipal },
    );
    const child = await service.createInference(
      'transcribe',
      ExecutionPriority.NORMAL,
      { resourceId: 9, hash: 'source-hash', extension: '.wav' },
      {
        rootExecutionId: parent.executionId,
        parentExecutionId: parent.executionId,
        ownerPrincipal,
      },
    );
    const childStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: child.executionId });
    const workerId = randomUUID();
    const attempt = await attemptService.grantAttempt({
      stepId: childStep.stepId,
      workerId,
      leaseDurationMs: 30_000,
    });

    await expect(
      service.requestCancellation(
        parent.executionId,
        { ownerPrincipal },
        'User stopped the execution',
      ),
    ).resolves.toMatchObject({
      rootExecutionId: parent.executionId,
      status: ExecutionStatus.QUEUED,
      cancellationReason: 'User stopped the execution',
    });
    await expect(
      attemptService.readAttemptControl(attempt.attemptId, workerId),
    ).resolves.toMatchObject({ cancelled: true });
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ executionId: parent.executionId }),
    ).resolves.toMatchObject({ status: ExecutionStepStatus.CANCELLED });
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ executionId: child.executionId }),
    ).resolves.toMatchObject({ status: ExecutionStepStatus.RUNNING });
    await expect(service.reconcileRequestedCancellations()).resolves.toBe(0);

    await expect(
      attemptService.expireAttempt(
        attempt.attemptId,
        new Date(attempt.leaseExpiresAt.getTime() + 1),
      ),
    ).resolves.toBe(true);
    await expect(service.finalizePendingTerminals()).resolves.toBe(1);
    await expect(service.reconcileRequestedCancellations()).resolves.toBe(1);

    const executions = await dataSource.getRepository(ExecutionEntity).find({
      where: { rootExecutionId: parent.executionId },
    });
    expect(executions).toHaveLength(2);
    expect(executions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          executionId: parent.executionId,
          status: ExecutionStatus.CANCELLED,
          cancellationReason: 'User stopped the execution',
        }),
        expect.objectContaining({
          executionId: child.executionId,
          status: ExecutionStatus.CANCELLED,
          cancellationReason: 'User stopped the execution',
        }),
      ]),
    );
    await expect(
      dataSource
        .getRepository(ExecutionOperationEntity)
        .findOneByOrFail({ operationId: childStep.operationId }),
    ).resolves.toMatchObject({
      status: ExecutionOperationStatus.CANCELLED,
      currentAttemptId: null,
    });
    const cancellationEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: parent.executionId },
        order: { sequence: 'ASC' },
      });
    const validator = new ExecutionContractValidator();
    for (const event of cancellationEvents) {
      validator.assertEvent(event.envelope);
    }
    expect(
      cancellationEvents.filter(
        (event) =>
          event.eventType === 'execution.state_changed' &&
          (event.envelope.payload as Record<string, unknown> | undefined)
            ?.phase === 'cancellation_requested',
      ),
    ).toHaveLength(2);
  });

  it('commits terminal state, event and publication in one transaction', async () => {
    const created = await service.create('ask', ExecutionPriority.NORMAL, {
      requestId: 'request-1',
      question: 'Request one',
      graphContext: [],
    });

    await service.markAsCompleted(created.executionId, {
      publication: {
        socketEvent: 'askResponse',
        payload: { response: 'done', requestId: 'request-1' },
      },
    });

    const terminal = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    const publication = await dataSource
      .getRepository(ExecutionOutboxEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(terminal.status).toBe(ExecutionStatus.COMPLETED);
    expect(publication).toMatchObject({
      eventId: terminal.lastEventId,
      schemaVersion: 'execution-outbox/1',
      socketEvent: 'askResponse',
      payload: { response: 'done', requestId: 'request-1' },
      status: 'pending',
    });
  });

  it('prepares a durable tool plan without creating executable work', async () => {
    const created = await service.create(
      'assistant-chat',
      ExecutionPriority.NORMAL,
      {
        ownerId: 1,
        activeCapabilities: activeCapabilities('documents.search'),
      },
    );
    const stepsBefore = await dataSource
      .getRepository(ExecutionStepEntity)
      .countBy({ executionId: created.executionId });
    const toolCallId = randomUUID();
    const request = {
      schemaVersion: 'tool-invocation/1' as const,
      toolCallId,
      name: 'documents.search',
      arguments: { query: '  harness  ', limit: 5 },
      requester: {
        kind: 'deterministic' as const,
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        causedByEventId: created.lastEventId!,
        phase: 'tool',
        dataClassification: 'workspace' as const,
      },
    };

    const prepared = await toolPlanService.prepare(request);
    const repeated = await toolPlanService.prepare(request);

    expect(prepared.duplicate).toBe(false);
    expect(repeated).toMatchObject({
      duplicate: true,
      plan: { operationId: prepared.plan.operationId, stepId: null },
    });
    await expect(
      dataSource.getRepository(ExecutionStepEntity).countBy({
        executionId: created.executionId,
      }),
    ).resolves.toBe(stepsBefore);
    await expect(
      dataSource.getRepository(ExecutionToolPlanEntity).findOneByOrFail({
        toolCallId,
      }),
    ).resolves.toMatchObject({
      operationId: prepared.plan.operationId,
      schemaVersion: 'tool-plan/1',
      stepId: null,
      plan: {
        normalizedArguments: { query: 'harness', limit: 5 },
        policyDecision: { decision: 'allowed', rule: 'local_documents_read' },
      },
    });
  });

  it('persists, publishes and decides a confirmation tied to the exact tool plan', async () => {
    const ownerPrincipal = 'confirmation-e2e';
    const created = await service.create(
      'assistant-chat',
      ExecutionPriority.NORMAL,
      {
        ownerId: 42,
        activeCapabilities: activeCapabilities('user_tasks.create'),
      },
      { ownerPrincipal },
    );
    const toolCallId = randomUUID();
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId,
      name: 'user_tasks.create',
      arguments: { title: 'Review harness evidence', description: 'E2E' },
      requester: {
        kind: 'deterministic',
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });

    expect(prepared.plan.plan.policyDecision.decision).toBe(
      'confirmation_required',
    );
    await expect(
      toolPlanService.materialize(toolCallId, randomUUID()),
    ).resolves.toBeNull();
    await expect(
      confirmationService.activatePending(created.executionId),
    ).resolves.toBe(1);

    const waiting = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(waiting).toMatchObject({
      status: ExecutionStatus.WAITING,
      phase: 'awaiting_confirmation',
      waitReason: 'confirmation',
      resumePhase: 'coordination_pending',
    });
    const pending = await confirmationService.listPending({ ownerPrincipal });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      ownerId: 42,
      taskType: 'assistant-chat',
      confirmation: {
        operationId: prepared.plan.operationId,
        toolCallId,
        planHash: prepared.plan.planHash,
        status: 'pending',
      },
    });

    const decided = await confirmationService.decide(
      pending[0].confirmation.confirmationId,
      'approved',
      { ownerPrincipal },
    );
    expect(decided).toMatchObject({
      planHash: prepared.plan.planHash,
      status: 'approved',
    });
    const resumed = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(resumed).toMatchObject({
      status: ExecutionStatus.QUEUED,
      phase: 'coordination_pending',
      waitReason: null,
      waitCondition: null,
      resumePhase: null,
      waitExpiresAt: null,
    });
    const events = await dataSource.getRepository(ExecutionEventEntity).find({
      where: { executionId: created.executionId },
      order: { sequence: 'ASC' },
    });
    expect(events.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        'confirmation.requested',
        'confirmation.decided',
      ]),
    );
    const publications = await dataSource
      .getRepository(ExecutionOutboxEntity)
      .find({ where: { executionId: created.executionId } });
    expect(publications.map((publication) => publication.socketEvent)).toEqual(
      expect.arrayContaining([
        'executionConfirmationRequested',
        'executionConfirmationDecided',
      ]),
    );
  });

  it('expires a requested confirmation and resumes it as not executable', async () => {
    const ownerPrincipal = 'confirmation-expiry-e2e';
    const created = await service.create(
      'assistant-chat',
      ExecutionPriority.NORMAL,
      { activeCapabilities: activeCapabilities('user_tasks.create') },
      { ownerPrincipal },
    );
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId: randomUUID(),
      name: 'user_tasks.create',
      arguments: { title: 'Expired task' },
      requester: {
        kind: 'deterministic',
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });
    await confirmationService.activatePending(created.executionId);
    const repository = dataSource.getRepository(ExecutionConfirmationEntity);
    const confirmation = await repository.findOneByOrFail({
      operationId: prepared.plan.operationId,
    });
    confirmation.expiresAt = new Date(Date.now() - 1_000);
    await repository.save(confirmation);

    await expect(confirmationService.expirePending()).resolves.toBe(1);
    await expect(
      repository.findOneByOrFail({
        confirmationId: confirmation.confirmationId,
      }),
    ).resolves.toMatchObject({ status: 'expired', decidedBy: null });
    await expect(
      dataSource
        .getRepository(ExecutionEntity)
        .findOneByOrFail({ executionId: created.executionId }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.QUEUED,
      phase: 'coordination_pending',
      waitReason: null,
    });
  });

  it('creates, joins and incorporates a bounded durable child execution', async () => {
    const created = await createChat(
      'assistant_chat',
      'Delegate a focused comparison',
      { ownerPrincipal: 'delegation-e2e' },
      { ownerId: 1, conversation: [] },
    );
    const initialStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: created.executionId });
    initialStep.status = ExecutionStepStatus.COMPLETED;
    await dataSource.getRepository(ExecutionStepEntity).save(initialStep);
    const { grant } = await budgets.requestProgressGrant(created.executionId, {
      executionId: created.executionId,
      turnId: created.turnId!,
      loopId: created.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy: {
        normal: 3,
        normalInferenceSoftLimit: 2,
        repair: 1,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 3,
        toolCallSoftLimit: 2,
        exactToolRepeatWarning: false,
        exactToolRepeatBlockAfterWarning: false,
        exactToolRepeatTerminateAfterBlock: false,
      },
    });
    const toolCallId = randomUUID();
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId,
      name: 'agents.delegate',
      arguments: { goal: 'Compare evidence A with evidence B' },
      requester: { kind: 'deterministic', component: 'documents-backend' },
      executionContext: {
        executionId: created.executionId,
        turnId: created.turnId!,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });
    const reservation = await budgets.reserveOperationBudget(
      created.executionId,
      {
        executionId: created.executionId,
        loopId: created.executionId,
        grantId: grant.grantId,
        operationId: prepared.plan.operationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId,
        operationFingerprint: canonicalHash({
          name: 'agents.delegate',
          arguments: { goal: 'Compare evidence A with evidence B' },
        }),
        operationFingerprintVersion: 'canonical_tool_input_v1',
        toolBatchSize: 1,
        toolBatchIndex: 0,
        phase: 'agent_loop',
        round: 1,
        name: 'agents.delegate',
      },
    );
    const parentToolStep = await toolPlanService.materialize(
      toolCallId,
      reservation.reservation.reservationId,
    );
    expect(parentToolStep).toMatchObject({
      status: ExecutionStepStatus.BLOCKED,
      work: {
        taskType: 'agents.delegate',
        joinPolicy: 'all',
        delegationDepth: 1,
      },
    });
    const childExecutionId = String(parentToolStep!.work.childExecutionId);
    const child = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: childExecutionId });
    expect(child).toMatchObject({
      rootExecutionId: created.executionId,
      parentExecutionId: created.executionId,
      taskType: 'delegated-agent',
      turnId: created.turnId,
      payload: {
        delegationOperationId: prepared.plan.operationId,
        joinPolicy: 'all',
        depth: 1,
      },
    });
    const childStepId = String(parentToolStep!.work.childStepId);
    await expect(agentLoopService.prepareReadyInferences(1)).resolves.toBe(1);
    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['assistant-chat'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).toMatchObject({
      executionId: childExecutionId,
      stepId: childStepId,
      work: {
        taskType: 'assistant-chat',
        agentName: 'subagent',
        payload: { delegationMode: true },
      },
    });
    await attemptService.startAttempt(assignment!.attemptId, workerId);
    await attemptService.receiveResult({
      executionId: assignment!.executionId,
      stepId: assignment!.stepId,
      operationId: assignment!.operationId,
      attemptId: assignment!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        codeFingerprint: TEST_CODE_FINGERPRINT,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'final_text',
            text: 'Independent comparison',
          },
        },
        usage: {
          promptTokens: 8,
          completionTokens: 4,
          totalTokens: 12,
        },
        inference: {
          effectiveModel: 'e2e-model',
          effectiveAdapter: null,
          effectivePromptPackages: ['e2e-prompt'],
          finishReason: 'stop',
          inferenceMs: 1,
          cacheOutcome: 'miss',
          warnings: [],
        },
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults(1)).resolves.toBe(1);
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: parentToolStep!.stepId }),
    ).resolves.toMatchObject({ status: ExecutionStepStatus.BLOCKED });
    await service.completeExecution(
      childExecutionId,
      'Independent comparison',
      null,
      undefined,
      {
        socketEvent: 'executionDelegationCompleted',
        payload: { executionId: childExecutionId },
      },
    );
    await expect(agentLoopService.releaseTerminalDelegations(1)).resolves.toBe(
      1,
    );

    const runtime = new ExecutionToolRuntimeService(
      attemptService,
      new ExecutionContractValidator(),
      { globalSearch: async () => [] },
      {
        createFromExecution: async () => {
          throw new Error('unexpected_user_task_creation');
        },
        findByExecutionOperation: async () => null,
      },
      {} as any,
      service,
      effectJournalService,
    );
    await expect(runtime.executeReady(1)).resolves.toBe(1);
    await expect(attemptService.processReceivedResults(1)).resolves.toBe(1);
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: parentToolStep!.stepId }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.COMPLETED,
      result: {
        toolResult: {
          status: 'succeeded',
          content: 'Independent comparison',
          structuredContent: {
            childExecutionId,
            childStatus: 'completed',
            joinPolicy: 'all',
          },
        },
      },
    });
  });

  it('executes documents.search and accepts its canonical ToolResult', async () => {
    const created = await createChat(
      'assistant_chat',
      'Find the harness plan',
      { ownerPrincipal: 'tool-e2e' },
      {},
    );
    const sourceAttemptId = randomUUID();
    await activateStepAttempt(created.executionId, sourceAttemptId);
    const prepared = await toolPlanService.prepare({
      schemaVersion: 'tool-invocation/1',
      toolCallId: randomUUID(),
      name: 'documents.search',
      arguments: { query: 'harness', limit: 2 },
      requester: {
        kind: 'deterministic',
        component: 'documents-backend',
      },
      executionContext: {
        executionId: created.executionId,
        turnId: created.turnId!,
        causedByEventId: created.lastEventId!,
        phase: 'agent_loop',
        dataClassification: 'workspace',
      },
    });
    const { grant } = await budgets.requestProgressGrant(created.executionId, {
      executionId: created.executionId,
      turnId: created.turnId!,
      loopId: created.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy: {
        normal: 1,
        normalInferenceSoftLimit: 1,
        repair: 0,
        closing: 0,
        maxTokensPerInference: 128,
        toolCalls: 1,
        toolCallSoftLimit: 1,
        exactToolRepeatWarning: false,
        exactToolRepeatBlockAfterWarning: false,
        exactToolRepeatTerminateAfterBlock: false,
      },
    });
    const reserved = await budgets.reserveOperationBudget(created.executionId, {
      executionId: created.executionId,
      loopId: created.executionId,
      grantId: grant.grantId,
      operationId: prepared.plan.operationId,
      operationKind: 'tool_call',
      bucket: 'tool',
      toolCallId: prepared.plan.toolCallId,
      phase: 'agent_loop',
      round: 1,
      name: 'documents.search',
    });
    const step = await toolPlanService.materialize(
      prepared.plan.toolCallId,
      reserved.reservation.reservationId,
    );
    const runtime = new ExecutionToolRuntimeService(
      attemptService,
      new ExecutionContractValidator(),
      {
        globalSearch: async () => [
          {
            id: 17,
            name: 'Harness implementation plan',
            score: 0.95,
            collection: 'docs',
          },
        ],
      },
      {
        createFromExecution: async () => {
          throw new Error('unexpected_user_task_creation');
        },
        findByExecutionOperation: async () => null,
      },
      {} as any,
      service,
      effectJournalService,
    );

    await expect(runtime.executeReady()).resolves.toBe(1);
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);

    await expect(
      dataSource.getRepository(ExecutionStepEntity).findOneByOrFail({
        stepId: step.stepId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.COMPLETED,
      result: {
        kind: 'tool',
        toolResult: {
          operationId: prepared.plan.operationId,
          toolCallId: prepared.plan.toolCallId,
          status: 'succeeded',
          structuredContent: { count: 1 },
          effects: [],
          error: null,
        },
      },
    });
    await expect(
      dataSource.getRepository(ExecutionOperationEntity).findOneByOrFail({
        operationId: prepared.plan.operationId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionOperationStatus.SUCCEEDED,
      result: {
        schemaVersion: 'tool-result/1',
        operationId: prepared.plan.operationId,
        toolCallId: prepared.plan.toolCallId,
        status: 'succeeded',
      },
    });
    const persistedExecution = await dataSource
      .getRepository(ExecutionEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(
      persistedExecution.progressLedger.operationBudget?.reservations[
        prepared.plan.operationId
      ],
    ).toMatchObject({
      reservationId: reserved.reservation.reservationId,
      status: 'consumed',
    });
    const operationEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: {
          rootExecutionId: created.rootExecutionId,
          operationId: prepared.plan.operationId,
        },
        order: { sequence: 'ASC' },
      });
    expect(operationEvents.map((event) => event.eventType)).toEqual([
      'operation.started',
      'operation.finished',
    ]);
    const [started, finished] = operationEvents;
    expect(started.attemptId).toEqual(expect.any(String));
    expect(started.envelope).toMatchObject({
      stepId: step.stepId,
      operationId: prepared.plan.operationId,
      toolCallId: prepared.plan.toolCallId,
      attemptId: started.attemptId,
      payload: {
        operationKind: 'tool_call',
        status: 'dispatched',
        name: 'documents.search',
        loopId: created.executionId,
        loopKind: 'top_level',
        round: 1,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: reserved.reservation.reservationId,
        budgetBucket: 'tool',
      },
    });
    expect(finished).toMatchObject({
      attemptId: started.attemptId,
      causedByEventId: started.eventId,
    });
    expect(finished.envelope).toMatchObject({
      stepId: step.stepId,
      operationId: prepared.plan.operationId,
      toolCallId: prepared.plan.toolCallId,
      attemptId: started.attemptId,
      payload: {
        operationKind: 'tool_call',
        status: 'succeeded',
        result: {
          schemaVersion: 'tool-result/1',
          operationId: prepared.plan.operationId,
          toolCallId: prepared.plan.toolCallId,
          status: 'succeeded',
        },
        error: null,
      },
    });
    const eventsBeforeStart = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: created.rootExecutionId },
        order: { sequence: 'ASC' },
      });
    const budgetStateBeforeStart = projectExecutionProgress(
      eventsBeforeStart
        .filter((event) => Number(event.sequence) < Number(started.sequence))
        .map((event) => event.envelope as unknown as ProgressEvent),
    );
    const governedStart = governedBudgetStart(
      persistedExecution,
      started.envelope,
    );
    expect(governedStart).not.toBeNull();
    expect(() =>
      assertOperationBudgetProjection(
        governedStart!,
        budgetStateBeforeStart.ledger.operationBudget,
        exactToolRepeatGuardSnapshot(
          budgetStateBeforeStart.ledger,
          grant.grantId,
        ),
      ),
    ).not.toThrow();
  });

  it('routes a browser tool request through IA Browser and into the next inference', async () => {
    const browserId = randomUUID();
    await workerService.enrollBrowser(
      browserId,
      'ia-browser-agent-loop-e2e',
      'agent-loop-e2e',
      { runtime: 'test' },
    );
    const created = await createChat(
      'assistant_chat',
      'Find the harness plan',
      { ownerPrincipal: 'agent-loop-e2e' },
      {},
    );
    await expect(agentLoopService.prepareReadyInferences()).resolves.toBe(1);
    const governedStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ executionId: created.executionId });
    expect(governedStep.budgetReservationId).toEqual(expect.any(String));

    const workerId = randomUUID();
    const assignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['assistant-chat'],
      leaseDurationMs: 30_000,
    });
    expect(assignment).not.toBeNull();
    await attemptService.startAttempt(assignment!.attemptId, workerId);
    const toolCallId = randomUUID();
    await attemptService.receiveResult({
      executionId: assignment!.executionId,
      stepId: assignment!.stepId,
      operationId: assignment!.operationId,
      attemptId: assignment!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        codeFingerprint: TEST_CODE_FINGERPRINT,
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'tool_requests',
            calls: [
              {
                toolCallId,
                name: 'browser.read_current_page',
                arguments: {
                  expectedUrl: 'https://example.test/harness',
                  maxChars: 12_000,
                },
              },
            ],
          },
        },
        usage: {
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
        },
        inference: {
          effectiveModel: 'e2e-model',
          effectiveAdapter: null,
          effectivePromptPackages: ['e2e-prompt'],
          finishReason: 'tool_calls',
          inferenceMs: 1,
          cacheOutcome: 'miss',
          warnings: [],
        },
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      agentLoopService.materializeAcceptedToolRequests(),
    ).resolves.toBe(1);

    const plan = await dataSource
      .getRepository(ExecutionToolPlanEntity)
      .findOneByOrFail({ toolCallId });
    expect(plan.stepId).toEqual(expect.any(String));
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: plan.stepId! }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.READY,
      stepKind: ExecutionStepKind.TOOL,
      budgetReservationId: expect.any(String),
      work: {
        taskType: 'browser.read_current_page',
        toolPlan: { toolCallId, operationId: plan.operationId },
      },
      requiredCapabilities: ['tool.browser.read_current_page/1'],
    });
    await expect(
      agentLoopService.materializeAcceptedToolRequests(),
    ).resolves.toBe(0);
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: assignment!.stepId }),
    ).resolves.toMatchObject({ continuationProcessedAt: expect.any(Date) });

    const browserAssignment = await attemptService.claimReadyStep({
      workerId: browserId,
      ownerPrincipal: 'agent-loop-e2e',
      stepKinds: [ExecutionStepKind.TOOL],
      capabilities: ['tool.browser.read_current_page/1'],
      leaseDurationMs: 60_000,
      enforceRegisteredWorkerCapacity: true,
    });
    expect(browserAssignment).toMatchObject({
      executionId: created.executionId,
      stepKind: ExecutionStepKind.TOOL,
      work: {
        taskType: 'browser.read_current_page',
        toolPlan: {
          operationId: plan.operationId,
          toolCallId,
          normalizedArguments: {
            expectedUrl: 'https://example.test/harness',
            maxChars: 12_000,
          },
        },
      },
    });
    await attemptService.startAttempt(browserAssignment!.attemptId, browserId);

    const pageArtifactId = randomUUID();
    const pageArtifactRole = `browser_page:${toolCallId}`;
    const pageBody = Buffer.from(
      JSON.stringify({
        url: 'https://example.test/harness',
        text: 'The harness plan is ready.',
        truncated: false,
      }),
    );
    await attemptService.uploadOutputArtifact(
      browserAssignment!.attemptId,
      browserId,
      {
        artifactId: pageArtifactId,
        kind: 'browser-page-snapshot',
        contentHash: contentHash(pageBody),
        size: pageBody.length,
        mediaType: 'application/json',
        encoding: 'identity',
        dataClassification: 'workspace',
        redaction: { applied: false },
        retentionClass: 'execution',
        inputSourceIds: [],
        bodyBase64: pageBody.toString('base64'),
      },
    );
    await attemptService.receiveResult({
      executionId: browserAssignment!.executionId,
      stepId: browserAssignment!.stepId,
      operationId: browserAssignment!.operationId,
      attemptId: browserAssignment!.attemptId,
      workerId: browserId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: browserAssignment!.executionId,
        stepId: browserAssignment!.stepId,
        operationId: browserAssignment!.operationId,
        attemptId: browserAssignment!.attemptId,
        stepKind: ExecutionStepKind.TOOL,
        status: 'succeeded',
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        output: {
          kind: ExecutionStepKind.TOOL,
          toolResult: {
            schemaVersion: 'tool-result/1',
            operationId: plan.operationId,
            toolCallId,
            status: 'succeeded',
            content: '',
            structuredContent: {
              url: 'https://example.test/harness',
              truncated: false,
              contentArtifactId: pageArtifactId,
              contentHash: contentHash(pageBody),
              size: pageBody.length,
            },
            artifactRefs: [
              { role: pageArtifactRole, artifactId: pageArtifactId },
            ],
            sourceRefs: [],
            effects: [],
            error: null,
          },
        },
        artifactRefs: [{ role: pageArtifactRole, artifactId: pageArtifactId }],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ExecutionEventEntity).findOneByOrFail({
        eventType: 'operation.finished',
        operationId: plan.operationId,
      }),
    ).resolves.toMatchObject({
      envelope: {
        artifactRefs: [pageArtifactId],
      },
    });
    await expect(
      agentLoopService.materializeReadyToolContinuations(),
    ).resolves.toBe(1);

    const source = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: assignment!.stepId });
    expect(source.continuationStepId).toEqual(expect.any(String));
    await expect(
      dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: source.continuationStepId! }),
    ).resolves.toMatchObject({
      status: ExecutionStepStatus.READY,
      stepKind: ExecutionStepKind.INFERENCE,
      budgetReservationId: null,
      inputArtifactRefs: expect.arrayContaining([
        { role: pageArtifactRole, artifactId: pageArtifactId },
        {
          role: 'active_context',
          artifactId: expect.any(String),
        },
      ]),
      work: {
        taskType: 'assistant-chat',
        agentName: 'assistant',
        payload: {
          toolHistory: [
            {
              round: 1,
              calls: [{ toolCallId, name: 'browser.read_current_page' }],
              results: [
                {
                  toolCallId,
                  status: 'succeeded',
                  structuredContent: {
                    url: 'https://example.test/harness',
                    truncated: false,
                    contentArtifactId: pageArtifactId,
                    contentHash: contentHash(pageBody),
                    size: pageBody.length,
                  },
                  artifactRefs: [
                    { role: pageArtifactRole, artifactId: pageArtifactId },
                  ],
                },
              ],
            },
          ],
        },
      },
    });
    const continuationStep = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: source.continuationStepId! });
    const contextRefs = continuationStep.inputArtifactRefs.filter(
      (ref) => ref.role === 'active_context',
    );
    expect(contextRefs).toHaveLength(1);
    const continuationContext = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifactId = :artifactId', {
        artifactId: contextRefs[0].artifactId,
      })
      .getOneOrFail();
    const continuationSnapshot = JSON.parse(
      continuationContext.body!.toString(),
    );
    expect(continuationSnapshot.sourceConversation.revision).toBe(1);
    expect(continuationSnapshot.effectivePayload.toolHistory).toHaveLength(1);
    await expect(
      agentLoopService.materializeReadyToolContinuations(),
    ).resolves.toBe(0);
    await expect(agentLoopService.prepareReadyInferences()).resolves.toBe(1);
  });

  it('runs every confirmed browser mutation through duplicate ACK and continuation', async () => {
    const ownerPrincipal = 'browser-mutation-matrix-e2e';
    const browserId = randomUUID();
    const cases = [
      {
        name: 'browser.navigate',
        capability: 'tool.browser.navigate/1',
        effectClass: 'external_reversible',
        arguments: {
          url: 'https://example.test/next',
          expectedCurrentUrl: 'https://example.test/current',
        },
      },
      {
        name: 'browser.go_back',
        capability: 'tool.browser.go_back/1',
        effectClass: 'external_reversible',
        arguments: {
          expectedCurrentUrl: 'https://example.test/current',
        },
      },
      {
        name: 'browser.click',
        capability: 'tool.browser.click/1',
        effectClass: 'external_irreversible',
        arguments: {
          expectedCurrentUrl: 'https://example.test/current',
          elementIndex: 2,
          expectedKind: 'button',
          expectedLabel: 'Continue',
        },
      },
      {
        name: 'browser.type_text',
        capability: 'tool.browser.type_text/1',
        effectClass: 'external_irreversible',
        arguments: {
          expectedCurrentUrl: 'https://example.test/current',
          elementIndex: 3,
          expectedLabel: 'Search',
          expectedCurrentValue: '',
          expectedCurrentValueTruncated: false,
          text: 'harness',
        },
      },
      {
        name: 'browser.select_option',
        capability: 'tool.browser.select_option/1',
        effectClass: 'external_irreversible',
        arguments: {
          expectedCurrentUrl: 'https://example.test/current',
          elementIndex: 4,
          expectedLabel: 'Environment',
          expectedCurrentValue: 'dev',
          expectedCurrentValueTruncated: false,
          optionValue: 'prod',
          expectedOptionLabel: 'Production',
        },
      },
    ] as const;
    const registration = await workerService.enrollBrowser(
      browserId,
      'ia-browser-mutation-matrix-e2e',
      ownerPrincipal,
      { runtime: 'test' },
    );
    expect(registration.worker.capabilities).toEqual(
      expect.arrayContaining(cases.map((item) => item.capability)),
    );
    await dataSource.query(`
      INSERT INTO "agents" ("id", "name", "pinned")
      SELECT id, 'Browser mutation agent ' || id, true
      FROM generate_series(2, 5) AS id
      ON CONFLICT ("id") DO NOTHING
    `);

    const executions = await Promise.all(
      cases.map(
        async (item, index) =>
          (
            await service.createForChat(
              'agent_chat',
              `Execute ${item.name}`,
              { ownerPrincipal },
              {
                ownerId: index + 1,
                folderScope: null,
                systemPrompt: null,
              },
            )
          ).execution,
      ),
    );
    const byExecution = new Map(
      executions.map((execution, index) => [
        execution.executionId,
        { execution, item: cases[index], toolCallId: randomUUID() },
      ]),
    );
    await expect(agentLoopService.prepareReadyInferences(20)).resolves.toBe(
      cases.length,
    );

    const sourceAssignments = new Map<string, StepAssignment>();
    for (let index = 0; index < cases.length; index += 1) {
      const workerId = randomUUID();
      const assignment = await attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['agent-chat'],
        leaseDurationMs: 30_000,
      });
      expect(assignment).not.toBeNull();
      const matrixCase = byExecution.get(assignment!.executionId)!;
      sourceAssignments.set(assignment!.executionId, assignment!);
      await attemptService.startAttempt(assignment!.attemptId, workerId);
      await attemptService.receiveResult({
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        workerId,
        result: {
          schemaVersion: 'step-result/1',
          executionId: assignment!.executionId,
          stepId: assignment!.stepId,
          operationId: assignment!.operationId,
          attemptId: assignment!.attemptId,
          stepKind: ExecutionStepKind.INFERENCE,
          status: 'succeeded',
          codeFingerprint: TEST_CODE_FINGERPRINT,
          runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
          output: {
            kind: ExecutionStepKind.INFERENCE,
            outcome: {
              kind: 'tool_requests',
              calls: [
                {
                  toolCallId: matrixCase.toolCallId,
                  name: matrixCase.item.name,
                  arguments: matrixCase.item.arguments,
                },
              ],
            },
          },
          usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
          },
          inference: {
            effectiveModel: 'e2e-model',
            effectiveAdapter: null,
            effectivePromptPackages: ['e2e-prompt'],
            finishReason: 'tool_calls',
            inferenceMs: 1,
            cacheOutcome: 'miss',
            warnings: [],
          },
          artifactRefs: [],
          error: null,
        },
      });
    }
    await expect(attemptService.processReceivedResults(20)).resolves.toBe(
      cases.length,
    );
    await expect(
      agentLoopService.materializeAcceptedToolRequests(20),
    ).resolves.toBe(0);

    const pending = await confirmationService.listPending({ ownerPrincipal });
    expect(pending).toHaveLength(cases.length);
    for (const confirmation of pending) {
      await confirmationService.decide(
        confirmation.confirmation.confirmationId,
        'approved',
        { ownerPrincipal },
      );
    }
    await expect(
      agentLoopService.materializeAcceptedToolRequests(20),
    ).resolves.toBe(cases.length);

    for (let index = 0; index < cases.length; index += 1) {
      const assignment = await attemptService.claimReadyStep({
        workerId: browserId,
        ownerPrincipal,
        stepKinds: [ExecutionStepKind.TOOL],
        capabilities: cases.map((item) => item.capability),
        leaseDurationMs: 60_000,
        enforceRegisteredWorkerCapacity: true,
      });
      expect(assignment).not.toBeNull();
      const matrixCase = byExecution.get(assignment!.executionId)!;
      const plan = assignment!.work.toolPlan as any;
      expect(assignment).toMatchObject({
        stepKind: ExecutionStepKind.TOOL,
        work: {
          taskType: matrixCase.item.name,
          confirmationDecision: { status: 'approved' },
          toolPlan: {
            toolCallId: matrixCase.toolCallId,
            toolName: matrixCase.item.name,
            normalizedArguments: matrixCase.item.arguments,
            recoveryClass: 'effect_checked',
            requiredCapabilities: [matrixCase.item.capability],
            effects: [
              {
                effectClass: matrixCase.item.effectClass,
                resourceKey: 'browser:active-page',
                verificationRequired: true,
              },
            ],
          },
        },
      });
      await attemptService.startAttempt(assignment!.attemptId, browserId);
      const result = {
        schemaVersion: 'step-result/1',
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        stepKind: ExecutionStepKind.TOOL,
        status: 'succeeded',
        runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
        output: {
          kind: ExecutionStepKind.TOOL,
          toolResult: {
            schemaVersion: 'tool-result/1',
            operationId: assignment!.operationId,
            toolCallId: matrixCase.toolCallId,
            status: 'succeeded',
            content: '',
            structuredContent: {
              url: 'https://example.test/after',
              title: matrixCase.item.name,
            },
            artifactRefs: [],
            sourceRefs: [],
            effects: [
              {
                effectClass: matrixCase.item.effectClass,
                resourceKey: 'browser:active-page',
                status: 'applied',
              },
            ],
            error: null,
          },
        },
        artifactRefs: [],
        error: null,
      };
      await expect(
        attemptService.receiveResult({
          executionId: assignment!.executionId,
          stepId: assignment!.stepId,
          operationId: assignment!.operationId,
          attemptId: assignment!.attemptId,
          workerId: browserId,
          result,
        }),
      ).resolves.toMatchObject({ code: 'received' });
      await expect(
        attemptService.receiveResult({
          executionId: assignment!.executionId,
          stepId: assignment!.stepId,
          operationId: assignment!.operationId,
          attemptId: assignment!.attemptId,
          workerId: browserId,
          result,
        }),
      ).resolves.toMatchObject({ code: 'duplicate' });
      await expect(attemptService.processReceivedResults(1)).resolves.toBe(1);
      await expect(
        dataSource
          .getRepository(ExecutionOperationEntity)
          .findOneByOrFail({ operationId: plan.operationId }),
      ).resolves.toMatchObject({
        status: ExecutionOperationStatus.SUCCEEDED,
        result: {
          toolCallId: matrixCase.toolCallId,
          status: 'succeeded',
          effects: [
            {
              effectClass: matrixCase.item.effectClass,
              resourceKey: 'browser:active-page',
              status: 'applied',
            },
          ],
        },
      });
    }

    await expect(
      agentLoopService.materializeReadyToolContinuations(20),
    ).resolves.toBe(cases.length);
    for (const [executionId, matrixCase] of byExecution) {
      const source = await dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({
          stepId: sourceAssignments.get(executionId)!.stepId,
        });
      const continuation = await dataSource
        .getRepository(ExecutionStepEntity)
        .findOneByOrFail({ stepId: source.continuationStepId! });
      expect(continuation).toMatchObject({
        status: ExecutionStepStatus.READY,
        stepKind: ExecutionStepKind.INFERENCE,
        work: {
          payload: {
            toolHistory: [
              {
                calls: [
                  {
                    toolCallId: matrixCase.toolCallId,
                    name: matrixCase.item.name,
                  },
                ],
                results: [
                  {
                    toolCallId: matrixCase.toolCallId,
                    status: 'succeeded',
                    effects: [
                      {
                        effectClass: matrixCase.item.effectClass,
                        resourceKey: 'browser:active-page',
                        status: 'applied',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      });
    }
  });

  it('repairs invalid chat output once, forces closing, then fails without confirmed value', async () => {
    const created = await createChat(
      'assistant_chat',
      'Produce a valid final answer',
      { ownerPrincipal: 'invalid-outcome-e2e' },
      { ownerId: 1 },
    );
    const workerId = randomUUID();
    const completeInvalidInference = async () => {
      await expect(agentLoopService.prepareReadyInferences()).resolves.toBe(1);
      const assignment = await attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['assistant-chat'],
        leaseDurationMs: 30_000,
      });
      expect(assignment).not.toBeNull();
      await attemptService.startAttempt(assignment!.attemptId, workerId);
      await attemptService.receiveResult({
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        workerId,
        result: {
          schemaVersion: 'step-result/1',
          executionId: assignment!.executionId,
          stepId: assignment!.stepId,
          operationId: assignment!.operationId,
          attemptId: assignment!.attemptId,
          stepKind: ExecutionStepKind.INFERENCE,
          status: 'succeeded',
          codeFingerprint: TEST_CODE_FINGERPRINT,
          runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
          output: {
            kind: ExecutionStepKind.INFERENCE,
            outcome: {
              kind: 'invalid',
              reason: 'empty_model_response',
            },
          },
          usage: {
            promptTokens: 10,
            completionTokens: 0,
            totalTokens: 10,
          },
          inference: {
            effectiveModel: 'e2e-model',
            effectiveAdapter: null,
            effectivePromptPackages: ['e2e-prompt'],
            finishReason: 'completed',
            inferenceMs: 1,
            cacheOutcome: 'miss',
            warnings: [],
          },
          artifactRefs: [],
          error: null,
        },
      });
      await expect(attemptService.processReceivedResults()).resolves.toBe(1);
      return assignment!;
    };

    const initial = await completeInvalidInference();
    await expect(terminalCandidateService.promoteReady()).resolves.toBe(0);
    await expect(agentLoopService.materializeInvalidOutcomes()).resolves.toBe(
      1,
    );
    const initialSource = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: initial.stepId });
    const repair = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: initialSource.continuationStepId! });
    expect(repair.work).toMatchObject({
      agentLoop: {
        purpose: 'repair',
        phase: 'output_repair',
        sourceStepId: initial.stepId,
      },
      payload: {
        runtimeDirective: {
          kind: 'output_repair',
          reason: 'empty_model_response',
          toolsAllowed: false,
        },
        activeCapabilities: { tools: [] },
      },
    });

    const repairAssignment = await completeInvalidInference();
    expect(repairAssignment.stepId).toBe(repair.stepId);
    await expect(agentLoopService.materializeInvalidOutcomes()).resolves.toBe(
      1,
    );
    const repairedSource = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: repair.stepId });
    const closing = await dataSource
      .getRepository(ExecutionStepEntity)
      .findOneByOrFail({ stepId: repairedSource.continuationStepId! });
    expect(closing.work).toMatchObject({
      agentLoop: {
        purpose: 'closing',
        phase: 'forced_finalization',
        sourceStepId: repair.stepId,
      },
      payload: {
        runtimeDirective: {
          kind: 'forced_finalization',
          toolsAllowed: false,
        },
        activeCapabilities: { tools: [] },
      },
    });

    const closingAssignment = await completeInvalidInference();
    expect(closingAssignment.stepId).toBe(closing.stepId);
    await expect(agentLoopService.materializeInvalidOutcomes()).resolves.toBe(
      1,
    );
    await expect(
      dataSource
        .getRepository(ExecutionEntity)
        .findOneByOrFail({ executionId: created.executionId }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.RUNNING,
      phase: 'terminal_pending_failed',
      error: { code: 'terminal_candidate_unavailable' },
    });
  });

  it('registers and authenticates an isolated Models identity', async () => {
    const workerId = randomUUID();
    const registration = await workerService.registerModels(
      workerId,
      'models-e2e',
      ['detect-language'],
      [ExecutionStepKind.SERVICE],
      1,
      { runtime: 'test' },
    );

    expect(registration.worker.id).toBe(workerId);
    expect(registration.credential).not.toContain(workerId);
    await expect(
      workerService.authenticate(
        workerId,
        registration.credential,
        WorkerKind.MODELS,
      ),
    ).resolves.toMatchObject({ id: workerId });
    await expect(
      workerService.authenticate(
        workerId,
        'wrong-credential',
        WorkerKind.MODELS,
      ),
    ).rejects.toThrow('invalid_worker_credential');
    const rotation = await workerService.registerModels(
      workerId,
      'models-e2e',
      [],
      [ExecutionStepKind.SERVICE],
      1,
      {},
    );
    expect(rotation.credential).not.toBe(registration.credential);
    await expect(
      workerService.authenticate(
        workerId,
        registration.credential,
        WorkerKind.MODELS,
      ),
    ).rejects.toThrow('invalid_worker_credential');
    await expect(
      workerService.authenticate(
        workerId,
        rotation.credential,
        WorkerKind.MODELS,
      ),
    ).resolves.toMatchObject({ id: workerId });
  });

  it('enrolls and revokes a browser identity without Models access', async () => {
    const installationId = randomUUID();
    const registration = await workerService.enrollBrowser(
      installationId,
      'ia-browser-e2e',
      'browser-owner',
      { runtime: 'test' },
    );

    await expect(
      workerService.authenticate(
        installationId,
        registration.credential,
        WorkerKind.BROWSER,
      ),
    ).resolves.toMatchObject({
      id: installationId,
      workerKind: WorkerKind.BROWSER,
      ownerPrincipal: 'browser-owner',
      capabilities: expect.arrayContaining([
        'tool.browser.read_current_page/1',
        'tool.browser.navigate/1',
        'tool.browser.go_back/1',
        'tool.browser.click/1',
        'tool.browser.type_text/1',
        'tool.browser.select_option/1',
      ]),
      stepKinds: [ExecutionStepKind.TOOL],
    });
    await expect(
      workerService.authenticate(
        installationId,
        registration.credential,
        WorkerKind.MODELS,
      ),
    ).rejects.toThrow('invalid_worker_credential');

    await workerService.revokeBrowser(installationId, 'browser-owner');
    await expect(
      workerService.authenticate(
        installationId,
        registration.credential,
        WorkerKind.BROWSER,
      ),
    ).rejects.toThrow('invalid_worker_credential');
    await expect(
      attemptService.claimReadyStep({
        workerId: installationId,
        ownerPrincipal: 'browser-owner',
        stepKinds: [ExecutionStepKind.TOOL],
        capabilities: ['tool.browser.navigate/1'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
    ).rejects.toThrow('worker_not_available');
    await expect(workerService.findById(installationId)).resolves.toMatchObject(
      {
        status: 'revoked',
        revokedAt: expect.any(Date),
      },
    );
  });

  it('serializes concurrent claims at the registered worker limit', async () => {
    const workerId = randomUUID();
    await workerService.registerModels(
      workerId,
      'models-concurrency-e2e',
      ['detect-language'],
      [ExecutionStepKind.SERVICE],
      1,
      { runtime: 'test' },
    );
    await Promise.all(
      ['worker-limit-first', 'worker-limit-second'].map(() =>
        service.create(
          'detect-language',
          ExecutionPriority.NORMAL,
          { resourceId: 7, samples: ['Hello'] },
          {
            initialStep: {
              stepKind: ExecutionStepKind.SERVICE,
              work: {
                taskType: 'detect-language',
                payload: { resourceId: 7, samples: ['Hello'] },
              },
              requiredCapabilities: ['detect-language'],
            },
          },
        ),
      ),
    );

    const claims = await Promise.all([
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.SERVICE],
        capabilities: ['detect-language'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.SERVICE],
        capabilities: ['detect-language'],
        leaseDurationMs: 30_000,
        enforceRegisteredWorkerCapacity: true,
      }),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
    const registration = (await workerService.registrations()).find(
      (worker) => worker.workerId === workerId,
    );
    expect(registration).toEqual(
      expect.objectContaining({
        concurrency: { maximum: 1, available: 0 },
        activeAssignments: [claims.find(Boolean)?.attemptId],
        loadSummary: { state: 'busy', active: 1 },
      }),
    );
  });

  it('serializes resource claims and acknowledges result retries', async () => {
    const resourceKey = `resource:${randomUUID()}`;
    const executions = await Promise.all(
      ['first', 'second'].map(() =>
        service.create(
          'detect-language',
          ExecutionPriority.NORMAL,
          { resourceId: 7, samples: ['Hello'] },
          {
            initialStep: {
              stepKind: ExecutionStepKind.SERVICE,
              work: {
                taskType: 'detect-language',
                payload: { resourceId: 7, samples: ['Hello'] },
              },
              resourceKeys: [resourceKey],
            },
          },
        ),
      ),
    );
    const steps = await dataSource.getRepository(ExecutionStepEntity).findBy({
      executionId: In(executions.map((execution) => execution.executionId)),
    });
    expect(steps).toHaveLength(2);

    const claims = await Promise.allSettled(
      steps.map((step) =>
        attemptService.grantAttempt({
          stepId: step.stepId,
          workerId: randomUUID(),
          leaseDurationMs: 30_000,
        }),
      ),
    );
    const granted = claims.filter(
      (claim): claim is PromiseFulfilledResult<ExecutionStepAttemptEntity> =>
        claim.status === 'fulfilled',
    );
    const rejected = claims.filter(
      (claim): claim is PromiseRejectedResult => claim.status === 'rejected',
    );
    expect(granted).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toContain('resource_conflict');

    const attempt = granted[0].value;
    await attemptService.startAttempt(attempt.attemptId, attempt.claimedBy);
    const resultEnvelope = {
      schemaVersion: 'step-result/1',
      executionId: attempt.executionId,
      stepId: attempt.stepId,
      operationId: attempt.operationId,
      attemptId: attempt.attemptId,
      stepKind: ExecutionStepKind.SERVICE,
      status: 'succeeded',
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      output: { kind: 'service', value: { language: 'en' } },
      artifactRefs: [],
      error: null,
    } as const;
    const result = {
      executionId: resultEnvelope.executionId,
      stepId: resultEnvelope.stepId,
      operationId: resultEnvelope.operationId,
      attemptId: resultEnvelope.attemptId,
      workerId: attempt.claimedBy,
      result: resultEnvelope,
    };
    await expect(attemptService.receiveResult(result)).resolves.toMatchObject({
      code: 'received',
      receiptId: expect.any(String),
    });
    await expect(attemptService.receiveResult(result)).resolves.toMatchObject({
      code: 'duplicate',
      receiptId: expect.any(String),
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ExecutionOperationEntity).findOneByOrFail({
        operationId: attempt.operationId,
      }),
    ).resolves.toMatchObject({
      operationId: attempt.operationId,
      status: ExecutionOperationStatus.SUCCEEDED,
      currentAttemptId: null,
      result: { kind: 'service', value: { language: 'en' } },
    });
    await expect(
      dataSource.getRepository(ExecutionEntity).findOneByOrFail({
        executionId: attempt.executionId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.RUNNING,
      phase: 'coordination_pending',
      result: { language: 'en' },
    });
    await expect(terminalCandidateService.promoteReady()).resolves.toBe(1);
  });

  it('runs summarize fan-out and fan-in on the canonical step graph', async () => {
    const firstMapId = randomUUID();
    const secondMapId = randomUUID();
    const created = await service.create(
      'summarize',
      ExecutionPriority.NORMAL,
      { targetLanguage: 'en', type: 'summary' },
      {
        steps: [
          {
            stepId: firstMapId,
            stepKind: ExecutionStepKind.INFERENCE,
            work: {
              taskType: 'summarize-map',
              payload: {
                content: 'first',
                chunkIndex: 0,
                targetLanguage: 'en',
              },
            },
            requiredCapabilities: ['summarize-map'],
          },
          {
            stepId: secondMapId,
            stepKind: ExecutionStepKind.INFERENCE,
            work: {
              taskType: 'summarize-map',
              payload: {
                content: 'second',
                chunkIndex: 1,
                targetLanguage: 'en',
              },
            },
            requiredCapabilities: ['summarize-map'],
          },
          {
            stepKind: ExecutionStepKind.INFERENCE,
            dependsOnStepIds: [firstMapId, secondMapId],
            work: {
              taskType: 'summarize-reduce',
              payload: { targetLanguage: 'en' },
              coordination: {
                kind: 'map-reduce-reduce/1',
                mapStepIds: [firstMapId, secondMapId],
                resultKey: 'response',
              },
            },
            requiredCapabilities: ['summarize-reduce'],
          },
        ],
      },
    );
    const workerId = randomUUID();
    const inferenceMetadata = {
      codeFingerprint: TEST_CODE_FINGERPRINT,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      },
      inference: {
        effectiveModel: 'e2e-model',
        effectiveAdapter: null,
        effectivePromptPackages: ['e2e-prompt'],
        finishReason: 'completed',
        inferenceMs: 1,
        cacheOutcome: 'unknown',
        warnings: [],
      },
    };
    const assignments = await Promise.all([
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['summarize-map'],
        leaseDurationMs: 30_000,
      }),
      attemptService.claimReadyStep({
        workerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['summarize-map'],
        leaseDurationMs: 30_000,
      }),
    ]);
    expect(assignments.every(Boolean)).toBe(true);

    for (const assignment of assignments.reverse()) {
      await attemptService.startAttempt(assignment!.attemptId, workerId);
      const chunkIndex = Number(
        (assignment!.work.payload as Record<string, unknown>).chunkIndex,
      );
      await attemptService.receiveResult({
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        workerId,
        result: {
          schemaVersion: 'step-result/1',
          executionId: assignment!.executionId,
          stepId: assignment!.stepId,
          operationId: assignment!.operationId,
          attemptId: assignment!.attemptId,
          stepKind: ExecutionStepKind.INFERENCE,
          status: 'succeeded',
          output: {
            kind: ExecutionStepKind.INFERENCE,
            outcome: {
              kind: 'structured_result',
              schemaId: 'summarize-map-output/1',
              value: { response: chunkIndex === 0 ? 'first' : 'second' },
            },
          },
          ...inferenceMetadata,
          artifactRefs: [],
          error: null,
        },
      });
    }
    await expect(attemptService.processReceivedResults()).resolves.toBe(2);

    const reduceAssignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['summarize-reduce'],
      leaseDurationMs: 30_000,
    });
    expect(reduceAssignment?.work).toMatchObject({
      taskType: 'summarize-reduce',
      payload: { partials: ['first', 'second'] },
    });
    await attemptService.startAttempt(reduceAssignment!.attemptId, workerId);
    await attemptService.receiveResult({
      executionId: reduceAssignment!.executionId,
      stepId: reduceAssignment!.stepId,
      operationId: reduceAssignment!.operationId,
      attemptId: reduceAssignment!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: reduceAssignment!.executionId,
        stepId: reduceAssignment!.stepId,
        operationId: reduceAssignment!.operationId,
        attemptId: reduceAssignment!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'structured_result',
            schemaId: 'summarize-reduce-output/1',
            value: { response: 'merged' },
          },
        },
        ...inferenceMetadata,
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ExecutionEntity).findOneByOrFail({
        executionId: created.executionId,
      }),
    ).resolves.toMatchObject({
      status: ExecutionStatus.RUNNING,
      phase: 'coordination_pending',
      result: { response: 'merged' },
    });
    await expect(terminalCandidateService.promoteReady()).resolves.toBe(1);
  });

  it('materializes oversized chat input through a durable reduction graph', async () => {
    const message =
      `Create the report. ${'source material '.repeat(1400)}` +
      'Keep the final CSV constraint.';
    const created = await createChat(
      'assistant_chat',
      message,
      { ownerPrincipal: 'large-context-e2e' },
      { ownerId: 1 },
    );
    const workerId = randomUUID();
    const metadata = {
      codeFingerprint: TEST_CODE_FINGERPRINT,
      runtimeFingerprint: TEST_RUNTIME_FINGERPRINT,
      usage: {
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
      },
      inference: {
        effectiveModel: 'e2e-model',
        effectiveAdapter: null,
        effectivePromptPackages: ['e2e-prompt'],
        finishReason: 'completed',
        inferenceMs: 1,
        cacheOutcome: 'unknown',
        warnings: [],
      },
    };
    const initialSteps = await dataSource
      .getRepository(ExecutionStepEntity)
      .find({ where: { executionId: created.executionId } });
    const maps = initialSteps.filter(
      (step) => step.work.taskType === 'context-input-map',
    );
    expect(maps.length).toBeGreaterThan(1);
    expect(
      initialSteps.find((step) => step.work.taskType === 'assistant-chat'),
    ).toMatchObject({ status: ExecutionStepStatus.BLOCKED });

    for (let index = 0; index < maps.length; index += 1) {
      const mapWorkerId = randomUUID();
      const assignment = await attemptService.claimReadyStep({
        workerId: mapWorkerId,
        stepKinds: [ExecutionStepKind.INFERENCE],
        capabilities: ['context-input-map'],
        leaseDurationMs: 30_000,
      });
      expect(assignment).not.toBeNull();
      await attemptService.startAttempt(assignment!.attemptId, mapWorkerId);
      const chunkIndex = Number(
        (assignment!.work.payload as Record<string, unknown>).chunkIndex,
      );
      await attemptService.receiveResult({
        executionId: assignment!.executionId,
        stepId: assignment!.stepId,
        operationId: assignment!.operationId,
        attemptId: assignment!.attemptId,
        workerId: mapWorkerId,
        result: {
          schemaVersion: 'step-result/1',
          executionId: assignment!.executionId,
          stepId: assignment!.stepId,
          operationId: assignment!.operationId,
          attemptId: assignment!.attemptId,
          stepKind: ExecutionStepKind.INFERENCE,
          status: 'succeeded',
          output: {
            kind: ExecutionStepKind.INFERENCE,
            outcome: {
              kind: 'structured_result',
              schemaId: 'context-input-map-output/1',
              value: { digest: `digest-${chunkIndex}` },
            },
          },
          ...metadata,
          artifactRefs: [],
          error: null,
        },
      });
      await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    }

    const reduction = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['context-input-reduce'],
      leaseDurationMs: 30_000,
    });
    expect(reduction?.work).toMatchObject({
      taskType: 'context-input-reduce',
      payload: {
        partials: maps.map((_step, index) => `digest-${index}`),
      },
    });
    await attemptService.startAttempt(reduction!.attemptId, workerId);
    await attemptService.receiveResult({
      executionId: reduction!.executionId,
      stepId: reduction!.stepId,
      operationId: reduction!.operationId,
      attemptId: reduction!.attemptId,
      workerId,
      result: {
        schemaVersion: 'step-result/1',
        executionId: reduction!.executionId,
        stepId: reduction!.stepId,
        operationId: reduction!.operationId,
        attemptId: reduction!.attemptId,
        stepKind: ExecutionStepKind.INFERENCE,
        status: 'succeeded',
        output: {
          kind: ExecutionStepKind.INFERENCE,
          outcome: {
            kind: 'structured_result',
            schemaId: 'context-input-reduce-output/1',
            value: { digest: 'Complete reduced user request' },
          },
        },
        ...metadata,
        artifactRefs: [],
        error: null,
      },
    });
    await expect(attemptService.processReceivedResults()).resolves.toBe(1);
    await expect(agentLoopService.prepareReadyInferences()).resolves.toBe(1);

    const finalAssignment = await attemptService.claimReadyStep({
      workerId,
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['assistant-chat'],
      leaseDurationMs: 30_000,
    });
    expect(finalAssignment?.work.taskType).toBe('assistant-chat');
    const contextRef = finalAssignment!.inputArtifactRefs.find(
      (ref) => ref.role === 'active_context',
    );
    expect(contextRef).toBeDefined();
    const rows = await dataSource.query(
      'SELECT "body" FROM "execution_artifacts" WHERE "artifact_id" = $1',
      [contextRef!.artifactId],
    );
    const snapshot = JSON.parse((rows[0].body as Buffer).toString('utf8'));
    expect(snapshot.effectivePayload.activeInputReduction).toMatchObject({
      schemaVersion: 'active-input-reduction/1',
      strategy: 'chunk-map-reduce/1',
      chunkCount: maps.length,
      digest: 'Complete reduced user request',
    });
  });

  it('keeps assistant and agent chat as distinct execution types', async () => {
    const scope = { ownerPrincipal: 'e2e-user' };
    const assistant = await createChat(
      'assistant_chat',
      'assistant message',
      scope,
      {},
    );
    const agent = await createChat('agent_chat', 'agent message', scope, {});

    expect(assistant.taskType).toBe('assistant-chat');
    expect(agent.taskType).toBe('agent-chat');
  });

  it('retires an agent conversation while preserving execution evidence', async () => {
    const execution = await createChat(
      'agent_chat',
      'Temporary agent message',
      { ownerPrincipal: 'agent-delete-e2e' },
    );

    await service.retireConversation('agent', 1);

    await expect(
      dataSource.getRepository(ExecutionEntity).countBy({
        executionId: execution.executionId,
      }),
    ).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ExecutionEntity).findOneByOrFail({
        executionId: execution.executionId,
      }),
    ).resolves.toMatchObject({ status: ExecutionStatus.CANCELLED });
    await expect(
      dataSource.getRepository(ConversationSessionEntity).countBy({
        ownerType: 'agent',
        ownerId: 1,
      }),
    ).resolves.toBe(1);
    await expect(
      dataSource.getRepository(ConversationSessionEntity).findOneByOrFail({
        ownerType: 'agent',
        ownerId: 1,
      }),
    ).resolves.toMatchObject({ activeTurnId: null });
  });

  it('freezes consented owner memory into the active turn context', async () => {
    const memoryRepo = dataSource.getRepository(MemoryEntryEntity);
    const values = {
      name: 'Preferred editor',
      type: 'fact' as const,
      body: 'The preferred editor is Neovim',
    };
    const memory = await memoryRepo.save(
      memoryRepo.create({
        assistantId: 1,
        agentId: null,
        ...values,
        contentHash: canonicalHash(values),
        sourceKind: 'manual',
        sourceExecutionId: null,
        sourceTurnId: null,
        sourceMessageId: null,
        sourceArtifactId: null,
        sourceArtifactRevision: null,
        consentStatus: 'granted',
        consentBasis: 'explicit_user_action',
        consentedAt: new Date(),
        dataClassification: 'workspace',
        purpose: 'conversation_memory',
        allowedDestinations: ['documents', 'documents-models'],
      }),
    );
    const agentMemory = await memoryRepo.save(
      memoryRepo.create({
        assistantId: null,
        agentId: 1,
        ...values,
        contentHash: canonicalHash(values),
        sourceKind: 'manual',
        sourceExecutionId: null,
        sourceTurnId: null,
        sourceMessageId: null,
        sourceArtifactId: null,
        sourceArtifactRevision: null,
        consentStatus: 'granted',
        consentBasis: 'explicit_user_action',
        consentedAt: new Date(),
        dataClassification: 'workspace',
        purpose: 'conversation_memory',
        allowedDestinations: ['documents', 'documents-models'],
      }),
    );

    const execution = await createChat(
      'assistant_chat',
      'Which editor do I prefer?',
      { ownerPrincipal: 'memory-e2e' },
    );
    memory.body = 'Changed after the turn started';
    await memoryRepo.save(memory);

    const assistantPayload = execution.payload as ChatExecutionPayload;
    expect(assistantPayload.activeMemory).toMatchObject({
      schemaVersion: 'active-memory/1',
      owner: { type: 'assistant', id: 1 },
      activeEntries: [
        {
          entryId: memory.id,
          body: 'The preferred editor is Neovim',
          consent: { status: 'granted' },
          provenance: { sourceKind: 'manual' },
        },
      ],
    });

    const agentExecution = await createChat(
      'agent_chat',
      'Which editor do I prefer?',
      { ownerPrincipal: 'agent-memory-e2e' },
    );
    const agentPayload = agentExecution.payload as ChatExecutionPayload;
    expect(agentPayload.activeMemory).toMatchObject({
      owner: { type: 'agent', id: 1 },
      candidates: [expect.objectContaining({ entryId: agentMemory.id })],
      activeEntries: [expect.objectContaining({ entryId: agentMemory.id })],
    });
    const agentCandidates = (
      agentPayload.activeMemory as {
        candidates: Array<{ entryId: string }>;
      }
    ).candidates;
    expect(agentCandidates).not.toContainEqual(
      expect.objectContaining({ entryId: memory.id }),
    );
  });

  it('selects folder tools from persisted owner state rather than client payload', async () => {
    await dataSource.query(
      `UPDATE "assistants" SET "folder_scope" = '/workspace/real' WHERE "id" = 1`,
    );

    const accepted = await service.createForChat(
      'assistant_chat',
      'Read the workspace files',
      { ownerPrincipal: 'folder-capability-e2e' },
      { ownerId: 1, folderScope: '/workspace/spoofed' },
    );
    const acceptedPayload = accepted.execution.payload as ChatExecutionPayload;
    const capabilityNames = (
      acceptedPayload.activeCapabilities as {
        tools: Array<{ name: string }>;
      }
    ).tools.map(({ name }) => name);

    expect(acceptedPayload.folderScope).toBe('/workspace/real');
    expect(capabilityNames).toEqual(
      expect.arrayContaining([
        'workspace_files.list',
        'workspace_files.search',
        'workspace_files.read',
        'workspace_files.write',
        'workspace_files.delete',
      ]),
    );
    expect(acceptedPayload.activeCapabilities!.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillId: 'workspace-document-workflow',
          version: 'workspace-document-workflow/1',
          activationReason: 'signal_match',
          activationSignal: {
            kind: 'owner_scope_configured',
            scope: 'workspace_folder',
          },
          contentHash:
            'sha256:c755864bb8f6b113ff62c4912c20277bf66e71d37819921de46111a24c7cec91',
        }),
      ]),
    );
    expect(acceptedPayload.activeCapabilities!.skills[0]).not.toHaveProperty(
      'instructions',
    );
  });

  it('persists and closes a skill activation with its execution', async () => {
    await dataSource.query(
      `UPDATE "assistants" SET "folder_scope" = '/workspace/real' WHERE "id" = 1`,
    );
    const accepted = await service.createForChat(
      'assistant_chat',
      'Modify the budget document',
      { ownerPrincipal: 'skill-activation-e2e' },
      { ownerId: 1, folderScope: null },
    );
    const repo = dataSource.getRepository(SkillActivationEntity);
    const active = await repo.findOneByOrFail({
      executionId: accepted.execution.executionId,
      skillId: 'workspace-document-workflow',
    });
    expect(active).toMatchObject({
      schemaVersion: 'skill-activation/1',
      skillId: 'workspace-document-workflow',
      skillVersion: 'workspace-document-workflow/1',
      activationReason: 'signal_match',
      inputBindings: {
        owner: { type: 'assistant', id: 1 },
        signal: {
          kind: 'owner_scope_configured',
          scope: 'workspace_folder',
        },
      },
      phase: 'instructions_loaded',
      checkpoint: null,
      status: 'active',
      finishedAt: null,
    });

    await dataSource.transaction((manager) =>
      advanceSkillActivation(
        manager,
        active.activationId,
        'instructions_loaded',
        'workspace_inspection',
        { inspectedFiles: ['budget.xlsx'] },
      ),
    );
    await expect(
      repo.findOneByOrFail({ activationId: active.activationId }),
    ).resolves.toMatchObject({
      phase: 'workspace_inspection',
      checkpoint: { inspectedFiles: ['budget.xlsx'] },
      status: 'active',
    });
    await expect(
      dataSource.transaction((manager) =>
        advanceSkillActivation(
          manager,
          active.activationId,
          'instructions_loaded',
          'stale_overwrite',
          {},
        ),
      ),
    ).rejects.toThrow('skill_activation_phase_stale');

    await service.completeExecution(
      accepted.execution.executionId,
      'The document is ready.',
      null,
    );

    await expect(
      repo.findOneByOrFail({ activationId: active.activationId }),
    ).resolves.toMatchObject({
      phase: 'finished',
      checkpoint: { inspectedFiles: ['budget.xlsx'] },
      status: 'completed',
      finishedAt: expect.any(Date),
    });
  });

  it('persists every independently selected skill activation', async () => {
    await dataSource.query(
      `UPDATE "assistants" SET "folder_scope" = '/workspace/real' WHERE "id" = 1`,
    );
    const accepted = await service.createForChat(
      'assistant_chat',
      'Compare evidence in the document files',
      { ownerPrincipal: 'multiple-skills-e2e' },
      { ownerId: 1, folderScope: null },
    );
    const repo = dataSource.getRepository(SkillActivationEntity);
    const active = await repo.find({
      where: { executionId: accepted.execution.executionId },
      order: { skillId: 'ASC' },
    });

    expect(active.map(({ skillId }) => skillId)).toEqual([
      'evidence-research-workflow',
      'workspace-document-workflow',
    ]);
    expect(active).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillId: 'evidence-research-workflow',
          skillVersion: 'evidence-research-workflow/1',
          contentHash:
            'sha256:902f4eb209b750d9b7a62c8cb9daa297158e45a284a8f857fba3a676dcea8002',
          status: 'active',
        }),
      ]),
    );

    await service.completeExecution(
      accepted.execution.executionId,
      'Compared the evidence.',
      null,
    );
    await expect(
      repo.find({ where: { executionId: accepted.execution.executionId } }),
    ).resolves.toEqual([
      expect.objectContaining({ status: 'completed' }),
      expect.objectContaining({ status: 'completed' }),
    ]);
  });

  it('persists one conversation lane and promotes queued turns in order', async () => {
    const scope = { ownerPrincipal: 'conversation-lane-e2e' };
    const first = await createChat('assistant_chat', 'First message', scope);
    const second = await createChat('assistant_chat', 'Second message', scope);
    const third = await createChat('assistant_chat', 'Third message', scope);

    const sessionRepo = dataSource.getRepository(ConversationSessionEntity);
    const turnRepo = dataSource.getRepository(ConversationTurnEntity);
    const stepRepo = dataSource.getRepository(ExecutionStepEntity);
    const session = await sessionRepo.findOneByOrFail({
      ownerType: 'assistant',
      ownerId: 1,
    });
    expect(session.activeTurnId).toBe(first.turnId);
    await expect(
      turnRepo.findOneByOrFail({ turnId: first.turnId! }),
    ).resolves.toMatchObject({
      status: ConversationTurnStatus.ACTIVE,
      startingConversationRevision: 1,
    });
    await expect(
      turnRepo.findOneByOrFail({ turnId: second.turnId! }),
    ).resolves.toMatchObject({
      status: ConversationTurnStatus.QUEUED,
      startingConversationRevision: 1,
    });
    await expect(
      stepRepo.countBy({ executionId: first.executionId }),
    ).resolves.toBe(1);
    await expect(
      stepRepo.countBy({ executionId: second.executionId }),
    ).resolves.toBe(0);
    const firstStep = await stepRepo.findOneByOrFail({
      executionId: first.executionId,
    });
    const firstContextRef = firstStep.inputArtifactRefs.find(
      (ref) => ref.role === 'active_context',
    );
    expect(firstContextRef).toBeDefined();
    const firstContextArtifact = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifactId = :artifactId', {
        artifactId: firstContextRef!.artifactId,
      })
      .getOneOrFail();
    const firstSnapshot = JSON.parse(firstContextArtifact.body!.toString());
    expect(firstSnapshot).toMatchObject({
      schemaVersion: 'active-context/1',
      sessionId: session.sessionId,
      turnId: first.turnId,
      sourceConversation: { revision: 1 },
      effectivePayload: {
        conversation: [{ role: 'user', content: 'First message' }],
        continuityCapsule: null,
      },
    });

    await service.updateStatus(
      second.executionId,
      ExecutionStatus.CANCELLED,
      undefined,
      { cancellationReason: 'Cancel queued turn' },
    );
    expect(
      (await sessionRepo.findOneByOrFail({ sessionId: session.sessionId }))
        .activeTurnId,
    ).toBe(first.turnId);

    await service.updateStatus(
      first.executionId,
      ExecutionStatus.CANCELLED,
      undefined,
      { cancellationReason: 'Superseded in lane test' },
    );

    const promotedSession = await sessionRepo.findOneByOrFail({
      sessionId: session.sessionId,
    });
    expect(promotedSession.activeTurnId).toBe(third.turnId);
    expect(promotedSession.conversationRevision).toBe(2);
    await expect(
      turnRepo.findOneByOrFail({ turnId: first.turnId! }),
    ).resolves.toMatchObject({
      status: ConversationTurnStatus.CANCELLED,
      terminalConversationRevision: 1,
    });
    await expect(
      turnRepo.findOneByOrFail({ turnId: second.turnId! }),
    ).resolves.toMatchObject({
      status: ConversationTurnStatus.CANCELLED,
      terminalConversationRevision: 1,
    });
    await expect(
      turnRepo.findOneByOrFail({ turnId: third.turnId! }),
    ).resolves.toMatchObject({
      status: ConversationTurnStatus.ACTIVE,
      startingConversationRevision: 2,
    });
    await expect(
      stepRepo.countBy({ executionId: second.executionId }),
    ).resolves.toBe(0);
    await expect(
      stepRepo.countBy({ executionId: third.executionId }),
    ).resolves.toBe(1);
    const promotedStep = await stepRepo.findOneByOrFail({
      executionId: third.executionId,
    });
    const promotedContextRef = promotedStep.inputArtifactRefs.find(
      (ref) => ref.role === 'active_context',
    );
    expect(promotedContextRef).toBeDefined();
    const promotedContextArtifact = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifactId = :artifactId', {
        artifactId: promotedContextRef!.artifactId,
      })
      .getOneOrFail();
    const promotedSnapshot = JSON.parse(
      promotedContextArtifact.body!.toString(),
    );
    expect(promotedSnapshot.sourceConversation.revision).toBe(2);
    expect(promotedSnapshot.effectivePayload.conversation).toEqual([
      { role: 'user', content: 'First message' },
      { role: 'user', content: 'Third message' },
    ]);
  });

  it('serializes concurrent messages into one session and one active turn', async () => {
    await Promise.all([
      createChat('assistant_chat', 'Concurrent message A', {
        ownerPrincipal: 'conversation-concurrency-e2e',
      }),
      createChat('assistant_chat', 'Concurrent message B', {
        ownerPrincipal: 'conversation-concurrency-e2e',
      }),
    ]);

    const session = await dataSource
      .getRepository(ConversationSessionEntity)
      .findOneByOrFail({ ownerType: 'assistant', ownerId: 1 });
    const turns = await dataSource
      .getRepository(ConversationTurnEntity)
      .findBy({
        sessionId: session.sessionId,
      });
    expect(turns).toHaveLength(2);
    expect(
      turns.filter((turn) => turn.status === ConversationTurnStatus.ACTIVE),
    ).toHaveLength(1);
    expect(
      turns.filter((turn) => turn.status === ConversationTurnStatus.QUEUED),
    ).toHaveLength(1);
    await expect(
      dataSource.getRepository(ExecutionStepEntity).count(),
    ).resolves.toBe(1);
  });

  it(
    'serializes concurrent producers, paginates, deduplicates, ' +
      'and enforces append-only rows',
    async () => {
      const scope = { ownerPrincipal: 'e2e-user' };
      const context = await createChat(
        'assistant_chat',
        'Authorization: Bearer known-secret',
        scope,
        {},
      );
      const first = progress(context, 'worker-a');
      const second = progress(context, 'worker-b');

      await Promise.all([
        service.acceptEvents(context.rootExecutionId, [first]),
        service.acceptEvents(context.rootExecutionId, [second]),
      ]);
      await expect(
        service.acceptEvents(context.rootExecutionId, [first]),
      ).resolves.toMatchObject({
        accepted: 0,
        duplicates: 1,
        lastSequence: 5,
      });

      const page1 = await service.readEvents(
        context.rootExecutionId,
        scope,
        0,
        2,
      );
      const page2 = await service.readEvents(
        context.rootExecutionId,
        scope,
        page1.nextAfterSequence,
        10,
      );
      expect(page1.events.map((event: any) => event.sequence)).toEqual([1, 2]);
      expect(page2.events.map((event: any) => event.sequence)).toEqual([
        3, 4, 5,
      ]);
      await expect(
        service.readEvents(context.rootExecutionId, {
          ownerPrincipal: 'other-user',
        }),
      ).rejects.toThrow('Execution not found');

      await expect(
        service.exportBundle(context.rootExecutionId, scope, false),
      ).rejects.toThrow('Explicit consent');
      const bundle = await service.exportBundle(
        context.rootExecutionId,
        scope,
        true,
      );
      expect(JSON.stringify(bundle)).not.toContain('known-secret');
      expect(bundle.embeddedArtifacts).toBeDefined();
      expect(bundle.skillActivations).toEqual([
        expect.objectContaining({
          skillId: 'evidence-research-workflow',
          activationReason: 'signal_match',
          inputBindings: expect.objectContaining({
            signal: {
              kind: 'capability_available',
              capability: 'documents.search',
            },
          }),
        }),
      ]);
      expect(bundle.bundleCompleteness).toEqual({
        status: 'reproducible',
        reproducible: true,
        missing: [],
      });
      expect(bundle.policySummary).toEqual({
        decision: 'allow',
        purpose: 'evaluation',
        consent: {
          status: 'granted',
          basis: 'explicit_export_request',
        },
        allowedDestinations: ['ai-train'],
        retentionClass: 'evaluation',
        accessScope: scope,
      });
      const bundleEvents = bundle.events as Record<string, any>[];
      const bundleArtifacts = bundle.artifacts as Record<string, any>[];
      const userSource = bundleEvents.find(
        (event: any) => event.eventType === 'source.observed',
      );
      const userArtifact = bundleArtifacts.find(
        (artifact: any) => artifact.kind === 'user_message',
      );
      expect(userArtifact.inputSourceIds).toEqual([
        userSource.payload.sourceId,
      ]);

      await expect(
        dataSource.query(
          `UPDATE "${schema}"."execution_events" SET "event_type" = 'changed' WHERE "event_id" = $1`,
          [first.eventId],
        ),
      ).rejects.toThrow('append-only');
      const stored = await dataSource
        .getRepository(ExecutionEventEntity)
        .findOneBy({
          eventId: first.eventId,
        });
      expect(stored.eventType).toBe('progress.reported');
    },
  );

  it('serializes the last operation budget slots and fences stale attempts', async () => {
    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await createChat('assistant_chat', 'budget me', scope, {});
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);

    const requestedPolicy = {
      normal: 1,
      normalInferenceSoftLimit: 0,
      repair: 0,
      closing: 0,
      maxTokensPerInference: 512,
      toolCalls: 1,
      toolCallSoftLimit: 0,
      exactToolRepeatWarning: true,
    };
    const { grant } = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy,
    });
    const reserve = (operationId: string) =>
      budgets.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'direct_response',
        round: 1,
        name: 'direct_response',
      });

    const decisions = await Promise.all([
      reserve(randomUUID()),
      reserve(randomUUID()),
    ]);
    expect(decisions.filter((decision) => decision.granted)).toHaveLength(1);
    expect(decisions.filter((decision) => !decision.granted)).toHaveLength(1);

    const reserveTool = (operationId: string, toolCallId: string) =>
      budgets.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId,
        phase: 'agent_loop',
        round: 1,
        name: 'folder_read',
      });
    const toolDecisions = await Promise.all([
      reserveTool(randomUUID(), randomUUID()),
      reserveTool(randomUUID(), randomUUID()),
    ]);
    expect(toolDecisions.filter((decision) => decision.granted)).toHaveLength(
      1,
    );
    expect(toolDecisions.filter((decision) => !decision.granted)).toHaveLength(
      1,
    );

    const nextAttemptId = randomUUID();
    await activateStepAttempt(context.executionId, nextAttemptId);
    const repeated = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy,
    });
    expect(repeated.grant.grantId).toBe(grant.grantId);
    await expect(reserve(randomUUID())).resolves.toMatchObject({
      granted: false,
      reservation: { reason: 'budget_hard_limit_reached' },
    });
    await expect(
      reserveTool(randomUUID(), randomUUID()),
    ).resolves.toMatchObject({
      granted: false,
      reservation: { reason: 'tool_budget_hard_limit_reached' },
    });
  });

  it('records one soft-limit signal when concurrent tool reservations cross it', async () => {
    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await createChat(
      'assistant_chat',
      'cross the tool soft limit',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const { grant } = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy: {
        normal: 1,
        normalInferenceSoftLimit: 0,
        repair: 0,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 6,
        toolCallSoftLimit: 4,
        exactToolRepeatWarning: true,
      },
    });
    const reserveTool = (operationId = randomUUID()) =>
      budgets.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId: randomUUID(),
        phase: 'agent_loop',
        round: 1,
        name: 'folder_read',
      });

    await reserveTool();
    await reserveTool();
    await reserveTool();
    const concurrentOperationIds = [randomUUID(), randomUUID()];
    const decisions = await Promise.all(
      concurrentOperationIds.map((operationId) => reserveTool(operationId)),
    );

    expect(decisions.every((decision) => decision.granted)).toBe(true);
    const signals = decisions
      .map((decision) => decision.softLimitSignal)
      .filter(Boolean);
    expect(signals).toHaveLength(1);
    expect(concurrentOperationIds).toContain(signals[0]?.triggeringOperationId);
    const projected = await service.readProgress(
      context.rootExecutionId,
      scope,
    );
    const usage = Object.values(projected.ledger.operationBudget.grants)[0]
      .usage.tool;
    expect(usage).toMatchObject({
      granted: 6,
      reserved: 5,
      consumed: 0,
      available: 1,
      softLimit: 4,
      softLimitReached: true,
    });
    const storedSignals = (
      await dataSource.getRepository(ExecutionEventEntity).find({
        where: { rootExecutionId: context.rootExecutionId },
      })
    ).filter(
      (event) =>
        (event.envelope.payload as Record<string, unknown>)?.kind ===
        'budget_soft_limit_reached',
    );
    expect(storedSignals).toHaveLength(1);
  });

  it('records one soft-limit signal at the normal inference soft limit', async () => {
    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await createChat(
      'assistant_chat',
      'cross the normal inference soft limit',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const { grant } = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy: {
        normal: 3,
        normalInferenceSoftLimit: 2,
        repair: 0,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 0,
        toolCallSoftLimit: 0,
        exactToolRepeatWarning: true,
      },
    });
    const reserveInference = (operationId = randomUUID()) =>
      budgets.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'agent_loop',
        round: 1,
        name: 'chat_with_tools',
      });

    await reserveInference();
    const concurrentOperationIds = [randomUUID(), randomUUID()];
    const decisions = await Promise.all(
      concurrentOperationIds.map((operationId) =>
        reserveInference(operationId),
      ),
    );

    expect(decisions.every((decision) => decision.granted)).toBe(true);
    const signals = decisions
      .map((decision) => decision.softLimitSignal)
      .filter(Boolean);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      operationKind: 'inference',
      bucket: 'normal',
      softLimit: 2,
      hardLimit: 3,
    });
    expect(concurrentOperationIds).toContain(signals[0]?.triggeringOperationId);
    const projected = await service.readProgress(
      context.rootExecutionId,
      scope,
    );
    const usage = Object.values(projected.ledger.operationBudget.grants)[0]
      .usage.normal;
    expect(usage).toMatchObject({
      granted: 3,
      reserved: 3,
      consumed: 0,
      available: 0,
      softLimit: 2,
      softLimitReached: true,
      softLimitWarningPending: true,
    });
  });

  it('persists one exact-repeat signal and consumes its warning transactionally', async () => {
    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await createChat(
      'assistant_chat',
      'repeat one exact tool call',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const { grant } = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy: {
        normal: 2,
        normalInferenceSoftLimit: 0,
        repair: 0,
        closing: 1,
        maxTokensPerInference: 512,
        toolCalls: 3,
        toolCallSoftLimit: 0,
        exactToolRepeatWarning: true,
        exactToolRepeatBlockAfterWarning: true,
      },
    });
    const fingerprint = `sha256:${'a'.repeat(64)}`;
    const resultFingerprint = `sha256:${'b'.repeat(64)}`;
    let producerSequence = 0;
    let causedByEventId = (
      await dataSource.getRepository(ExecutionEntity).findOneByOrFail({
        executionId: context.executionId,
      })
    ).lastEventId;
    const accept = async (
      eventType: string,
      payloadSchema: string,
      payload: Record<string, unknown>,
      identity: Record<string, unknown>,
    ) => {
      const eventId = randomUUID();
      await service.acceptEvents(context.rootExecutionId, [
        {
          eventId,
          rootExecutionId: context.rootExecutionId,
          executionId: context.executionId,
          turnId: context.turnId,
          producerSequence: ++producerSequence,
          eventType,
          producer: {
            component: 'documents-models',
            instanceId: `mvp10-${attemptId}`,
            version: 'test',
          },
          actor: {
            type: payload.operationKind === 'inference' ? 'model' : 'tool',
          },
          causedByEventId,
          occurredAt: new Date().toISOString(),
          payloadSchema,
          payload,
          artifactRefs: [],
          security: {
            dataClassification: 'workspace',
            purpose: 'evaluation',
            allowedDestinations: ['documents', 'ai-train'],
            redactionApplied: true,
          },
          ...identity,
        } as any,
      ]);
      causedByEventId = eventId;
    };
    const reserveTool = (
      operationId: string,
      toolCallId: string,
      round: number,
    ) =>
      budgets.reserveOperationBudget(context.executionId, {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId,
        operationFingerprint: fingerprint,
        operationFingerprintVersion: 'canonical_tool_input_v1',
        phase: 'agent_loop',
        round,
        name: 'folder_read',
      });
    const firstOperationId = randomUUID();
    const firstToolCallId = randomUUID();
    const first = await reserveTool(firstOperationId, firstToolCallId, 1);
    causedByEventId = first.eventId;
    const firstAttemptId = randomUUID();
    await accept(
      'operation.started',
      'operation.started/1',
      {
        operationKind: 'tool_call',
        status: 'dispatched',
        name: 'folder_read',
        loopId: context.executionId,
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 1,
        maxRounds: 2,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: first.reservation.reservationId,
        budgetBucket: 'tool',
        operationFingerprint: fingerprint,
        operationFingerprintVersion: 'canonical_tool_input_v1',
      },
      {
        operationId: firstOperationId,
        attemptId: firstAttemptId,
        toolCallId: firstToolCallId,
      },
    );
    const firstSourceId = randomUUID();
    await accept(
      'source.observed',
      'source.observed/1',
      {
        sourceId: firstSourceId,
        kind: 'tool_output',
        originComponent: 'documents-models',
        observedAt: new Date().toISOString(),
        contentHash: resultFingerprint,
        trustLevel: 'tool_observation',
        dataClassification: 'workspace',
      },
      {
        operationId: firstOperationId,
        attemptId: firstAttemptId,
        toolCallId: firstToolCallId,
        sourceId: firstSourceId,
      },
    );
    await accept(
      'operation.finished',
      'operation.finished/1',
      {
        operationKind: 'tool_call',
        status: 'succeeded',
        result: { summary: 'Folder read' },
        error: null,
      },
      {
        operationId: firstOperationId,
        attemptId: firstAttemptId,
        toolCallId: firstToolCallId,
      },
    );

    const repeatedOperationId = randomUUID();
    const repeatedToolCallId = randomUUID();
    const decisions = await Promise.all([
      reserveTool(repeatedOperationId, repeatedToolCallId, 2),
      reserveTool(repeatedOperationId, repeatedToolCallId, 2),
    ]);
    expect(decisions.every((decision) => decision.granted)).toBe(true);
    expect(decisions[0].loopGuardSignal).toEqual(decisions[1].loopGuardSignal);
    expect(decisions[0].guardState).toMatchObject({
      detections: 1,
      warningIssued: true,
      warningPending: true,
    });
    const storedSignals = (
      await dataSource.getRepository(ExecutionEventEntity).find({
        where: { rootExecutionId: context.rootExecutionId },
      })
    ).filter(
      (event) =>
        (event.envelope.payload as Record<string, unknown>)?.kind ===
        'loop_guard_triggered',
    );
    expect(storedSignals).toHaveLength(1);

    causedByEventId = decisions[0].eventId;
    const repeatedAttemptId = randomUUID();
    await accept(
      'operation.started',
      'operation.started/1',
      {
        operationKind: 'tool_call',
        status: 'dispatched',
        name: 'folder_read',
        loopId: context.executionId,
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 2,
        maxRounds: 3,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: decisions[0].reservation.reservationId,
        budgetBucket: 'tool',
        operationFingerprint: fingerprint,
        operationFingerprintVersion: 'canonical_tool_input_v1',
      },
      {
        operationId: repeatedOperationId,
        attemptId: repeatedAttemptId,
        toolCallId: repeatedToolCallId,
      },
    );
    const repeatedSourceId = randomUUID();
    await accept(
      'source.observed',
      'source.observed/1',
      {
        sourceId: repeatedSourceId,
        kind: 'tool_output',
        originComponent: 'documents-models',
        observedAt: new Date().toISOString(),
        contentHash: resultFingerprint,
        trustLevel: 'tool_observation',
        dataClassification: 'workspace',
      },
      {
        operationId: repeatedOperationId,
        attemptId: repeatedAttemptId,
        toolCallId: repeatedToolCallId,
        sourceId: repeatedSourceId,
      },
    );
    await accept(
      'operation.finished',
      'operation.finished/1',
      {
        operationKind: 'tool_call',
        status: 'succeeded',
        result: { summary: 'Folder read' },
        error: null,
      },
      {
        operationId: repeatedOperationId,
        attemptId: repeatedAttemptId,
        toolCallId: repeatedToolCallId,
      },
    );

    const inferenceOperationId = randomUUID();
    const inference = await budgets.reserveOperationBudget(
      context.executionId,
      {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId: inferenceOperationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'agent_loop',
        round: 2,
        name: 'chat_with_tools',
      },
    );
    causedByEventId = inference.eventId;
    const inferenceAttemptId = randomUUID();
    const inferencePayload = {
      operationKind: 'inference',
      status: 'dispatched',
      name: 'chat_with_tools',
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      round: 2,
      maxRounds: 2,
      phase: 'agent_loop',
      budgetGrantId: grant.grantId,
      budgetReservationId: inference.reservation.reservationId,
      budgetBucket: 'normal',
    };
    await expect(
      accept('operation.started', 'operation.started/1', inferencePayload, {
        operationId: inferenceOperationId,
        attemptId: inferenceAttemptId,
      }),
    ).rejects.toThrow('Loop guard warning does not match');
    await accept(
      'operation.started',
      'operation.started/1',
      { ...inferencePayload, loopGuardWarningApplied: true },
      {
        operationId: inferenceOperationId,
        attemptId: inferenceAttemptId,
      },
    );
    const projected = await service.readProgress(
      context.rootExecutionId,
      scope,
    );
    expect(
      projected.ledger.loopGuards[grant.grantId].exactToolRepeat,
    ).toMatchObject({
      warningPending: false,
      warningAppliedToOperationId: inferenceOperationId,
    });

    const blockedOperationId = randomUUID();
    const blockedToolCallId = randomUUID();
    const blockedDecisions = await Promise.all([
      reserveTool(blockedOperationId, blockedToolCallId, 3),
      reserveTool(blockedOperationId, blockedToolCallId, 3),
    ]);
    expect(blockedDecisions.every((decision) => !decision.granted)).toBe(true);
    expect(blockedDecisions[0]).toMatchObject({
      reservation: {
        operationId: blockedOperationId,
        status: 'denied',
        reason: 'immediate_exact_tool_repeat_blocked',
      },
      loopGuardSignal: {
        action: 'block',
        previousOperationId: repeatedOperationId,
        triggeringOperationId: blockedOperationId,
        warningAppliedToOperationId: inferenceOperationId,
        operationFingerprint: fingerprint,
        resultFingerprint,
      },
      budgetState: {
        tool: { consumed: 2, available: 1 },
      },
      guardState: {
        detections: 2,
        blocks: 1,
        warningPending: false,
      },
    });
    expect(blockedDecisions[0].loopGuardSignal).toEqual(
      blockedDecisions[1].loopGuardSignal,
    );
    const finalEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({ where: { rootExecutionId: context.rootExecutionId } });
    expect(
      finalEvents.filter(
        (event) =>
          (event.envelope.payload as Record<string, unknown>)?.kind ===
          'loop_guard_triggered',
      ),
    ).toHaveLength(2);
    expect(
      finalEvents.some(
        (event) =>
          event.envelope.eventType === 'operation.started' &&
          event.envelope.operationId === blockedOperationId,
      ),
    ).toBe(false);
  });

  it('validates, fences, finalizes, and replays a deterministic partial', async () => {
    const scope = { ownerPrincipal: 'e2e-user' };
    const context = await createChat(
      'assistant_chat',
      'materialize a deterministic partial',
      scope,
      {},
    );
    const attemptId = randomUUID();
    await activateStepAttempt(context.executionId, attemptId);
    const requestedPolicy = {
      normal: 1,
      normalInferenceSoftLimit: 0,
      repair: 0,
      closing: 1,
      maxTokensPerInference: 128,
      toolCalls: 1,
      toolCallSoftLimit: 0,
      exactToolRepeatWarning: true,
    };
    const { grant } = await budgets.requestProgressGrant(context.executionId, {
      executionId: context.executionId,
      turnId: context.turnId,
      loopId: context.executionId,
      agentName: 'assistant',
      loopKind: 'top_level',
      requestedPolicy,
    });
    const repository = dataSource.getRepository(ExecutionEntity);
    let causedByEventId = (
      await repository.findOneByOrFail({
        executionId: context.executionId,
      })
    ).lastEventId;
    let producerSequence = 0;
    const accept = async (
      eventType: string,
      payloadSchema: string,
      payload: Record<string, unknown>,
      identity: Record<string, unknown> = {},
      actor: Record<string, unknown> = { type: 'worker' },
    ) => {
      const eventId = randomUUID();
      await service.acceptEvents(context.rootExecutionId, [
        {
          eventId,
          rootExecutionId: context.rootExecutionId,
          executionId: context.executionId,
          turnId: context.turnId,
          producerSequence: ++producerSequence,
          eventType,
          producer: {
            component: 'documents-models',
            instanceId: `mvp09-${attemptId}`,
            version: 'test',
          },
          actor,
          causedByEventId,
          occurredAt: new Date().toISOString(),
          payloadSchema,
          payload,
          artifactRefs: [],
          security: {
            dataClassification: 'workspace',
            purpose: 'evaluation',
            allowedDestinations: ['documents', 'ai-train'],
            redactionApplied: true,
          },
          ...identity,
        } as any,
      ]);
      causedByEventId = eventId;
    };
    const refreshCause = async () => {
      causedByEventId = (
        await repository.findOneByOrFail({
          executionId: context.executionId,
        })
      ).lastEventId;
    };

    const normalOperationId = randomUUID();
    const normalAttemptId = randomUUID();
    const normalReservation = await budgets.reserveOperationBudget(
      context.executionId,
      {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId: normalOperationId,
        operationKind: 'inference',
        bucket: 'normal',
        phase: 'agent_loop',
        round: 1,
        name: 'chat_with_tools',
      },
    );
    await refreshCause();
    await accept(
      'operation.started',
      'operation.started/1',
      {
        operationKind: 'inference',
        status: 'dispatched',
        name: 'chat_with_tools',
        loopId: context.executionId,
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 1,
        maxRounds: 1,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: normalReservation.reservation.reservationId,
        budgetBucket: 'normal',
      },
      { operationId: normalOperationId, attemptId: normalAttemptId },
      { type: 'model' },
    );
    await accept(
      'operation.finished',
      'operation.finished/1',
      {
        operationKind: 'inference',
        status: 'succeeded',
        outcome: 'tool_requests',
        result: { content: '', tool_calls: 1 },
        error: null,
      },
      { operationId: normalOperationId, attemptId: normalAttemptId },
      { type: 'model' },
    );

    const toolOperationId = randomUUID();
    const toolAttemptId = randomUUID();
    const toolCallId = randomUUID();
    const toolReservation = await budgets.reserveOperationBudget(
      context.executionId,
      {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId: toolOperationId,
        operationKind: 'tool_call',
        bucket: 'tool',
        toolCallId,
        phase: 'agent_loop',
        round: 1,
        name: 'folder_read',
      },
    );
    await refreshCause();
    await accept(
      'operation.started',
      'operation.started/1',
      {
        operationKind: 'tool_call',
        status: 'dispatched',
        name: 'folder_read',
        inputSummary: { path: 'fixture.txt' },
        loopId: context.executionId,
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 1,
        maxRounds: 1,
        phase: 'agent_loop',
        budgetGrantId: grant.grantId,
        budgetReservationId: toolReservation.reservation.reservationId,
        budgetBucket: 'tool',
      },
      {
        operationId: toolOperationId,
        attemptId: toolAttemptId,
        toolCallId,
      },
    );
    await accept(
      'operation.finished',
      'operation.finished/1',
      {
        operationKind: 'tool_call',
        status: 'succeeded',
        result: { path: 'fixture.txt' },
        resultSummary: 'Document read',
        resultSummaryKind: 'leaf_tool',
        error: null,
      },
      {
        operationId: toolOperationId,
        attemptId: toolAttemptId,
        toolCallId,
      },
    );

    const closingOperationId = randomUUID();
    const closingAttemptId = randomUUID();
    const closingReservation = await budgets.reserveOperationBudget(
      context.executionId,
      {
        executionId: context.executionId,
        loopId: context.executionId,
        grantId: grant.grantId,
        operationId: closingOperationId,
        operationKind: 'inference',
        bucket: 'closing',
        phase: 'forced_finalization',
        round: 1,
        name: 'forced_finalization',
      },
    );
    await refreshCause();
    await accept(
      'operation.started',
      'operation.started/1',
      {
        operationKind: 'inference',
        status: 'dispatched',
        name: 'forced_finalization',
        loopId: context.executionId,
        agentName: 'assistant',
        loopKind: 'top_level',
        round: 1,
        maxRounds: 1,
        phase: 'forced_finalization',
        budgetGrantId: grant.grantId,
        budgetReservationId: closingReservation.reservation.reservationId,
        budgetBucket: 'closing',
      },
      { operationId: closingOperationId, attemptId: closingAttemptId },
      { type: 'model' },
    );
    await accept(
      'operation.finished',
      'operation.finished/1',
      {
        operationKind: 'inference',
        status: 'succeeded',
        outcome: 'invalid',
        reason: 'empty_model_response',
        result: { content: '' },
        error: null,
      },
      { operationId: closingOperationId, attemptId: closingAttemptId },
      { type: 'model' },
    );

    const reply = [
      "I couldn't produce the final synthesis because this turn reached its execution limit.",
      '',
      'Completed work:',
      '- Folder read: Document read',
      '',
      'Pending:',
      '- Final synthesis of the completed results.',
    ].join('\n');
    const finalArtifactId = randomUUID();
    const finalBody = Buffer.from(reply, 'utf8');
    await service.acceptArtifacts(context.rootExecutionId, [
      {
        artifactId: finalArtifactId,
        kind: 'model_response',
        contentHash: contentHash(finalBody),
        size: finalBody.length,
        mediaType: 'text/plain',
        encoding: 'identity',
        dataClassification: 'workspace',
        redaction: { applied: false },
        retentionClass: 'evaluation',
        inputSourceIds: [],
        bodyBase64: finalBody.toString('base64'),
      },
    ]);
    await accept(
      'message.recorded',
      'message.recorded/1',
      {
        messageKind: 'final_response',
        role: 'assistant',
        contentPreview: reply,
        contentArtifactId: finalArtifactId,
        format: 'text',
        generationSource: 'runtime_template',
      },
      { artifactRefs: [finalArtifactId] },
      { type: 'system' },
    );
    const completion = {
      kind: 'partial' as const,
      reason: 'partial_budget_exhausted',
      source: 'runtime_template' as const,
      partialResult: {
        version: '1' as const,
        trigger: 'closing_output_empty' as const,
        loopId: context.executionId,
        grantId: grant.grantId,
        completedOperations: [
          {
            operationId: toolOperationId,
            toolCallId,
            name: 'folder_read',
            summary: 'Document read',
          },
        ],
        pending: ['final_synthesis'] as ['final_synthesis'],
      },
    };

    await expect(
      service.validateDeterministicPartial(
        context.executionId,
        reply,
        null,
        completion,
      ),
    ).resolves.toBeUndefined();
    await service.completeExecution(
      context.executionId,
      reply,
      null,
      completion,
    );
    const completed = await service.findOne(context.executionId);
    expect(completed).toMatchObject({
      status: 'completed',
      completionKind: 'partial',
      completionReason: 'partial_budget_exhausted',
      error: null,
      result: { reply },
    });
    const eventsBeforeReplay = await dataSource
      .getRepository(ExecutionEventEntity)
      .countBy({ rootExecutionId: context.rootExecutionId });
    await service.completeExecution(
      context.executionId,
      reply,
      null,
      completion,
    );
    const eventsAfterReplay = await dataSource
      .getRepository(ExecutionEventEntity)
      .countBy({ rootExecutionId: context.rootExecutionId });
    expect(eventsAfterReplay).toBe(eventsBeforeReplay);
    const terminal = await dataSource
      .getRepository(ExecutionEventEntity)
      .findOneByOrFail({
        rootExecutionId: context.rootExecutionId,
        eventType: 'execution.state_changed',
        sequence: String(eventsBeforeReplay),
      });
    expect(terminal.envelope.payload).toMatchObject({
      to: 'completed',
      completionKind: 'partial',
      completionReason: 'partial_budget_exhausted',
      completionSource: 'runtime_template',
      partialResult: completion.partialResult,
      result: { reply },
      error: null,
    });
  });
});
