import { EntityManager } from 'typeorm';
import { ExecutionArtifactEntity } from '../../../src/execution/execution-artifact.entity';
import {
  CONTEXT_CHUNK_PLAN_SCHEMA,
  CONTEXT_INPUT_FINAL_COORDINATION,
  buildContextInputWorkflow,
} from '../../../src/conversation/context-input-workflow';

describe('context input workflow', () => {
  const requestArtifact = {
    artifactId: '10000000-0000-4000-8000-000000000001',
    rootExecutionId: '10000000-0000-4000-8000-000000000002',
    contentHash: `sha256:${'a'.repeat(64)}`,
    size: '20000',
    dataClassification: 'personal',
    retentionClass: 'operational',
    expiresAt: new Date('2026-09-01T00:00:00Z'),
    inputSourceIds: ['10000000-0000-4000-8000-000000000003'],
  } as ExecutionArtifactEntity;
  const repository = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
  };
  const manager = {
    getRepository: jest.fn(() => repository),
  } as unknown as EntityManager;
  const artifactStorage = {
    save: jest.fn(async (_manager, input) =>
      repository.save(
        repository.create({ ...input, storageRef: 'postgres:v1:test' }),
      ),
    ),
  };

  beforeEach(() => jest.clearAllMocks());

  it('keeps a bounded current message on the direct chat path', async () => {
    await expect(
      buildContextInputWorkflow(manager, artifactStorage as any, {
        executionId: requestArtifact.rootExecutionId,
        taskType: 'assistant-chat',
        message: 'short request',
        requestArtifact,
        effectivePayload: { ownerId: 1 },
        causedByEventId: '10000000-0000-4000-8000-000000000004',
      }),
    ).resolves.toBeNull();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('creates an immutable chunk plan, reduction tree and blocked chat step', async () => {
    const message = `${'alpha '.repeat(2000)}\n${'omega '.repeat(1200)}`;
    const workflow = await buildContextInputWorkflow(
      manager,
      artifactStorage as any,
      {
        executionId: requestArtifact.rootExecutionId,
        taskType: 'agent-chat',
        message,
        requestArtifact,
        effectivePayload: { ownerId: 7 },
        causedByEventId: '10000000-0000-4000-8000-000000000004',
      },
    );

    expect(workflow).not.toBeNull();
    const plan = JSON.parse(workflow!.planArtifact.body!.toString('utf8'));
    expect(plan.schemaVersion).toBe(CONTEXT_CHUNK_PLAN_SCHEMA);
    expect(plan.chunks.length).toBeGreaterThan(1);
    expect(plan.chunks[0].start).toBe(0);
    expect(plan.chunks.at(-1).end).toBe(message.length);
    expect(workflow!.planArtifact).toMatchObject({
      dataClassification: 'personal',
      retentionClass: 'operational',
      expiresAt: new Date('2026-09-01T00:00:00Z'),
      inputSourceIds: requestArtifact.inputSourceIds,
      derivedFromArtifactIds: [requestArtifact.artifactId],
    });
    const mapSteps = workflow!.steps.filter(
      (step) => step.work.taskType === 'context-input-map',
    );
    expect(mapSteps).toHaveLength(plan.chunks.length);
    expect(
      mapSteps
        .map((step) => (step.work.payload as { content: string }).content)
        .join(''),
    ).toBe(message);
    const finalStep = workflow!.steps.at(-1)!;
    expect(finalStep.work.taskType).toBe('agent-chat');
    expect((finalStep.work.coordination as { kind: string }).kind).toBe(
      CONTEXT_INPUT_FINAL_COORDINATION,
    );
    expect(finalStep.dependsOnStepIds).toHaveLength(1);
  });

  it('rejects chat messages beyond the bounded durable plan', async () => {
    await expect(
      buildContextInputWorkflow(manager, artifactStorage as any, {
        executionId: requestArtifact.rootExecutionId,
        taskType: 'assistant-chat',
        message: 'x'.repeat(250_001),
        requestArtifact,
        effectivePayload: {},
        causedByEventId: '10000000-0000-4000-8000-000000000004',
      }),
    ).rejects.toThrow('chat_message_too_large');
  });

  it('builds bounded reduction levels for the largest supported plan', async () => {
    const workflow = await buildContextInputWorkflow(
      manager,
      artifactStorage as any,
      {
        executionId: requestArtifact.rootExecutionId,
        taskType: 'assistant-chat',
        message: 'source '.repeat(30_000),
        requestArtifact,
        effectivePayload: { ownerId: 1 },
        causedByEventId: '10000000-0000-4000-8000-000000000004',
      },
    );

    const reductions = workflow!.steps.filter(
      (step) => step.work.taskType === 'context-input-reduce',
    );
    expect(reductions.length).toBeGreaterThan(1);
    expect(
      reductions.every(
        (step) =>
          (step.dependsOnStepIds?.length ?? 0) >= 1 &&
          (step.dependsOnStepIds?.length ?? 0) <= 8,
      ),
    ).toBe(true);
    expect(workflow!.steps.at(-1)!.dependsOnStepIds).toHaveLength(1);
  });
});
