import { ExecutionRequestEntity } from '../../src/execution/execution-request.entity';
import { CreateExecutionRequests1794800000000 } from '../../migrations/1794800000000-CreateExecutionRequests';
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource, QueryRunner } from 'typeorm';
import { CreateProjects1757668140000 } from '../../migrations/1757668140000-CreateProjects';
import { CreateExecutions1757668140001 } from '../../migrations/1757668140001-CreateExecutions';
import { CreateWorkers1757668140002 } from '../../migrations/1757668140002-CreateWorkers';
import { CreatePermissionGroups1757668140003 } from '../../migrations/1757668140003-CreatePermissionGroups';
import { CreateUsers1757668140005 } from '../../migrations/1757668140005-CreateUsers';
import { CreateThreads1757668140010 } from '../../migrations/1757668140010-CreateThreads';
import { CreateResources1757668140011 } from '../../migrations/1757668140011-CreateResources';
import { CreateDocs1757668140012 } from '../../migrations/1757668140012-CreateDocs';
import { CreateResourceDates1757668140030 } from '../../migrations/1757668140030-CreateResourceDates';
import { CreateAssistantTables1757668140070 } from '../../migrations/1757668140070-CreateAssistantTables';
import { CreateIndexedFiles1757668140100 } from '../../migrations/1757668140100-CreateIndexedFiles';
import { CreateAgents1757668140110 } from '../../migrations/1757668140110-CreateAgents';
import { AddOwnershipToAssistantsAndAgents1789800000000 } from '../../migrations/1789800000000-AddOwnershipToAssistantsAndAgents';
import { CreateAgentMessages1757668140111 } from '../../migrations/1757668140111-CreateAgentMessages';
import { CreateUserTasks1757668140200 } from '../../migrations/1757668140200-CreateUserTasks';
import { CreateVectorTables1757668140320 } from '../../migrations/1757668140320-CreateVectorTables';
import { CreateExecutionControlPlane1757668140370 } from '../../migrations/1757668140370-CreateExecutionControlPlane';
import { CreateExecutionOutbox1757668140400 } from '../../migrations/1757668140400-CreateExecutionOutbox';
import { CreateExecutionOperations1757668140410 } from '../../migrations/1757668140410-CreateExecutionOperations';
import { CreateExecutionToolPlans1757668140420 } from '../../migrations/1757668140420-CreateExecutionToolPlans';
import { CreateExecutionConfirmations1757668140720 } from '../../migrations/1757668140720-CreateExecutionConfirmations';
import { CreateConversationSessions1757668140730 } from '../../migrations/1757668140730-CreateConversationSessions';
import { CreateMemoryEntries1757668140740 } from '../../migrations/1757668140740-CreateMemoryEntries';
import { CreateSkillActivations1757668140750 } from '../../migrations/1757668140750-CreateSkillActivations';
import { CreateExecutionEffectJournal1757668140760 } from '../../migrations/1757668140760-CreateExecutionEffectJournal';
import { AddExecutionTraceContext1794650000000 } from '../../migrations/1794650000000-AddExecutionTraceContext';
import { StoreExecutionPublicationRouting1794800000001 } from '../../migrations/1794800000001-StoreExecutionPublicationRouting';
import { ExecutionArtifactEntity } from '../../src/execution/execution-artifact.entity';
import { ExecutionContractValidator } from '../../src/execution/execution-contract-validator';
import { ExecutionCompletionValidator } from '../../src/execution/execution-completion-validator';
import { ExecutionEventEntity } from '../../src/execution/execution-event.entity';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { ExecutionResultReceiptEntity } from '../../src/execution/execution-result-receipt.entity';
import { ExecutionAttemptService } from '../../src/execution/execution-attempt.service';
import { ExecutionStepAttemptEntity } from '../../src/execution/execution-step-attempt.entity';
import { ExecutionStepAttemptStatus } from '../../src/execution/execution-step-attempt-status.enum';
import { ExecutionStepDependencyEntity } from '../../src/execution/execution-step-dependency.entity';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionStepStatus } from '../../src/execution/execution-step-status.enum';
import { ExecutionStatus } from '../../src/execution/execution-status.enum';
import { ExecutionService } from '../../src/execution/execution.service';
import { ExecutionConversationService } from '../../src/execution/execution-conversation.service';
import { WorkerEntity } from '../../src/worker/worker.entity';
import { WorkerService } from '../../src/worker/worker.service';
import { WorkerCredentialEventEntity } from '../../src/worker/worker-credential-event.entity';
import { ExecutionOutboxEntity } from '../../src/execution-outbox/execution-outbox.entity';
import { ExecutionOperationEntity } from '../../src/execution/execution-operation.entity';
import { ExecutionToolInvocationEntity } from '../../src/execution/execution-tool-invocation.entity';
import { ExecutionToolPlanEntity } from '../../src/execution/execution-tool-plan.entity';
import { ExecutionToolPlanService } from '../../src/execution/execution-tool-plan.service';
import { ExecutionConfirmationEntity } from '../../src/execution/execution-confirmation.entity';
import { ExecutionConfirmationService } from '../../src/execution/execution-confirmation.service';
import { ExecutionEffectJournalEntity } from '../../src/execution/execution-effect-journal.entity';
import { ExecutionEffectJournalService } from '../../src/execution/execution-effect-journal.service';
import { ExecutionAgentLoopService } from '../../src/execution-coordinator/execution-agent-loop.service';
import { ExecutionTerminalCandidateService } from '../../src/execution-coordinator/execution-terminal-candidate.service';
import { ExecutionArtifactStorageService } from '../../src/execution/execution-artifact-storage.service';
import { ExecutionArtifactService } from '../../src/execution/execution-artifact.service';
import { ExecutionProgressService } from '../../src/execution/execution-progress.service';
import { ConversationSessionEntity } from '../../src/conversation/conversation-session.entity';
import { ConversationTurnEntity } from '../../src/conversation/conversation-turn.entity';
import { ConversationArtifactRevisionEntity } from '../../src/conversation/conversation-artifact-revision.entity';
import { AssistantMessageEntity } from '../../src/assistant/assistant-message.entity';
import { AgentMessageEntity } from '../../src/agent/agent-message.entity';
import { AssistantEntity } from '../../src/assistant/assistant.entity';
import { AgentEntity } from '../../src/agent/agent.entity';
import { MemoryEntryEntity } from '../../src/memory/memory-entry.entity';
import { SkillActivationEntity } from '../../src/conversation/skill-activation.entity';
import { ActiveCapabilitySet } from '../../src/conversation/active-capabilities';

loadEnv({ path: '.env' });

export const TEST_RUNTIME_FINGERPRINT = `sha256:${'a'.repeat(64)}`;
export const TEST_CODE_FINGERPRINT = `sha256:${'b'.repeat(64)}`;

export function createExecutionFixture(
  options: {
    entities?: Array<new () => object>;
    prepare?: (runner: QueryRunner) => Promise<void>;
  } = {},
) {
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
        ExecutionRequestEntity,
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
        WorkerCredentialEventEntity,
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
        ...(options.entities ?? []),
      ].filter((entity, index, all) => all.indexOf(entity) === index),
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
    await new CreateIndexedFiles1757668140100().up(runner);
    await new CreateAgents1757668140110().up(runner);
    await new AddOwnershipToAssistantsAndAgents1789800000000().up(runner);
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
    await new CreateMemoryEntries1757668140740().up(runner);
    await new CreateSkillActivations1757668140750().up(runner);
    await new CreateExecutionEffectJournal1757668140760().up(runner);
    await new AddExecutionTraceContext1794650000000().up(runner);
    await new CreateExecutionRequests1794800000000().up(runner);
    await new StoreExecutionPublicationRouting1794800000001().up(runner);
    await options.prepare?.(runner);
    await runner.query(`
      INSERT INTO "assistants" ("id", "name", "icon", "sub", "owner_principal")
      VALUES (1, 'Assistant', '◇', 'Personal assistant', 'standalone')
    `);
    await runner.query(`
      INSERT INTO "agents" ("id", "name", "pinned", "owner_principal")
      VALUES (1, 'Test agent', true, 'standalone')
    `);
    await runner.release();

    const config = {
      get: (key: string, fallback?: unknown) =>
        key === 'EXECUTION_ARTIFACT_STORAGE_DIR'
          ? artifactDirectory
          : key === 'EXECUTION_ARTIFACT_INLINE_MAX_BYTES'
            ? String(8 * 1024 * 1024)
            : fallback,
    } as any;
    const artifactStorage = new ExecutionArtifactStorageService(config);
    const artifactService = new ExecutionArtifactService(
      dataSource.getRepository(ExecutionStepEntity),
      dataSource.getRepository(ExecutionArtifactEntity),
      artifactStorage,
    );
    budgets = new ExecutionProgressService(dataSource, config);
    service = new ExecutionService(
      dataSource,
      dataSource.getRepository(ExecutionEntity),
      dataSource.getRepository(ExecutionEventEntity),
      dataSource.getRepository(ExecutionArtifactEntity),
      new ExecutionContractValidator(),
      budgets,
      artifactStorage,
      artifactService,
      new ExecutionCompletionValidator(),
      new ExecutionConversationService(dataSource, artifactStorage, {
        isEnabled: (flag: string) => flag === 'browser_federation',
      } as any),
    );
    attemptService = new ExecutionAttemptService(
      dataSource,
      new ExecutionContractValidator(),
      artifactStorage,
    );
    workerService = new WorkerService(
      dataSource.getRepository(WorkerEntity),
      dataSource.getRepository(ExecutionStepAttemptEntity),
      dataSource.getRepository(WorkerCredentialEventEntity),
      dataSource,
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
        "execution_requests",
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
  return () => ({
    schema,
    dataSource,
    service,
    budgets,
    attemptService,
    workerService,
    toolPlanService,
    confirmationService,
    agentLoopService,
    terminalCandidateService,
    effectJournalService,
    artifactDirectory,
    progress,
    activateStepAttempt,
    createChat,
    activeCapabilities,
  });
}

export type ExecutionFixture = ReturnType<typeof createExecutionFixture>;
