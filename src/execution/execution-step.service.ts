import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { ExecutionEntity } from './execution.entity';
import { ExecutionStepDependencyEntity } from './execution-step-dependency.entity';
import { ExecutionStepEntity } from './execution-step.entity';
import { ExecutionStepStatus } from './execution-step-status.enum';
import { CreateExecutionStepInput } from './execution-control-plane.types';

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

  const dependencies = dependencyIds.length
    ? await manager.getRepository(ExecutionStepEntity).find({
        where: { stepId: In(dependencyIds) },
      })
    : [];
  if (
    dependencies.length !== dependencyIds.length ||
    dependencies.some(
      (dependency) => dependency.executionId !== input.executionId,
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
  const step = stepRepo.create({
    stepId,
    executionId: input.executionId,
    schemaVersion: 'step/1',
    stepKind: input.stepKind,
    status,
    version: 1,
    inputArtifactRefs: input.inputArtifactRefs ?? [],
    work: input.work,
    requiredCapabilities: [...new Set(input.requiredCapabilities ?? [])],
    resourceKeys: [...new Set(input.resourceKeys ?? [])],
    budgetReservationId: input.budgetReservationId ?? null,
    priority: input.priority ?? 0,
    availableAt,
    deadline: input.deadline ?? null,
    operationId: input.operationId ?? randomUUID(),
    currentAttemptId: null,
    result: null,
    error: null,
  });
  await stepRepo.save(step);

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

@Injectable()
export class ExecutionStepService {
  constructor(private readonly dataSource: DataSource) {}

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
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query(
        `
          UPDATE "execution_steps" candidate
          SET "status" = 'ready',
              "version" = candidate."version" + 1,
              "updated_at" = now()
          WHERE candidate."status" = 'blocked'
            AND EXISTS (
              SELECT 1
              FROM "execution_step_dependencies" direct_dependency
              WHERE direct_dependency."step_id" = candidate."step_id"
                AND direct_dependency."depends_on_step_id" = $1
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "execution_step_dependencies" unresolved_dependency
              INNER JOIN "execution_steps" required_step
                ON required_step."step_id" = unresolved_dependency."depends_on_step_id"
              WHERE unresolved_dependency."step_id" = candidate."step_id"
                AND required_step."status" <> 'completed'
            )
          RETURNING candidate."step_id"
        `,
        [completedStepId],
      );
      return rows.length;
    });
  }
}
