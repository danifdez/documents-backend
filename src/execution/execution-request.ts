import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { EXECUTION_UUID_PATTERN } from './execution.constants';
import { ExecutionRequestEntity } from './execution-request.entity';
import { ExecutionAccessScope } from './execution.types';

export async function lockExecutionRequest(
  manager: EntityManager,
  requestId: string,
  scope: ExecutionAccessScope,
): Promise<ExecutionRequestEntity> {
  if (!EXECUTION_UUID_PATTERN.test(requestId) || !scope.ownerPrincipal) {
    throw new BadRequestException('Invalid execution request identity');
  }
  const repo = manager.getRepository(ExecutionRequestEntity);
  await repo
    .createQueryBuilder()
    .insert()
    .values({
      ownerPrincipal: scope.ownerPrincipal,
      requestId,
      inputHash: null,
      executionId: null,
      cancelRequested: false,
    })
    .orIgnore()
    .execute();
  return repo.findOneOrFail({
    where: { ownerPrincipal: scope.ownerPrincipal, requestId },
    lock: { mode: 'pessimistic_write' },
  });
}
