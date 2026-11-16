import { ExecutionArtifactEntity } from '../../src/execution/execution-artifact.entity';
import { ExecutionEventEntity } from '../../src/execution/execution-event.entity';
import { ExecutionEntity } from '../../src/execution/execution.entity';
import { ExecutionStepEntity } from '../../src/execution/execution-step.entity';
import { ExecutionStatus } from '../../src/execution/execution-status.enum';
import { canonicalHash } from '../../src/execution/execution.service';
import { ChatExecutionPayload } from '../../src/execution/execution-task-payload.types';
import { ConversationSessionEntity } from '../../src/conversation/conversation-session.entity';
import {
  ConversationTurnEntity,
  ConversationTurnStatus,
} from '../../src/conversation/conversation-turn.entity';
import { MemoryEntryEntity } from '../../src/memory/memory-entry.entity';
import { SkillActivationEntity } from '../../src/conversation/skill-activation.entity';
import type { ExecutionFixture } from './fixture';

export function registerConversationsCases(getContext: ExecutionFixture): void {
  it('keeps assistant and agent chat as distinct execution types', async () => {
    const { createChat } = getContext();

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
    const { dataSource, service, createChat } = getContext();

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
    const { dataSource, createChat } = getContext();

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
    const { dataSource, service } = getContext();

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
    const { dataSource, service } = getContext();

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

    await service.completeExecution(
      accepted.execution.executionId,
      'The document is ready.',
      null,
    );

    await expect(
      repo.findOneByOrFail({ activationId: active.activationId }),
    ).resolves.toMatchObject({
      phase: 'finished',
      checkpoint: null,
      status: 'completed',
      finishedAt: expect.any(Date),
    });
  });

  it('persists every independently selected skill activation', async () => {
    const { dataSource, service } = getContext();

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
    const { dataSource, service, createChat } = getContext();

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
    const { dataSource, createChat } = getContext();

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
      const { schema, dataSource, service, progress, createChat } =
        getContext();

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
        expiresAt: expect.any(String),
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
          `UPDATE "${schema}"."execution_events" SET "event_type" = 'changed' ` +
            'WHERE "event_id" = $1',
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
}
