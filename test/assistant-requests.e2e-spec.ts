import { ExecutionStatus } from '../src/execution/execution-status.enum';
import { randomUUID } from 'crypto';
import { createExecutionFixture } from './execution/fixture';
import { ExecutionEntity } from '../src/execution/execution.entity';
import { ExecutionStepEntity } from '../src/execution/execution-step.entity';
import { ExecutionStepKind } from '../src/execution/execution-step-kind.enum';
import { ExecutionRequestEntity } from '../src/execution/execution-request.entity';
import { ConversationTurnEntity } from '../src/conversation/conversation-turn.entity';
import { AssistantMessageEntity } from '../src/assistant/assistant-message.entity';

describe('Recoverable assistant acceptance', () => {
  const fixture = createExecutionFixture();
  const scope = { ownerPrincipal: 'request-owner' };
  const send = (requestId: string, message = 'Read the paired page') =>
    fixture().service.createForChat(
      'assistant_chat',
      message,
      scope,
      { ownerId: 1, folderScope: null },
      requestId,
    );
  const counts = async () =>
    Promise.all(
      [
        ExecutionEntity,
        ExecutionStepEntity,
        ConversationTurnEntity,
        AssistantMessageEntity,
        ExecutionRequestEntity,
      ].map((entity) => fixture().dataSource.getRepository(entity).count()),
    );
  it('recovers lost acceptance and concurrent retries without duplicate work', async () => {
    const id = randomUUID();
    const [first, ...retries] = await Promise.all([
      send(id),
      send(id),
      send(id),
    ]);
    for (const value of retries) {
      expect(value.execution.executionId).toBe(first.execution.executionId);
      expect(value.userMessage.id).toBe(first.userMessage.id);
    }
    expect(await counts()).toEqual([1, 1, 1, 1, 1]);
    const recovered = await fixture().service.readChatRequest(id, scope, 1);
    expect(recovered.execution.executionId).toBe(first.execution.executionId);
    expect(recovered.userMessage.id).toBe(first.userMessage.id);
    await fixture().agentLoopService.prepareReadyInferences();
    const input = {
      workerId: randomUUID(),
      stepKinds: [ExecutionStepKind.INFERENCE],
      capabilities: ['assistant-chat'],
      leaseDurationMs: 30000,
    };
    const assigned = await fixture().attemptService.claimReadyStep(input);
    expect(assigned?.executionId).toBe(first.execution.executionId);
    await send(id);
    expect(await fixture().attemptService.claimReadyStep(input)).toBeNull();
    expect(await counts()).toEqual([1, 1, 1, 1, 1]);
  });
  it('rejects changed input and another assistant without creating work', async () => {
    const id = randomUUID();
    await send(id);
    const before = await counts();
    await expect(send(id, 'Different content')).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      fixture().service.createForChat(
        'assistant_chat',
        'Read the paired page',
        scope,
        { ownerId: 99, folderScope: null },
        id,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      fixture().service.readChatRequest(id, scope, 99),
    ).rejects.toMatchObject({ status: 404 });
    expect(await counts()).toEqual(before);
  });
  it('does not expose another principal acceptance or create receipts on lookup', async () => {
    const id = randomUUID();
    await send(id);
    const before = await counts();
    await expect(
      fixture().service.readChatRequest(id, { ownerPrincipal: 'other' }, 1),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      fixture().service.readChatRequest(randomUUID(), scope, 1),
    ).rejects.toMatchObject({ status: 404 });
    expect(await counts()).toEqual(before);
  });
  it('rolls back the receipt if preparation fails', async () => {
    const id = randomUUID();
    await expect(
      fixture().service.createForChat(
        'assistant_chat',
        'Text',
        scope,
        { ownerId: 999, folderScope: null },
        id,
      ),
    ).rejects.toThrow();
    expect(await counts()).toEqual([0, 0, 0, 0, 0]);
  });
  it('never replaces a missing accepted execution with new work', async () => {
    const id = randomUUID();
    await send(id);
    const before = await counts();
    await fixture()
      .dataSource.getRepository(ExecutionRequestEntity)
      .update(
        { ownerPrincipal: scope.ownerPrincipal, requestId: id },
        { executionId: randomUUID() },
      );
    await expect(send(id)).rejects.toMatchObject({ status: 404 });
    expect(await counts()).toEqual(before);
  });
  it('preserves existing messages without a request identity', async () => {
    const service = fixture().service;
    const a = await service.createForChat('assistant_chat', 'Text', scope, {
      ownerId: 1,
      folderScope: null,
    });
    const b = await service.createForChat('assistant_chat', 'Text', scope, {
      ownerId: 1,
      folderScope: null,
    });
    expect(a.execution.executionId).not.toBe(b.execution.executionId);
    expect(
      await fixture().dataSource.getRepository(ExecutionRequestEntity).count(),
    ).toBe(0);
  });
  it('recovers queued and terminal turns without allocating another step', async () => {
    await fixture().service.createForChat('assistant_chat', 'First', scope, {
      ownerId: 1,
      folderScope: null,
    });
    const id = randomUUID();
    const queued = await send(id);
    const before = await counts();
    expect((await send(id)).execution.executionId).toBe(
      queued.execution.executionId,
    );
    expect(await counts()).toEqual(before);
    await fixture()
      .dataSource.getRepository(ExecutionEntity)
      .update(queued.execution.executionId, {
        status: ExecutionStatus.CANCELLED,
      });
    expect((await send(id)).execution.status).toBe('cancelled');
    expect(await counts()).toEqual(before);
  });
  it('honors an existing cancellation tombstone before accepting a turn', async () => {
    const id = randomUUID();
    await fixture().service.cancelRequest(id, scope);
    await expect(send(id)).rejects.toMatchObject({ status: 409 });
    expect(await counts()).toEqual([0, 0, 0, 0, 1]);
  });
  it('rejects an inconsistent receipt whose execution has no conversation turn', async () => {
    const id = randomUUID();
    const first = await send(id);
    await fixture()
      .dataSource.getRepository(ExecutionEntity)
      .update(first.execution.executionId, { sessionId: null, turnId: null });
    await expect(
      fixture().service.readChatRequest(id, scope, 1),
    ).rejects.toMatchObject({ status: 404 });
    await expect(send(id)).rejects.toMatchObject({ status: 404 });
    expect(await counts()).toEqual([1, 1, 1, 1, 1]);
  });
});
