import { randomUUID } from 'crypto';
import { ExecutionArtifactEntity } from '../../src/execution/execution-artifact.entity';
import { ExecutionEventEntity } from '../../src/execution/execution-event.entity';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { contentHash } from '../../src/execution/execution.service';
import type { ExecutionFixture } from './fixture';

export function registerRetentionCases(getContext: ExecutionFixture): void {
  it('withdraws source content and every derived artifact after completion', async () => {
    const { dataSource, service, createChat } = getContext();

    const scope = { ownerPrincipal: 'retention-e2e-user' };
    const context = await createChat(
      'assistant_chat',
      'Retire this source and every derivative',
      scope,
    );
    const eventsBefore = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: context.rootExecutionId },
        order: { sequence: 'ASC' },
      });
    const sourceEvent = eventsBefore.find(
      (event) => event.eventType === 'source.observed',
    )!;
    const sourceId = String(
      (sourceEvent.envelope.payload as Record<string, unknown>).sourceId,
    );
    const sourceArtifact = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .findOneByOrFail({
        rootExecutionId: context.rootExecutionId,
        kind: 'user_message',
      });
    const derivedArtifactId = randomUUID();
    const derivedBody = Buffer.from('Derived content');
    await service.acceptArtifacts(context.rootExecutionId, [
      {
        artifactId: derivedArtifactId,
        kind: 'derived_context',
        contentHash: contentHash(derivedBody),
        size: derivedBody.length,
        mediaType: 'text/plain',
        dataClassification: 'workspace',
        retentionClass: 'operational',
        inputSourceIds: [],
        derivedFromArtifactIds: [sourceArtifact.artifactId],
        bodyBase64: derivedBody.toString('base64'),
      },
    ]);
    await service.completeExecution(context.executionId, 'Completed', null);

    const withdrawn = await service.withdrawSource(
      context.rootExecutionId,
      sourceId,
      scope,
      'User removed the source',
    );
    expect(withdrawn.artifactIds).toEqual(
      expect.arrayContaining([sourceArtifact.artifactId, derivedArtifactId]),
    );
    await expect(
      service.withdrawSource(
        context.rootExecutionId,
        sourceId,
        scope,
        'Repeated request',
      ),
    ).resolves.toEqual(withdrawn);

    const stored = await dataSource
      .getRepository(ExecutionArtifactEntity)
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifact_id IN (:...artifactIds)', {
        artifactIds: [sourceArtifact.artifactId, derivedArtifactId],
      })
      .orderBy('artifact.artifact_id', 'ASC')
      .getMany();
    expect(stored).toHaveLength(2);
    expect(stored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contentState: 'withdrawn',
          withdrawalReason: 'User removed the source',
          contentDeletedAt: expect.any(Date),
          body: null,
        }),
      ]),
    );
    expect(stored.every((artifact) => artifact.body === null)).toBe(true);
    expect(
      stored.every((artifact) =>
        artifact.storageRef.startsWith('withdrawn:v1:'),
      ),
    ).toBe(true);

    const lifecycleEvents = await dataSource
      .getRepository(ExecutionEventEntity)
      .find({
        where: { rootExecutionId: context.rootExecutionId },
        order: { sequence: 'ASC' },
      });
    const terminal = lifecycleEvents.find(
      (event) =>
        event.eventType === 'execution.state_changed' &&
        (event.envelope.payload as Record<string, unknown>).to === 'completed',
    )!;
    const sourceWithdrawal = lifecycleEvents.find(
      (event) => event.eventType === 'source.withdrawn',
    )!;
    expect(Number(sourceWithdrawal.sequence)).toBeGreaterThan(
      Number(terminal.sequence),
    );

    const bundle = await service.exportBundle(
      context.rootExecutionId,
      scope,
      true,
    );
    const manifests = bundle.artifacts as Record<string, any>[];
    for (const artifactId of [sourceArtifact.artifactId, derivedArtifactId]) {
      expect(manifests).toContainEqual(
        expect.objectContaining({
          artifactId,
          contentState: 'withdrawn',
          omissionReason: 'withdrawn',
        }),
      );
      expect(bundle.embeddedArtifacts).not.toHaveProperty(artifactId);
    }
    expect(bundle.bundleCompleteness).toEqual(
      expect.objectContaining({
        status: 'evaluable_partial',
        reproducible: false,
      }),
    );
  });

  it('expires artifact content and cancels work that can no longer consume it', async () => {
    const { dataSource, service, createChat } = getContext();

    const scope = { ownerPrincipal: 'expiry-e2e-user' };
    const context = await createChat(
      'assistant_chat',
      'This input expires before execution',
      scope,
    );
    const artifactRepo = dataSource.getRepository(ExecutionArtifactEntity);
    const artifact = await artifactRepo.findOneByOrFail({
      rootExecutionId: context.rootExecutionId,
      kind: 'user_message',
    });
    artifact.expiresAt = new Date('2000-01-01T00:00:00Z');
    await artifactRepo.save(artifact);

    await expect(service.purgeExpiredArtifacts()).resolves.toBeGreaterThan(0);

    const expired = await artifactRepo
      .createQueryBuilder('artifact')
      .addSelect('artifact.body')
      .where('artifact.artifact_id = :artifactId', {
        artifactId: artifact.artifactId,
      })
      .getOneOrFail();
    expect(expired).toMatchObject({
      contentState: 'expired',
      withdrawalReason: 'retention_expired',
      contentDeletedAt: expect.any(Date),
      body: null,
    });
    expect(expired.storageRef).toBe(`expired:v1:${artifact.artifactId}`);
    await expect(
      dataSource.getRepository(ExecutionEntity).findOneByOrFail({
        executionId: context.executionId,
      }),
    ).resolves.toMatchObject({
      cancellationRequestedAt: expect.any(Date),
      cancellationReason: 'Required evidence became unavailable',
    });
    await expect(
      dataSource.getRepository(ExecutionEventEntity).findOneByOrFail({
        rootExecutionId: context.rootExecutionId,
        eventType: 'artifact.expired',
      }),
    ).resolves.toMatchObject({
      envelope: expect.objectContaining({
        payload: expect.objectContaining({
          artifactIds: expect.arrayContaining([artifact.artifactId]),
        }),
      }),
    });
  });
}
