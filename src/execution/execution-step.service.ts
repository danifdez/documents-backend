import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ExecutionEntity } from './execution.entity';
import { ExecutionEventEntity } from './execution-event.entity';
import { ExecutionOperationEntity } from './execution-operation.entity';
import { ExecutionOperationKind } from './execution-operation-kind.enum';
import { ExecutionOperationRecoveryClass } from './execution-operation-recovery-class.enum';
import { ExecutionOperationStatus } from './execution-operation-status.enum';
import { ExecutionStepDependencyEntity } from './execution-step-dependency.entity';
import { ExecutionStepEntity } from './execution-step.entity';
import { ExecutionStepKind } from './execution-step-kind.enum';
import { ExecutionStepStatus } from './execution-step-status.enum';
import { CreateExecutionStepInput } from './execution-control-plane.types';
import { executionStepOutputValue } from './execution-step-result';
import {
  ACTIVE_CONTEXT_ARTIFACT_ROLE,
  freezeActiveContextArtifact,
} from '../conversation/conversation-context';
import {
  ACTIVE_INPUT_REDUCTION_SCHEMA,
  CONTEXT_CHUNK_PLAN_SCHEMA,
  CONTEXT_INPUT_FINAL_COORDINATION,
  ContextChunkPlan,
} from '../conversation/context-input-workflow';
import { ExecutionArtifactEntity } from './execution-artifact.entity';
import { contentHash } from './execution-canonical';
import type { ChatExecutionPayload } from './execution-task-payload.types';
import { ExecutionArtifactStorageService } from './execution-artifact-storage.service';

export async function createExecutionStep(
  manager: EntityManager,
  input: CreateExecutionStepInput,
): Promise<ExecutionStepEntity> {
  const stepId = input.stepId ?? randomUUID();
  const dependencyIds = [...new Set(input.dependsOnStepIds ?? [])];
  if (dependencyIds.includes(stepId)) {
    throw new BadRequestException('step_dependency_cycle');
  }
  const availableAt = input.availableAt ?? new Date();
  if (input.deadline && input.deadline <= availableAt) {
    throw new BadRequestException('invalid_step_deadline');
  }

  const execution = await manager.getRepository(ExecutionEntity).findOne({
    where: { executionId: input.executionId },
    lock: { mode: 'pessimistic_write' },
  });
  if (!execution) throw new NotFoundException('execution_not_found');
  if (execution.cancellationRequestedAt) {
    throw new ConflictException('execution_cancellation_requested');
  }
  const causedByEventId = input.causedByEventId ?? execution.lastEventId;
  if (!causedByEventId) {
    throw new BadRequestException('operation_cause_required');
  }
  const cause = await manager.getRepository(ExecutionEventEntity).findOneBy({
    eventId: causedByEventId,
    rootExecutionId: execution.rootExecutionId,
  });
  if (!cause) throw new BadRequestException('invalid_operation_cause');

  const dependencies = dependencyIds.length
    ? await manager.getRepository(ExecutionStepEntity).find({
        where: { stepId: In(dependencyIds) },
      })
    : [];
  const dependencyExecutionIds = [
    ...new Set(dependencies.map((dependency) => dependency.executionId)),
  ];
  const dependencyExecutions = dependencyExecutionIds.length
    ? await manager.getRepository(ExecutionEntity).find({
        where: { executionId: In(dependencyExecutionIds) },
      })
    : [];
  if (
    dependencies.length !== dependencyIds.length ||
    dependencyExecutions.length !== dependencyExecutionIds.length ||
    dependencyExecutions.some(
      (dependencyExecution) =>
        dependencyExecution.rootExecutionId !== execution.rootExecutionId,
    )
  ) {
    throw new BadRequestException('invalid_step_dependency');
  }

  const status = dependencies.every(
    (dependency) => dependency.status === ExecutionStepStatus.COMPLETED,
  )
    ? ExecutionStepStatus.READY
    : ExecutionStepStatus.BLOCKED;
  const stepRepo = manager.getRepository(ExecutionStepEntity);
  const operationId = input.operationId ?? randomUUID();
  const step = stepRepo.create({
    stepId,
    executionId: input.executionId,
    schemaVersion: 'step/1',
    stepKind: input.stepKind,
    status,
    version: 1,
    inputArtifactRefs: input.inputArtifactRefs ?? [],
    work: input.work,
    finalizeOnFailure: input.finalizeOnFailure ?? false,
    requiredCapabilities: [...new Set(input.requiredCapabilities ?? [])],
    resourceKeys: [...new Set(input.resourceKeys ?? [])],
    budgetReservationId: input.budgetReservationId ?? null,
    priority: input.priority ?? 0,
    availableAt,
    deadline: input.deadline ?? null,
    operationId,
    currentAttemptId: null,
    result: null,
    error: null,
    continuationProcessedAt: null,
    continuationStepId: null,
  });
  await stepRepo.save(step);
  const operationRepo = manager.getRepository(ExecutionOperationEntity);
  await operationRepo.save(
    operationRepo.create({
      operationId,
      executionId: input.executionId,
      stepId,
      schemaVersion: 'operation/1',
      operationKind:
        input.operationKind ?? defaultOperationKind(input.stepKind),
      status:
        status === ExecutionStepStatus.READY
          ? ExecutionOperationStatus.PREPARED
          : ExecutionOperationStatus.PLANNED,
      recoveryClass:
        input.recoveryClass ?? defaultRecoveryClass(input.stepKind),
      currentAttemptId: null,
      causedByEventId,
      result: null,
      error: null,
      startedAt: new Date(),
      finishedAt: null,
    }),
  );

  if (dependencyIds.length) {
    const dependencyRepo = manager.getRepository(ExecutionStepDependencyEntity);
    await dependencyRepo.save(
      dependencyIds.map((dependsOnStepId) =>
        dependencyRepo.create({ stepId, dependsOnStepId }),
      ),
    );
  }
  return step;
}

export async function releaseExecutionStepDependents(
  manager: EntityManager,
  completedStepId: string,
  artifactStorage: ExecutionArtifactStorageService,
): Promise<number> {
  const rows = await manager.query(
    `
      SELECT candidate."step_id"
      FROM "execution_steps" candidate
      WHERE candidate."status" = 'blocked'
        AND EXISTS (
          SELECT 1
          FROM "execution_step_dependencies" direct_dependency
          WHERE direct_dependency."step_id" = candidate."step_id"
            AND direct_dependency."depends_on_step_id" = $1
        )
        AND (
          candidate."work" ->> 'taskType' <> 'agents.delegate'
          OR EXISTS (
            SELECT 1
            FROM "executions" delegated_child
            WHERE delegated_child."execution_id"::text =
                candidate."work" ->> 'childExecutionId'
              AND delegated_child."status" IN ('completed', 'failed', 'cancelled')
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM "execution_step_dependencies" unresolved_dependency
          INNER JOIN "execution_steps" required_step
            ON required_step."step_id" = unresolved_dependency."depends_on_step_id"
          WHERE unresolved_dependency."step_id" = candidate."step_id"
            AND required_step."status" <> 'completed'
        )
      ORDER BY candidate."created_at", candidate."step_id"
      FOR UPDATE OF candidate
    `,
    [completedStepId],
  );
  const stepRepo = manager.getRepository(ExecutionStepEntity);
  const operationRepo = manager.getRepository(ExecutionOperationEntity);
  for (const row of rows) {
    const candidate = await stepRepo.findOneBy({ stepId: row.step_id });
    if (!candidate) continue;
    await materializeCoordinatedInput(
      manager,
      stepRepo,
      candidate,
      artifactStorage,
    );
    candidate.status = ExecutionStepStatus.READY;
    candidate.version += 1;
    await stepRepo.save(candidate);
    const operation = await operationRepo.findOneBy({
      operationId: candidate.operationId,
    });
    if (!operation) throw new ConflictException('operation_not_found');
    operation.status = ExecutionOperationStatus.PREPARED;
    await operationRepo.save(operation);
  }
  return rows.length;
}

function defaultRecoveryClass(
  stepKind: ExecutionStepKind,
): ExecutionOperationRecoveryClass {
  return [
    ExecutionStepKind.INFERENCE,
    ExecutionStepKind.SERVICE,
    ExecutionStepKind.VERIFICATION,
  ].includes(stepKind)
    ? ExecutionOperationRecoveryClass.READ_ONLY_REPLAYABLE
    : ExecutionOperationRecoveryClass.NON_RESUMABLE;
}

function defaultOperationKind(
  stepKind: ExecutionStepKind,
): ExecutionOperationKind {
  const byStepKind: Record<ExecutionStepKind, ExecutionOperationKind> = {
    [ExecutionStepKind.INFERENCE]: ExecutionOperationKind.INFERENCE,
    [ExecutionStepKind.TOOL]: ExecutionOperationKind.TOOL_CALL,
    [ExecutionStepKind.SERVICE]: ExecutionOperationKind.ARTIFACT_PROCESSING,
    [ExecutionStepKind.CODE]: ExecutionOperationKind.TOOL_CALL,
    [ExecutionStepKind.VERIFICATION]: ExecutionOperationKind.VERIFICATION,
  };
  return byStepKind[stepKind];
}

async function materializeCoordinatedInput(
  manager: EntityManager,
  stepRepo: Repository<ExecutionStepEntity>,
  candidate: ExecutionStepEntity,
  artifactStorage: ExecutionArtifactStorageService,
): Promise<void> {
  const work = (candidate.work ?? {}) as Record<string, unknown>;
  const coordination = work.coordination as Record<string, unknown> | undefined;
  if (coordination?.kind === CONTEXT_INPUT_FINAL_COORDINATION) {
    await materializeContextInput(
      manager,
      stepRepo,
      candidate,
      coordination,
      artifactStorage,
    );
    return;
  }
  if (coordination?.kind !== 'map-reduce-reduce/1') return;

  const mapStepIds = coordination.mapStepIds;
  const resultKey = coordination.resultKey;
  if (
    !Array.isArray(mapStepIds) ||
    !mapStepIds.length ||
    mapStepIds.some((stepId) => typeof stepId !== 'string') ||
    typeof resultKey !== 'string'
  ) {
    throw new ConflictException('invalid_map_reduce_coordination');
  }

  const mapSteps = await stepRepo.find({
    where: { stepId: In(mapStepIds) },
  });
  const byId = new Map(mapSteps.map((step) => [step.stepId, step]));
  const partials = mapStepIds.map((stepId) => {
    const step = byId.get(stepId);
    const value = executionStepOutputValue(step?.result);
    if (
      step?.status !== ExecutionStepStatus.COMPLETED ||
      !value ||
      typeof value !== 'object' ||
      !Object.prototype.hasOwnProperty.call(value, resultKey)
    ) {
      throw new ConflictException('invalid_map_reduce_dependency_result');
    }
    return (value as Record<string, unknown>)[resultKey];
  });
  const payload =
    work.payload && typeof work.payload === 'object'
      ? (work.payload as Record<string, unknown>)
      : {};
  candidate.work = {
    ...work,
    payload: { ...payload, partials },
  };
}

async function materializeContextInput(
  manager: EntityManager,
  stepRepo: Repository<ExecutionStepEntity>,
  candidate: ExecutionStepEntity,
  coordination: Record<string, unknown>,
  artifactStorage: ExecutionArtifactStorageService,
): Promise<void> {
  const reductionStepId = coordination.reductionStepId;
  const resultKey = coordination.resultKey;
  const planArtifactId = coordination.planArtifactId;
  const sourceArtifactId = coordination.sourceArtifactId;
  if (
    typeof reductionStepId !== 'string' ||
    typeof resultKey !== 'string' ||
    typeof planArtifactId !== 'string' ||
    typeof sourceArtifactId !== 'string'
  ) {
    throw new ConflictException('invalid_context_input_coordination');
  }
  const reductionStep = await stepRepo.findOneBy({ stepId: reductionStepId });
  const output = executionStepOutputValue(reductionStep?.result);
  const digest =
    output && typeof output === 'object'
      ? (output as Record<string, unknown>)[resultKey]
      : null;
  if (
    reductionStep?.status !== ExecutionStepStatus.COMPLETED ||
    typeof digest !== 'string' ||
    !digest.trim() ||
    digest.length > 16_000
  ) {
    throw new ConflictException('invalid_context_input_reduction');
  }

  const execution = await manager.getRepository(ExecutionEntity).findOneBy({
    executionId: candidate.executionId,
  });
  if (!execution) throw new ConflictException('execution_not_found');
  const artifactRepo = manager.getRepository(ExecutionArtifactEntity);
  const planArtifact = await artifactRepo
    .createQueryBuilder('artifact')
    .addSelect('artifact.body')
    .where('artifact.artifactId = :artifactId', { artifactId: planArtifactId })
    .andWhere('artifact.rootExecutionId = :rootExecutionId', {
      rootExecutionId: execution.rootExecutionId,
    })
    .getOne();
  if (!planArtifact) {
    throw new ConflictException('context_chunk_plan_not_found');
  }
  const planBody = await artifactStorage.readBody(planArtifact);
  if (!planBody) throw new ConflictException('context_chunk_plan_not_found');
  let plan: ContextChunkPlan;
  try {
    plan = JSON.parse(planBody.toString('utf8')) as ContextChunkPlan;
  } catch {
    throw new ConflictException('invalid_context_chunk_plan');
  }
  const sourceArtifact = await artifactRepo
    .createQueryBuilder('artifact')
    .addSelect('artifact.body')
    .where('artifact.artifactId = :artifactId', {
      artifactId: sourceArtifactId,
    })
    .andWhere('artifact.rootExecutionId = :rootExecutionId', {
      rootExecutionId: execution.rootExecutionId,
    })
    .getOne();
  const sourceBody = sourceArtifact
    ? await artifactStorage.readBody(sourceArtifact)
    : null;
  const sourceText = sourceBody?.toString('utf8');
  if (
    plan.schemaVersion !== CONTEXT_CHUNK_PLAN_SCHEMA ||
    plan.sourceArtifact?.artifactId !== sourceArtifactId ||
    plan.sourceArtifact?.contentHash !== sourceArtifact?.contentHash ||
    plan.sourceArtifact?.size !== Number(sourceArtifact?.size) ||
    !sourceBody ||
    contentHash(sourceBody) !== sourceArtifact.contentHash ||
    typeof sourceText !== 'string' ||
    plan.algorithm !== 'deterministic-text-boundaries/1' ||
    plan.offsetUnit !== 'utf16-code-unit' ||
    plan.maxChunkChars !== 12_000 ||
    plan.reductionFanIn !== 8 ||
    !Array.isArray(plan.chunks) ||
    plan.chunks.length < 2 ||
    plan.chunks.length > 21 ||
    plan.chunks.some(
      (chunk, index) =>
        chunk.index !== index ||
        chunk.start !== (index === 0 ? 0 : plan.chunks[index - 1].end) ||
        !Number.isInteger(chunk.end) ||
        chunk.end <= chunk.start ||
        chunk.end - chunk.start > 12_000 ||
        contentHash(
          Buffer.from(sourceText.slice(chunk.start, chunk.end), 'utf8'),
        ) !== chunk.contentHash,
    ) ||
    plan.chunks.at(-1)?.end !== sourceText.length
  ) {
    throw new ConflictException('invalid_context_chunk_plan');
  }

  const finish = await manager.getRepository(ExecutionEventEntity).findOne({
    where: {
      rootExecutionId: execution.rootExecutionId,
      operationId: reductionStep.operationId,
      eventType: 'operation.finished',
    },
    order: { sequence: 'DESC' },
  });
  if (!finish) throw new ConflictException('context_reduction_finish_missing');

  const work = (candidate.work ?? {}) as Record<string, unknown>;
  if (work.taskType !== 'assistant-chat' && work.taskType !== 'agent-chat') {
    throw new ConflictException('invalid_context_reduction_task');
  }
  const payload =
    work.payload && typeof work.payload === 'object'
      ? (work.payload as ChatExecutionPayload)
      : {};
  const effectivePayload: ChatExecutionPayload = {
    ...payload,
    activeInputReduction: {
      schemaVersion: ACTIVE_INPUT_REDUCTION_SCHEMA,
      sourceArtifact: plan.sourceArtifact,
      planArtifact: {
        artifactId: planArtifact.artifactId,
        contentHash: planArtifact.contentHash,
      },
      strategy: 'chunk-map-reduce/1',
      chunkCount: plan.chunks.length,
      digest: digest.trim(),
    },
  };
  const contextArtifact = await freezeActiveContextArtifact(
    manager,
    artifactStorage,
    {
      rootExecutionId: execution.rootExecutionId,
      sessionId: execution.sessionId,
      turnId: execution.turnId,
      causedByEventId: finish.eventId,
      effectivePayload,
      derivedFromArtifactIds: [sourceArtifactId, planArtifactId],
    },
  );
  candidate.inputArtifactRefs = [
    ...candidate.inputArtifactRefs.filter(
      (ref) => ref.role !== ACTIVE_CONTEXT_ARTIFACT_ROLE,
    ),
    {
      role: ACTIVE_CONTEXT_ARTIFACT_ROLE,
      artifactId: contextArtifact.artifactId,
    },
  ];
  candidate.work = { ...work, payload: effectivePayload };
}

@Injectable()
export class ExecutionStepService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly artifactStorage: ExecutionArtifactStorageService,
  ) {}

  async createStep(
    input: CreateExecutionStepInput,
  ): Promise<ExecutionStepEntity> {
    return this.dataSource.transaction((manager) =>
      createExecutionStep(manager, input),
    );
  }

  async addDependency(stepId: string, dependsOnStepId: string): Promise<void> {
    if (stepId === dependsOnStepId) {
      throw new BadRequestException('step_dependency_cycle');
    }

    await this.dataSource.transaction(async (manager) => {
      const stepRepo = manager.getRepository(ExecutionStepEntity);
      const steps = await stepRepo.find({
        where: { stepId: In([stepId, dependsOnStepId]) },
        lock: { mode: 'pessimistic_write' },
      });
      const step = steps.find((item) => item.stepId === stepId);
      const dependency = steps.find((item) => item.stepId === dependsOnStepId);
      if (!step || !dependency) throw new NotFoundException('step_not_found');
      if (step.executionId !== dependency.executionId) {
        throw new BadRequestException('invalid_step_dependency');
      }
      if (
        [
          ExecutionStepStatus.RUNNING,
          ExecutionStepStatus.RESULT_RECEIVED,
          ExecutionStepStatus.COMPLETED,
          ExecutionStepStatus.FAILED,
          ExecutionStepStatus.CANCELLED,
        ].includes(step.status)
      ) {
        throw new ConflictException('step_dependencies_frozen');
      }

      const cycle = await manager.query(
        `
          WITH RECURSIVE dependency_tree("depends_on_step_id") AS (
            SELECT "depends_on_step_id"
            FROM "execution_step_dependencies"
            WHERE "step_id" = $1
            UNION
            SELECT dependency."depends_on_step_id"
            FROM "execution_step_dependencies" dependency
            INNER JOIN dependency_tree tree
              ON dependency."step_id" = tree."depends_on_step_id"
          )
          SELECT 1
          FROM dependency_tree
          WHERE "depends_on_step_id" = $2
          LIMIT 1
        `,
        [dependsOnStepId, stepId],
      );
      if (cycle.length) throw new BadRequestException('step_dependency_cycle');

      const dependencyRepo = manager.getRepository(
        ExecutionStepDependencyEntity,
      );
      const existing = await dependencyRepo.findOneBy({
        stepId,
        dependsOnStepId,
      });
      if (!existing) {
        await dependencyRepo.save(
          dependencyRepo.create({ stepId, dependsOnStepId }),
        );
      }
      if (
        step.status === ExecutionStepStatus.READY &&
        dependency.status !== ExecutionStepStatus.COMPLETED
      ) {
        step.status = ExecutionStepStatus.BLOCKED;
        step.version += 1;
        await stepRepo.save(step);
      }
    });
  }

  async releaseDependents(completedStepId: string): Promise<number> {
    return this.dataSource.transaction((manager) =>
      releaseExecutionStepDependents(
        manager,
        completedStepId,
        this.artifactStorage,
      ),
    );
  }
}
