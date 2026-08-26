import { EntityRetranslationStrategy } from '../../../src/execution-processor/processors/translate/entity-retranslation.strategy'; // eslint-disable-line max-len
import { ExecutionEntity } from '../../../src/execution/execution.entity';

describe('EntityRetranslationStrategy', () => {
  it('journals and verifies pending-entity translation merges', async () => {
    const pending = { id: 5, name: 'Ada', translations: { en: 'Ada' } };
    const pendingEntities = { findOne: jest.fn().mockResolvedValue(pending) };
    const repository = {
      findOne: jest.fn().mockResolvedValue(pending),
      save: jest.fn().mockImplementation(async (value) => value),
      findOneBy: jest.fn().mockImplementation(async () => pending),
    };
    const manager = { getRepository: jest.fn().mockReturnValue(repository) };
    const effectJournal = {
      runVerified: jest.fn(async (_input, callback) => ({
        applied: true,
        observation: await callback(manager),
      })),
    };
    const strategy = new EntityRetranslationStrategy(
      pendingEntities as any,
      effectJournal as any,
    );
    const execution = {
      executionId: '018f1d8a-54d7-7d63-a1ee-5e9a6adca701',
      payload: { entityId: 5, targetLanguages: ['es'] },
      result: { response: [{ translation_text: 'Ada' }] },
    } as ExecutionEntity;

    await expect(strategy.execute(execution)).resolves.toEqual(
      expect.objectContaining({
        success: true,
        entityId: 5,
        updatedLanguages: ['es'],
      }),
    );
    expect(pending.translations).toEqual({ en: 'Ada', es: 'Ada' });
    expect(effectJournal.runVerified).toHaveBeenCalledWith(
      expect.objectContaining({
        effectKey: 'entity-retranslation:5',
        effectType: 'pending_entity_translations_merge',
      }),
      expect.any(Function),
    );
  });
});
