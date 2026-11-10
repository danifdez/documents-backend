import { PendingEntityService } from '../../../src/pending-entity/pending-entity.service';
import { PendingEntityEntity } from '../../../src/pending-entity/pending-entity.entity';
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

describe('PendingEntityService confirmation', () => {
  let service: PendingEntityService;
  let repository: MockRepository<PendingEntityEntity>;
  let entityService: Record<string, jest.Mock>;
  let resourceService: Record<string, jest.Mock>;
  let executionService: Record<string, jest.Mock>;

  beforeEach(() => {
    repository = createMockRepository<PendingEntityEntity>();
    entityService = { findByResourceId: jest.fn() };
    resourceService = {
      findOne: jest.fn().mockResolvedValue({ id: 7, project: { id: 5 } }),
      update: jest.fn().mockResolvedValue({}),
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
      jest
        .spyOn(service, 'findByResourceId')
        .mockResolvedValue([buildPending()]);
      jest
        .spyOn(service as any, 'materializePendingEntity')
        .mockRejectedValue(new Error('boom'));

      await expect(service.confirmEntities(7)).resolves.toEqual({
        confirmed: 0,
        errors: [expect.stringContaining('boom')],
      });

      expect(resourceService.update).not.toHaveBeenCalled();
      expect(executionService.create).not.toHaveBeenCalled();
    });

    it('confirms and enqueues ingest when at least one entity was confirmed', async () => {
      jest
        .spyOn(service, 'findByResourceId')
        .mockResolvedValue([
          buildPending({ id: 1, name: 'Ada' }),
          buildPending({ id: 2, name: 'Broken' }),
        ]);
      jest
        .spyOn(service as any, 'materializePendingEntity')
        .mockImplementation(async (pending: PendingEntityEntity) => {
          if (pending.name === 'Broken') throw new Error('invalid');
        });

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
      jest
        .spyOn(service as any, 'materializePendingEntity')
        .mockResolvedValue(undefined);
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
      jest
        .spyOn(service as any, 'materializePendingEntity')
        .mockResolvedValue(undefined);
      repository.count.mockResolvedValue(2);

      await service.confirmEntity(1);

      expect(resourceService.update).not.toHaveBeenCalled();
      expect(executionService.create).not.toHaveBeenCalled();
    });
  });
});
