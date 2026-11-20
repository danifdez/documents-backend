import { NotFoundException } from '@nestjs/common';
import { PendingEntityService } from '../../../src/pending-entity/pending-entity.service';
import { PendingEntityEntity } from '../../../src/pending-entity/pending-entity.entity';
import { ExecutionPriority } from '../../../src/execution/execution-priority.enum';
import { createMockRepository, MockRepository } from '../../test-utils';

function buildPending(
  overrides: Partial<PendingEntityEntity> = {},
): PendingEntityEntity {
  return {
    id: 1,
    resourceId: 7,
    name: 'Ada',
    status: 'pending',
    entityType: { id: 1, name: 'PERSON' },
    ...overrides,
  } as PendingEntityEntity;
}

describe('PendingEntityService', () => {
  let service: PendingEntityService;
  let repository: MockRepository<PendingEntityEntity>;
  let entityService: Record<string, jest.Mock>;
  let resourceService: Record<string, jest.Mock>;
  let executionService: Record<string, jest.Mock>;

  beforeEach(() => {
    repository = createMockRepository<PendingEntityEntity>();
    repository.create.mockImplementation((value) => value);
    repository.save.mockImplementation(async (value) => value);
    entityService = {
      findByResourceId: jest.fn().mockResolvedValue([]),
      findByNameAndType: jest.fn().mockResolvedValue(null),
      findByNameTypeAndLocale: jest.fn().mockResolvedValue(null),
      findOne: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 8 }),
      update: jest.fn(),
      addProjectToEntity: jest.fn(),
    };
    resourceService = {
      findOne: jest.fn().mockResolvedValue({ id: 7, project: { id: 5 } }),
      update: jest.fn().mockResolvedValue({}),
      addEntityToResource: jest.fn(),
      getContentById: jest.fn().mockResolvedValue('<p>content</p>'),
    };
    executionService = { create: jest.fn().mockResolvedValue({}) };
    service = new PendingEntityService(
      repository as any,
      entityService as any,
      resourceService as any,
      executionService as any,
    );
    process.env.FEATURE_RELATIONSHIPS = 'false';
  });

  afterEach(() => {
    delete process.env.FEATURE_RELATIONSHIPS;
    jest.restoreAllMocks();
  });

  describe('confirmEntities', () => {
    it('does not confirm the resource or enqueue ingest when nothing was confirmed', async () => {
      repository.find.mockResolvedValue([buildPending()]);
      entityService.create.mockRejectedValue(new Error('boom'));

      await expect(service.confirmEntities(7)).resolves.toEqual({
        confirmed: 0,
        errors: [expect.stringContaining('boom')],
      });

      expect(resourceService.update).not.toHaveBeenCalled();
      expect(executionService.create).not.toHaveBeenCalled();
    });

    it('confirms and enqueues ingest when at least one entity was confirmed', async () => {
      repository.find.mockResolvedValue([
        buildPending({ id: 1, name: 'Ada' }),
        buildPending({ id: 2, name: 'Broken', entityType: null }),
        buildPending({ id: 3, name: 'Merged', status: 'merged' }),
      ]);

      await expect(service.confirmEntities(7)).resolves.toEqual({
        confirmed: 1,
        errors: [expect.stringContaining('Broken')],
      });

      expect(resourceService.update).toHaveBeenCalledWith(7, {
        status: 'confirmed',
      });
      expect(executionService.create).toHaveBeenCalledWith(
        'ingest-content',
        expect.anything(),
        expect.objectContaining({ resourceId: 7, projectId: 5 }),
      );
    });
  });

  describe('confirmEntity', () => {
    it('finalizes the resource when the last pending entity is confirmed', async () => {
      repository.findOne.mockResolvedValue(buildPending());
      repository.count.mockResolvedValue(0);

      await expect(service.confirmEntity(1)).resolves.toEqual({
        success: true,
        message: 'Entity confirmed successfully',
      });

      expect(resourceService.update).toHaveBeenCalledWith(7, {
        status: 'confirmed',
      });
      expect(executionService.create).toHaveBeenCalledWith(
        'ingest-content',
        expect.anything(),
        expect.objectContaining({ resourceId: 7 }),
      );
    });

    it('does not finalize the resource while other pending entities remain', async () => {
      repository.findOne.mockResolvedValue(buildPending());
      repository.count.mockResolvedValue(2);

      await service.confirmEntity(1);

      expect(resourceService.update).not.toHaveBeenCalled();
      expect(executionService.create).not.toHaveBeenCalled();
    });
  });

  describe('pending entity records', () => {
    it('loads entity types and resources in creation order', async () => {
      const pending = buildPending();
      repository.find.mockResolvedValue([pending]);
      repository.findOne.mockResolvedValue(pending);
      await expect(service.findAll()).resolves.toEqual([pending]);
      expect(repository.find).toHaveBeenCalledWith({
        relations: ['entityType', 'resource'],
        order: { createdAt: 'DESC' },
      });
      await expect(service.findOne(1)).resolves.toBe(pending);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: 1 },
        relations: ['entityType', 'resource'],
      });
    });

    it('checks for confirmed names in the entity locale before using name and type', async () => {
      repository.find.mockResolvedValue([
        buildPending({ name: 'Localized', language: 'es' }),
        buildPending({ name: 'Fallback', language: 'fr' }),
        buildPending({ name: 'Unconfirmed' }),
        buildPending({ name: 'Untyped', entityType: null }),
      ]);
      entityService.findByNameTypeAndLocale.mockResolvedValueOnce({ id: 10 });
      entityService.findByNameAndType.mockImplementation(async (name) =>
        name === 'Fallback' ? { id: 11 } : null,
      );

      await expect(service.findByResourceId(7)).resolves.toMatchObject([
        { name: 'Localized', isConfirmed: true },
        { name: 'Fallback', isConfirmed: true },
        { name: 'Unconfirmed', isConfirmed: false },
        { name: 'Untyped', isConfirmed: false },
      ]);
      expect(entityService.findByNameTypeAndLocale.mock.calls).toEqual([
        ['Localized', 1, 'es'],
        ['Fallback', 1, 'fr'],
      ]);
      expect(entityService.findByNameAndType.mock.calls).toEqual([
        ['Unconfirmed', 1],
        ['Fallback', 1],
      ]);
    });

    it('creates pending entities with defaults or the requested scope and language', async () => {
      const alias = { locale: 'es', value: 'Nombre', scope: 'global' as const };
      resourceService.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ language: 'es' });
      await expect(
        service.create({ resourceId: 7, name: 'Name' }),
      ).resolves.toEqual({
        resource: { id: 7 },
        name: 'Name',
        scope: 'document',
        aliases: null,
        entityType: null,
        language: null,
        translations: null,
      });
      await expect(
        service.create({
          resourceId: 7,
          name: 'Name',
          entityTypeId: 4,
          scope: 'global',
          aliases: [alias],
          translations: { es: 'Nombre' },
        }),
      ).resolves.toEqual({
        resource: { id: 7 },
        name: 'Name',
        scope: 'global',
        aliases: [alias],
        entityType: { id: 4 },
        language: 'es',
        translations: { es: 'Nombre' },
      });
    });

    it('patches supplied fields and allows clearing the type', async () => {
      const pending = buildPending();
      await expect(service.update(1, { name: 'Updated' })).resolves.toBeNull();
      repository.findOneBy.mockResolvedValue(pending);
      await expect(
        service.update(1, {
          name: 'Updated',
          scope: 'project',
          translations: { fr: 'Nom' },
          aliases: [],
          entityTypeId: 9,
        }),
      ).resolves.toMatchObject({
        name: 'Updated',
        scope: 'project',
        translations: { fr: 'Nom' },
        aliases: [],
        entityType: { id: 9 },
      });
      await expect(
        service.update(1, { entityTypeId: null }),
      ).resolves.toMatchObject({
        name: 'Updated',
        scope: 'project',
        entityType: null,
      });
      repository.findOneBy.mockResolvedValueOnce(null);
      await expect(service.remove(1)).resolves.toBeNull();
      await expect(service.remove(1)).resolves.toBe(pending);
      expect(repository.remove).toHaveBeenCalledWith(pending);
      await service.clearByResourceId(7);
      expect(repository.delete).toHaveBeenCalledWith({ resourceId: 7 });
    });
  });

  describe('materialization and post-confirmation work', () => {
    const alias = { locale: 'en', scope: 'document' as const, value: 'A.' };

    it('creates a project-scoped confirmed entity, links it to the resource, and removes the pending row', async () => {
      const pending = buildPending({ scope: 'project', aliases: [alias] });
      repository.findOne.mockResolvedValue(pending);
      repository.count.mockResolvedValue(2);
      await expect(service.confirmEntity(1)).resolves.toMatchObject({
        success: true,
      });
      expect(entityService.create).toHaveBeenCalledWith({
        name: 'Ada',
        entityTypeId: 1,
        aliases: [alias],
        projectIds: [5],
      });
      expect(resourceService.addEntityToResource).toHaveBeenCalledWith(7, {
        id: 8,
      });
      expect(repository.remove).toHaveBeenCalledWith(pending);
    });

    it('sets global scope on an existing entity without creating a duplicate', async () => {
      const entity = { id: 8, global: false };
      repository.findOne.mockResolvedValue(buildPending({ scope: 'global' }));
      entityService.findByNameAndType.mockResolvedValue(entity);
      repository.count.mockResolvedValue(1);
      await service.confirmEntity(1);
      expect(entityService.update).toHaveBeenCalledWith(8, { global: true });
      expect(entityService.create).not.toHaveBeenCalled();
      expect(resourceService.addEntityToResource).toHaveBeenCalledWith(7, {
        id: 8,
        global: true,
      });
      entityService.update.mockClear();
      await service.confirmEntity(1);
      expect(entityService.update).not.toHaveBeenCalled();
    });

    it('adds an existing entity to a project referenced by its numeric id', async () => {
      repository.findOne.mockResolvedValue(buildPending({ scope: 'project' }));
      resourceService.findOne.mockResolvedValue({ id: 7, project: 5 });
      entityService.findByNameAndType.mockResolvedValue({ id: 8 });
      repository.count.mockResolvedValue(1);
      await service.confirmEntity(1);
      expect(entityService.addProjectToEntity).toHaveBeenCalledWith(8, 5);
    });

    it('creates global entities and refuses to confirm missing, merged, or untyped rows', async () => {
      await expect(service.confirmEntity(1)).resolves.toMatchObject({
        success: false,
        message: 'Pending entity not found',
      });
      repository.findOne
        .mockResolvedValueOnce(buildPending({ status: 'merged' }))
        .mockResolvedValueOnce(buildPending({ entityType: null }))
        .mockResolvedValue(buildPending({ scope: 'global' }));
      await expect(service.confirmEntity(1)).resolves.toMatchObject({
        success: false,
        message: 'Cannot confirm a merged entity',
      });
      await expect(service.confirmEntity(1)).resolves.toMatchObject({
        success: false,
        message: 'Entity type is required',
      });
      resourceService.findOne.mockResolvedValueOnce(null);
      await expect(service.confirmEntity(1)).resolves.toMatchObject({
        success: false,
        message: 'Resource not found',
      });
      expect(entityService.create).not.toHaveBeenCalled();
      repository.count.mockResolvedValue(1);
      await expect(service.confirmEntity(1)).resolves.toMatchObject({
        success: true,
      });
      expect(entityService.create).toHaveBeenCalledWith({
        name: 'Ada',
        entityTypeId: 1,
        aliases: undefined,
        global: true,
      });
    });

    it('enqueues relationship extraction after the final confirmation when evidence exists', async () => {
      process.env.FEATURE_RELATIONSHIPS = 'true';
      repository.findOne.mockResolvedValue(buildPending());
      repository.count.mockResolvedValue(0);
      resourceService.findOne.mockResolvedValue({ id: 7, projectId: 5 });
      entityService.findByResourceId.mockResolvedValue([
        { id: 1, name: 'Ada', entityType: { name: 'PERSON' } },
        { id: 2, name: 'Lab' },
      ]);
      await expect(service.confirmEntity(1)).resolves.toMatchObject({
        success: true,
      });
      expect(executionService.create).toHaveBeenNthCalledWith(
        2,
        'relationship-extraction',
        ExecutionPriority.NORMAL,
        {
          resourceId: 7,
          projectId: 5,
          entities: [
            { id: 1, name: 'Ada', type: 'PERSON' },
            { id: 2, name: 'Lab', type: 'UNKNOWN' },
          ],
        },
        { steps: expect.any(Array) },
      );
    });

    it('returns the relationship work error without losing the successful confirmation', async () => {
      process.env.FEATURE_RELATIONSHIPS = 'true';
      repository.findOne.mockResolvedValue(buildPending());
      repository.count.mockResolvedValue(0);
      resourceService.findOne.mockResolvedValue({ id: 7 });
      resourceService.getContentById.mockResolvedValue('');
      entityService.findByResourceId.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      await expect(service.confirmEntity(1)).resolves.toMatchObject({
        success: true,
        message: expect.stringContaining(
          'Relationship extraction content is empty',
        ),
      });
      expect(executionService.create).toHaveBeenCalledTimes(1);
      expect(executionService.create).toHaveBeenCalledWith(
        'ingest-content',
        ExecutionPriority.NORMAL,
        {
          resourceId: 7,
          projectId: null,
          content: '',
        },
      );
      repository.find.mockResolvedValue([]);
      resourceService.findOne.mockResolvedValue(null);
      await expect(service.confirmEntities(7)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('merge and undo', () => {
    const sameValueOtherScope = {
      locale: 'en',
      value: 'Ada',
      scope: 'global' as const,
    };
    const unrelated = { locale: 'en', value: 'A.', scope: 'project' as const };

    it('adds a pending alias and restores the source while preserving aliases with a different scope', async () => {
      const source = buildPending({ scope: 'project' });
      const target = buildPending({
        id: 2,
        name: 'Target',
        aliases: [sameValueOtherScope, unrelated],
      });
      repository.findOne.mockResolvedValue(source);
      repository.findOneBy.mockResolvedValueOnce(target);
      await expect(
        service.mergeEntity(1, 'pending', 2, 'project'),
      ).resolves.toMatchObject({ success: true });
      expect(target.aliases).toEqual([
        sameValueOtherScope,
        unrelated,
        { locale: 'en', value: 'Ada', scope: 'project' },
      ]);
      expect(source).toMatchObject({
        status: 'merged',
        mergedTargetId: 2,
        mergedTargetType: 'pending',
        mergedAt: expect.any(Date),
      });
      repository.findOneBy
        .mockResolvedValueOnce(source)
        .mockResolvedValueOnce(target);
      await expect(service.cancelMerge(1)).resolves.toMatchObject({
        success: true,
      });
      expect(target.aliases).toEqual([sameValueOtherScope, unrelated]);
      expect(source).toMatchObject({
        status: 'pending',
        mergedTargetType: null,
        mergedTargetId: null,
        mergedAt: null,
      });
    });

    it('links aliases to confirmed targets and removes them by value on undo', async () => {
      const source = buildPending({ scope: 'project' });
      repository.findOne.mockResolvedValue(source);
      const confirmed = { id: 2, aliases: null };
      entityService.findOne.mockResolvedValue(confirmed);
      await expect(
        service.mergeEntity(1, 'confirmed', 2, 'project'),
      ).resolves.toMatchObject({ success: true });
      expect(entityService.update).toHaveBeenCalledWith(2, {
        aliases: [{ locale: 'en', scope: 'project', value: 'Ada' }],
      });
      confirmed.aliases = [sameValueOtherScope, unrelated];
      repository.findOneBy.mockResolvedValue(source);
      await expect(service.cancelMerge(1)).resolves.toMatchObject({
        success: true,
      });
      expect(entityService.update).toHaveBeenLastCalledWith(2, {
        aliases: [unrelated],
      });
    });

    it('rejects missing targets and incomplete merge state without writing', async () => {
      await expect(
        service.mergeEntity(1, 'pending', 2, 'project'),
      ).resolves.toMatchObject({
        success: false,
        message: 'Source entity not found',
      });
      repository.findOne.mockResolvedValue(buildPending());
      await expect(
        service.mergeEntity(1, 'pending', 2, 'project'),
      ).resolves.toMatchObject({
        success: false,
        message: 'Target pending entity not found',
      });
      await expect(
        service.mergeEntity(1, 'confirmed', 2, 'project'),
      ).resolves.toMatchObject({
        success: false,
        message: 'Target confirmed entity not found',
      });
      await expect(service.cancelMerge(1)).resolves.toMatchObject({
        success: false,
        message: 'Source pending entity not found',
      });
      repository.findOneBy
        .mockResolvedValueOnce(buildPending())
        .mockResolvedValueOnce(buildPending({ status: 'merged' }))
        .mockResolvedValueOnce(
          buildPending({ status: 'merged', mergedTargetType: 'pending' }),
        );
      for (let index = 0; index < 3; index++) {
        await expect(service.cancelMerge(1)).resolves.toMatchObject({
          success: false,
          message: 'Entity is not merged',
        });
      }
      expect(repository.save).not.toHaveBeenCalled();
    });

    it('clears the merge even if the referenced target was already removed', async () => {
      const pending = buildPending({
        status: 'merged',
        mergedTargetType: 'pending',
        mergedTargetId: 2,
      });
      repository.findOneBy
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(null);
      await expect(service.cancelMerge(1)).resolves.toMatchObject({
        success: true,
      });
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending', mergedTargetId: null }),
      );
    });
  });

  describe('retranslation', () => {
    it('stores the edited translation and requests only missing locales', async () => {
      const pending = buildPending({ translations: { de: 'Ada' } });
      repository.findOne.mockResolvedValue(pending);
      await expect(
        service.retranslateEntity(1, 'Ada Nueva', 'es', 'fr', 'it'),
      ).resolves.toEqual({ success: true });
      expect(repository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          translations: { de: 'Ada', es: 'Ada Nueva' },
        }),
      );
      expect(executionService.create).toHaveBeenCalledWith(
        'translate',
        ExecutionPriority.NORMAL,
        {
          resourceId: 7,
          targetLanguages: ['fr', 'it'],
          translationType: 'entity-retranslate',
          entityId: 1,
        },
        { steps: expect.any(Array) },
      );
    });

    it('deduplicates requested languages and skips English and already available translations', async () => {
      repository.findOne.mockResolvedValue(buildPending());
      await service.retranslateEntity(1, 'Ada', 'en', 'fr', 'fr');
      expect(executionService.create).toHaveBeenCalledWith(
        'translate',
        ExecutionPriority.NORMAL,
        expect.objectContaining({ targetLanguages: ['fr'] }),
        expect.anything(),
      );
      executionService.create.mockClear();
      await service.retranslateEntity(1, 'Ada', 'fr', 'fr', 'en');
      expect(executionService.create).not.toHaveBeenCalled();
      await service.retranslateEntity(1, 'Ada', 'en', 'en', 'fr');
      expect(executionService.create).not.toHaveBeenCalled();
      repository.findOne.mockResolvedValue(null);
      await expect(
        service.retranslateEntity(1, 'Ada', 'en', 'en', 'en'),
      ).resolves.toMatchObject({
        success: false,
        message: 'Pending entity not found',
      });
    });
  });
});
