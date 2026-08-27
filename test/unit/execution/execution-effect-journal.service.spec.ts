import { ExecutionEffectJournalService } from '../../../src/execution/execution-effect-journal.service'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';

const EXECUTION_ID = '018f1d8a-54d7-7d63-a1ee-5e9a6adca701';

describe('ExecutionEffectJournalService', () => {
  const input = {
    executionId: EXECUTION_ID,
    effectKey: 'summarize-document-append:7',
    effectType: 'document_content_append',
    resourceKey: 'document:7',
    intent: { targetDocId: 7, summary: 'Summary' },
  };

  function setup(existing: Record<string, unknown> | null = null) {
    const saved: Record<string, unknown>[] = [];
    const journalRepository = {
      findOne: jest.fn().mockResolvedValue(existing),
      findOneBy: jest.fn().mockResolvedValue(existing),
      create: jest.fn((value) => ({ journalId: 'journal-1', ...value })),
      save: jest.fn(async (value) => {
        saved.push({ ...value });
        return value;
      }),
    };
    const executionRepository = {
      findOne: jest.fn().mockResolvedValue({ executionId: EXECUTION_ID }),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === ExecutionEntity ? executionRepository : journalRepository,
      ),
    };
    const dataSource = {
      transaction: jest.fn((callback) => callback(manager)),
      getRepository: jest.fn().mockReturnValue(journalRepository),
    };
    return {
      service: new ExecutionEffectJournalService(dataSource as any),
      apply: jest.fn().mockResolvedValue({ documentId: 7 }),
      saved,
      journalRepository,
      executionRepository,
    };
  }

  it('records intent and verified observation in the effect transaction', async () => {
    const context = setup();

    await expect(
      context.service.runVerified(input, context.apply),
    ).resolves.toEqual({ applied: true, observation: { documentId: 7 } });

    expect(context.executionRepository.findOne).toHaveBeenCalledWith({
      where: { executionId: EXECUTION_ID },
      lock: { mode: 'pessimistic_write' },
    });
    expect(context.apply).toHaveBeenCalledTimes(1);
    expect(context.saved).toHaveLength(2);
    expect(context.saved[0]).toEqual(
      expect.objectContaining({ status: 'prepared', observation: null }),
    );
    expect(context.saved[1]).toEqual(
      expect.objectContaining({
        status: 'verified',
        observation: { documentId: 7 },
        appliedAt: expect.any(Date),
        verifiedAt: expect.any(Date),
      }),
    );
  });

  it('reconciles a verified retry without applying the effect again', async () => {
    const first = setup();
    await first.service.runVerified(input, first.apply);
    const verified = first.saved[1];
    const retry = setup(verified);

    await expect(
      retry.service.runVerified(input, retry.apply),
    ).resolves.toEqual({ applied: false, observation: { documentId: 7 } });

    expect(retry.apply).not.toHaveBeenCalled();
    expect(retry.saved).toHaveLength(0);
  });

  it('rejects a retry whose intent differs from the journal', async () => {
    const first = setup();
    await first.service.runVerified(input, first.apply);
    const retry = setup(first.saved[1]);

    await expect(
      retry.service.runVerified(
        { ...input, intent: { targetDocId: 7, summary: 'Changed' } },
        retry.apply,
      ),
    ).rejects.toThrow('execution_effect_journal_conflict');
    expect(retry.apply).not.toHaveBeenCalled();
  });

  it('reads an already verified observation before external preparation', async () => {
    const context = setup({
      effectType: input.effectType,
      resourceKey: input.resourceKey,
      status: 'verified',
      observation: { documentId: 7 },
    });

    await expect(
      context.service.getVerifiedObservation(
        input.executionId,
        input.effectKey,
        input.effectType,
        input.resourceKey,
      ),
    ).resolves.toEqual({ documentId: 7 });
  });

  it('commits an external effect intent and baseline before the mutation', async () => {
    const context = setup();
    const baseline = {
      schemaVersion: 'workspace-file-snapshot/1',
      filename: 'notes.md',
      exists: false,
    };

    await expect(
      context.service.prepareExternal(input, baseline),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'prepared',
        intent: input.intent,
        preparationObservation: baseline,
        observation: null,
      }),
    );

    expect(context.saved).toHaveLength(1);
    expect(context.saved[0]).toEqual(
      expect.objectContaining({
        status: 'prepared',
        intent: input.intent,
        preparationObservation: baseline,
        observation: null,
        lastObservation: null,
      }),
    );
  });

  it('keeps a verified not-applied observation durable while allowing replay', async () => {
    const first = setup();
    await first.service.prepareExternal(input, { exists: false });
    const restarted = setup(first.saved[0]);
    const observation = {
      effectStatus: 'not_applied',
      reason: 'workspace_baseline_unchanged',
    };

    await expect(
      restarted.service.recordExternalObservation(
        input,
        observation,
        'continue',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        status: 'prepared',
        observation: null,
        lastObservation: observation,
        lastObservedAt: expect.any(Date),
      }),
    );
  });

  it.each([
    ['verified', 'applied'],
    ['inconclusive', 'inconclusive'],
  ] as const)(
    'makes a %s external observation terminal and idempotent',
    async (disposition, effectStatus) => {
      const first = setup();
      await first.service.prepareExternal(input, { exists: false });
      const restarted = setup(first.saved[0]);
      const observation = { effectStatus, reason: 'reconciled' };
      const terminal = await restarted.service.recordExternalObservation(
        input,
        observation,
        disposition,
      );
      const duplicate = setup(restarted.saved[0]);

      await expect(
        duplicate.service.recordExternalObservation(
          input,
          observation,
          disposition,
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          status: disposition,
          observation,
        }),
      );
      expect(terminal).toEqual(
        expect.objectContaining({ status: disposition, observation }),
      );
      expect(duplicate.saved).toHaveLength(0);
    },
  );

  it('rejects a restarted external effect whose intent changed', async () => {
    const first = setup();
    await first.service.prepareExternal(input, { exists: false });
    const restarted = setup(first.saved[0]);

    await expect(
      restarted.service.prepareExternal(
        { ...input, intent: { ...input.intent, summary: 'Changed' } },
        { exists: false },
      ),
    ).rejects.toThrow('execution_effect_journal_conflict');
  });

  it('rejects conflicting evidence after an external effect is terminal', async () => {
    const first = setup();
    await first.service.prepareExternal(input, { exists: false });
    const reconciled = setup(first.saved[0]);
    await reconciled.service.recordExternalObservation(
      input,
      { effectStatus: 'applied', reason: 'content_verified' },
      'verified',
    );
    const restarted = setup(reconciled.saved[0]);

    await expect(
      restarted.service.recordExternalObservation(
        input,
        { effectStatus: 'not_applied', reason: 'baseline_unchanged' },
        'verified',
      ),
    ).rejects.toThrow('execution_effect_journal_conflict');
  });
});
